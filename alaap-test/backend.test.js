import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {newCase,applyEvent,normalizePhone,modelCase,confirmationAnswer} from './backend/workflow.js';
import {encryption,Database} from './backend/database.js';
import {LiveWorkflow} from './backend/tools.js';
import {Knowledge} from './backend/knowledge.js';
import {verifiedTokenSession} from './backend/api.js';

function event(state,type,values={}){return applyEvent(state,{id:randomUUID(),type,...values});}
function confirmed(state,scope,facts){
  const caller=randomUUID(),assistant=randomUUID(),reply=randomUUID();
  const words=facts.map(f=>f.raw).join(' ');
  state=event(state,'turn',{turnId:caller,role:'caller',text:words});
  state=event(state,'propose',{scope,facts,turnId:caller});const batchId=state.pending.id;
  state=event(state,'turn',{turnId:assistant,role:'assistant',text:facts.map(f=>typeof f.value==='boolean'?(f.value?'হ্যাঁ':'না'):String(f.value)).join(' ')});
  state=event(state,'readback',{batchId,turnId:assistant});
  state=event(state,'turn',{turnId:reply,role:'caller',text:'জি'});
  return event(state,'confirm',{batchId,turnId:reply});
}

test('callback sessions verify tokens with Supabase before trusting user or expiry',async()=>{
  const expires=Math.floor(Date.now()/1000)+3600;
  const token='header.'+Buffer.from(JSON.stringify({exp:expires})).toString('base64url')+'.signature';
  const user={id:'verified-user',email:'operator@example.invalid'};
  const client={auth:{getUser:async supplied=>{assert.equal(supplied,token);return {data:{user},error:null};}}};
  const result=await verifiedTokenSession(client,token);
  assert.equal(result.data.user,user);assert.equal(result.data.session.expires_at,expires);
  await assert.rejects(verifiedTokenSession({auth:{getUser:async()=>({data:{user:null},error:{message:'Rejected'}})}},token),/Invalid or expired/);
  const expired='header.'+Buffer.from(JSON.stringify({exp:1})).toString('base64url')+'.signature';
  await assert.rejects(verifiedTokenSession({auth:{getUser:async()=>({data:{user},error:null})}},expired),/expired/);
});
test('registration requires explicit confirmed fields and service consent; age is optional',()=>{
  let state=newCase('operator');assert.throws(()=>event(state,'register'),/Confirm name/);
  state=confirmed(state,'profile',[{key:'name',value:'পরীক্ষক',raw:'পরীক্ষক'},{key:'location',value:'চট্টগ্রাম',raw:'চট্টগ্রাম'},{key:'phone',value:'01712345678',raw:'01712345678'}]);
  assert.throws(()=>event(state,'register'),/Service consent/);
  state=confirmed(state,'profile',[{key:'serviceConsent',value:true,raw:'তথ্য রাখতে সম্মতি দিচ্ছি'}]);
  state=event(state,'register');assert.equal(state.registrationComplete,true);assert.equal(state.profile.age,undefined);
  assert.equal(state.profile.phone.value,'+8801712345678');
});
test('read-back, later explicit confirmation and active batch IDs are mandatory',()=>{
  let state=newCase('operator');const caller=randomUUID();
  assert.throws(()=>event(state,'confirm',{}),/Read back/);
  assert.throws(()=>event(state,'readback',{}),/Stale/);
  state=event(state,'turn',{turnId:caller,role:'caller',text:'পোকা নেই'});
  state=event(state,'propose',{scope:'facts',turnId:caller,facts:[{key:'negation',value:'পোকা নেই',raw:'পোকা নেই'}]});
  assert.throws(()=>event(state,'confirm',{batchId:state.pending.id,turnId:caller}),/Read back/);
  assert.throws(()=>event(state,'propose',{scope:'facts',turnId:caller,facts:[{key:'crop',value:'ধান',raw:'ধান'}]}),/source turn/);
  assert.throws(()=>event(state,'readback',{batchId:'old',turnId:caller}),/Stale/);
  assert.deepEqual(state.facts,{});
});
test('corrections preserve previous values and unreliable turns do not erase confirmed facts',()=>{
  let state=confirmed(newCase('operator'),'facts',[{key:'crop',value:'ধান',raw:'ধান'}]);
  state=confirmed(state,'facts',[{key:'crop',value:'আলু',raw:'আলু'}]);
  assert.equal(state.facts.crop.status,'corrected');assert.equal(state.facts.crop.previous,'ধান');
  const action={id:'retry',type:'turn',turnId:'retry-turn',role:'caller',text:'বুঝিনি'};
  state=applyEvent(state,action);assert.equal(applyEvent(state,action),state);assert.equal(state.facts.crop.value,'আলু');
});
test('shared phones link to separate farmer IDs; model cannot verify identity or bind profiles',()=>{
  const first=newCase('operator'),second=newCase('operator');assert.notEqual(first.profileId,second.profileId);
  assert.throws(()=>event(first,'verify_identity',{actor:'model'}),/operator/);
  assert.throws(()=>event(first,'bind_profile',{actor:'operator',profileId:second.profileId,profile:{}}),/verification/);
  assert.equal(normalizePhone('০১৭১২৩৪৫৬৭৮'),'+8801712345678');assert.throws(()=>normalizePhone('1234'));
});
test('private payloads use authenticated encryption; phone lookup is normalized and keyed',()=>{
  const crypto=encryption('12'.repeat(32),'34'.repeat(32)),data={phone:'+8801712345678',name:'private'};
  const sealed=crypto.seal(data);assert.ok(!sealed.includes(data.phone));assert.deepEqual(crypto.open(sealed),data);
  const bytes=Buffer.from(sealed,'base64');bytes[30]^=1;assert.throws(()=>crypto.open(bytes.toString('base64')));
  assert.equal(crypto.phoneHash('01712345678'),crypto.phoneHash('+8801712345678'));
  assert.notEqual(crypto.phoneHash('01712345678'),encryption('12'.repeat(32),'56'.repeat(32)).phoneHash('01712345678'));
});
test('history is denied before operator verification even with a known profile ID',async()=>{
  const db=new Database({},'operator',{});db.get=async()=>newCase('operator');await assert.rejects(()=>db.history('case','profile'),/verification/);
});
test('identity verification is bound to one selected profile, not all profiles',async()=>{
  let state=newCase('operator');
  state=event(state,'verify_identity',{actor:'operator',profileId:'aaaaaaaa-0000-4000-8000-000000000001'});
  const db=new Database({},'operator',{});db.get=async()=>state;
  await assert.rejects(()=>db.history(state.id,'aaaaaaaa-0000-4000-8000-000000000002'),/this profile/);
  assert.throws(()=>event(state,'bind_profile',{actor:'operator',profileId:'aaaaaaaa-0000-4000-8000-000000000002',profile:{}}),/verification/);
});
test('model context excludes identity and raw transcript history',()=>{
  const state=newCase('operator');state.profile={name:{value:'private'},phone:{value:'+8801712345678'}};state.turns=[{id:'source',role:'caller',text:'private'}];
  const context=JSON.stringify(modelCase(state));assert.ok(!context.includes('private'));assert.ok(!context.includes('01712345678'));
});

