import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {newCase,applyEvent,normalizePhone,modelCase} from './backend/workflow.js';
import {encryption,Database} from './backend/database.js';
import {LiveWorkflow} from './backend/tools.js';
import {Knowledge} from './backend/knowledge.js';

function event(state,type,values={}){return applyEvent(state,{id:randomUUID(),type,...values});}
function confirmed(state,scope,facts){
  const caller=randomUUID(),assistant=randomUUID(),reply=randomUUID();
  const words=facts.map(f=>f.raw).join(' ');
  state=event(state,'turn',{turnId:caller,role:'caller',text:words});
  state=event(state,'propose',{scope,facts,turnId:caller});const batchId=state.pending.id;
  state=event(state,'turn',{turnId:assistant,role:'assistant',text:facts.map(f=>typeof f.value==='boolean'?'হ্যাঁ':String(f.value)).join(' ')});
  state=event(state,'readback',{batchId,turnId:assistant});
  state=event(state,'turn',{turnId:reply,role:'caller',text:'জি'});
  return event(state,'confirm',{batchId,turnId:reply});
}
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
test('retrieval uses confirmed facts only, excludes identity and forces approved-only mode',async()=>{
  let parameters;
  const knowledge=new Knowledge({rpc:async(name,args)=>{parameters=args;return {data:[],error:null};}},{embedding:async()=>{throw new Error('unavailable');}});
  let state=newCase('operator');assert.equal((await knowledge.retrieve(state)).kind,'ASK');
  state=confirmed(state,'facts',[{key:'crop',value:'ধান',raw:'ধান'},{key:'symptom',value:'দাগ',raw:'দাগ'},{key:'symptomLocation',value:'ডগা',raw:'ডগা'},{key:'duration',value:'তিন দিন',raw:'তিন দিন'}]);
  state.profile.name={value:'private'};
  const result=await knowledge.retrieve(state);assert.equal(result.kind,'REFER');assert.equal(parameters.p_research,false);assert.equal(parameters.p_crop,'rice');assert.ok(!parameters.p_query.includes('private'));assert.match(result.embeddingStatus,/fallback/);
});