test('registration questions follow confirmed consent, name, location and phone without leaking identity',()=>{
  let state=newCase('operator',{synthetic:true});
  assert.equal(state.metadata.synthetic,true);
  assert.equal(newCase('operator',{synthetic:'true'}).metadata.synthetic,false);
  assert.equal(modelCase(state).registration.nextField,'serviceConsent');
  state=confirmed(state,'profile',[{key:'serviceConsent',value:true,raw:'তথ্য রাখতে সম্মতি দিচ্ছি'}]);
  assert.equal(modelCase(state).registration.nextField,'name');
  state=confirmed(state,'profile',[{key:'name',value:'পরীক্ষক',raw:'পরীক্ষক'}]);
  assert.equal(modelCase(state).registration.nextField,'location');
  assert.ok(!JSON.stringify(modelCase(state)).includes('পরীক্ষক'));
  state=confirmed(state,'profile',[{key:'location',value:'চট্টগ্রাম',raw:'চট্টগ্রাম'},{key:'phone',value:'01712345678',raw:'01712345678'}]);
  state=event(state,'register');assert.deepEqual(modelCase(state).registration.missingFields,[]);
  const declined=confirmed(newCase('operator'),'profile',[{key:'serviceConsent',value:false,raw:'না'}]);
  assert.equal(modelCase(declined).registration.consentDeclined,true);
  assert.equal(modelCase(declined).registration.nextField,null);
});

test('live guidance cannot bypass incomplete registration even with crop facts',async()=>{
  let state=newCase('operator');
  const live=new LiveWorkflow({get:async()=>state},state,{retrieve:async()=>({kind:'EVIDENCE'})});
  const result=await live.invoke({id:'before',name:'retrieve_guidance'});
  assert.equal(result.kind,'REGISTRATION_REQUIRED');assert.equal(result.registration.nextField,'serviceConsent');
  state.registrationComplete=true;
  assert.deepEqual(await live.invoke({id:'after',name:'retrieve_guidance'}),{kind:'EVIDENCE'});
});
test('closing a disconnected session does not reopen an operator-resolved case',()=>{
  let state=event(newCase('operator'),'close',{actor:'operator',resolved:true});state=event(state,'close');assert.equal(state.status,'CLOSED');
  assert.equal(event(newCase('operator'),'close').status,'INCOMPLETE');
});
test('Live tools are session-bound, cancellation-aware and cannot mark unplayed read-back',async()=>{
  let state=newCase('operator');const db={get:async id=>{assert.equal(id,state.id);return state;},apply:async(id,action)=>{assert.equal(id,state.id);state=applyEvent(state,action);return state;}};
  const live=new LiveWorkflow(db,state,{});
  live.cancel(['cancelled']);assert.deepEqual(await live.invoke({id:'cancelled',name:'complete_registration'}),{cancelled:true});
  await assert.rejects(()=>live.invoke({id:'read',name:'mark_readback',args:{batchId:'x',turnId:'y'}}),/playing/);
  await assert.rejects(()=>live.invoke({id:'unknown',name:'delete_everything',args:{caseId:'other'}}),/Unknown/);
});

test('short natural Bangla confirmations are accepted while corrections and uncertain replies are rejected',()=>{
  for(const value of ['জি করান','জি জি করেন','হ্যাঁ, জি জি করেন করেন।','হ্যাঁ ঠিক আছে','নিশ্চিত করুন','কনফার্ম করে দিন','yes please confirm it'])assert.equal(confirmationAnswer(value),true,value);
  for(const value of ['হ্যাঁ কিন্তু নাম ভুল','জি নম্বর ঠিক না','ঠিক আছে?','সম্ভবত ঠিক','জি আমার নাম অন্য','جی جی کورن','जी को कौन','করুন'])assert.equal(confirmationAnswer(value),null,value);
  for(const value of ['না','না ঠিক না','no'])assert.equal(confirmationAnswer(value),false,value);
});

test('live registration binds its own turns and confirms only after complete delivered read-back',async()=>{
  let state=newCase('operator');
  const db={get:async()=>state,apply:async(_id,action)=>{state=applyEvent(state,action);return state;}};
  const live=new LiveWorkflow(db,state,{});
  await live.turn('caller','আমার নাম পরীক্ষক');
  const failed=await live.invoke({id:randomUUID(),name:'propose_facts',args:{scope:'profile',facts:[{key:'name',value:'পরীক্ষক',raw:'আমার নাম হচ্ছে পরীক্ষক'}]}});
  assert.equal(failed.error,'Fact wording must occur in the source turn');assert.equal(failed.sourceText,'আমার নাম পরীক্ষক');assert.equal(state.pending,null);
  const fields=[['serviceConsent',true,'হ্যাঁ রাখতে পারেন','তথ্য রাখতে আপনার সম্মতি: হ্যাঁ'],['name','পরীক্ষক','পরীক্ষক','আপনার নাম পরীক্ষক'],['location','চট্টগ্রাম','চট্টগ্রাম','আপনার এলাকা চট্টগ্রাম'],['phone','01712345678','০১৭১২৩৪৫৬৭৮','আপনার নম্বর ০১৭ ১২৩৪ ৫৬৭৮']];
  for(const [key,value,raw,readback] of fields){
    await live.turn('caller',raw);
    await live.invoke({id:randomUUID(),name:'propose_facts',args:{scope:'profile',facts:[{key,value,raw}]}});
    const before=state.pending.id;
    const assistant=await live.turn('assistant',readback);
    await assert.rejects(live.invoke({id:randomUUID(),name:'confirm_facts'}),/Read back/);
    await live.played(assistant);assert.equal(state.pending.readbackTurn,assistant);
    await live.turn('caller','জি করান');
    await assert.rejects(live.invoke({id:randomUUID(),name:'confirm_facts',args:{batchId:'stale',turnId:state.turns.at(-1).id}}),/Read back/);
    assert.equal(state.pending.id,before);
    await live.invoke({id:randomUUID(),name:'confirm_facts'});assert.ok(state.profile[key].confirmedBy);
  }
  await live.invoke({id:randomUUID(),name:'complete_registration'});assert.equal(state.registrationComplete,true);assert.equal(state.profile.phone.value,'+8801712345678');
});

test('phone read-back rejects a different number even if proposed wording appears elsewhere',()=>{
  let state=newCase('operator');const caller='number-source',assistant='readback';
  state=event(state,'turn',{turnId:caller,role:'caller',text:'০১৭১২৩৪৫৬৭৮'});
  state=event(state,'propose',{scope:'profile',turnId:caller,facts:[{key:'phone',value:'01712345678',raw:'০১৭১২৩৪৫৬৭৮'}]});
  state=event(state,'turn',{turnId:assistant,role:'assistant',text:'আপনার নম্বর ০১৮১২৩৪৫৬৭৮'});
  assert.throws(()=>event(state,'readback',{batchId:state.pending.id,turnId:assistant}),/all proposed values/);
});
test('retrieval uses confirmed facts only, excludes identity and forces approved-only mode',async()=>{
  let parameters;
  const knowledge=new Knowledge({rpc:async(name,args)=>{parameters=args;return {data:[],error:null};}},{embedding:async()=>{throw new Error('unavailable');}});
  let state=newCase('operator');assert.equal((await knowledge.retrieve(state)).kind,'ASK');
  state=confirmed(state,'facts',[{key:'crop',value:'ধান',raw:'ধান'},{key:'symptom',value:'দাগ',raw:'দাগ'},{key:'symptomLocation',value:'ডগা',raw:'ডগা'},{key:'duration',value:'তিন দিন',raw:'তিন দিন'}]);
  state.profile.name={value:'private'};
  const result=await knowledge.retrieve(state);assert.equal(result.kind,'REFER');assert.equal(parameters.p_research,false);assert.equal(parameters.p_crop,'rice');assert.ok(!parameters.p_query.includes('private'));assert.match(result.embeddingStatus,/fallback/);
});
