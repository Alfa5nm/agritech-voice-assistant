import {test} from 'node:test';
import assert from 'node:assert/strict';
import {interpretConfirmation,interpretLocationRestatement,interpretReadback} from './backend/confirmation.js';
import {LiveWorkflow} from './backend/tools.js';
import {newCase,applyEvent,matchesReadback} from './backend/workflow.js';

test('contextual interpretations require grounded evidence and fail safely on outages or uncertainty',async()=>{
  const context={reply:'সব তথ্য ঠিক, রেখে দেন',readback:'আপনার এলাকা কুমিল্লা',fields:[{key:'location',value:'কুমিল্লা'}]};
  const valid={decision:'AFFIRM',confidence:.98,evidence:context.reply};
  assert.equal((await interpretConfirmation(context,async()=>valid)).decision,'AFFIRM');
  for(const result of [{...valid,confidence:.4},{...valid,evidence:'invented quote'},{...valid,decision:'UNKNOWN'},{...valid,confidence:2}])assert.equal((await interpretConfirmation(context,async()=>result)).decision,'UNCERTAIN');
  assert.equal((await interpretConfirmation(context,async()=>{throw new Error('Unavailable');})).reason,'interpretation_unavailable');
});

test('location recovery requires an exact explicit caller source and the delivered place',async()=>{
  const context={readback:'আপনার অবস্থান হলো চট্টগ্রাম। এটি কি সঠিক?',turns:[{id:'restated',text:'আমার অবস্থান হচ্ছে চট্টগ্রাম।'}]};
  assert.deepEqual(await interpretLocationRestatement(context,async()=>({turnId:'restated',value:'চট্টগ্রাম',confidence:.99})),{turnId:'restated',value:'চট্টগ্রাম'});
  for(const result of [{turnId:'invented',value:'চট্টগ্রাম',confidence:.99},{turnId:'restated',value:'ঢাকা',confidence:.99},{turnId:'restated',value:'চট্টগ্রাম',confidence:.7}])assert.equal(await interpretLocationRestatement(context,async()=>result),null);
  assert.equal(await interpretLocationRestatement(context,async()=>{throw new Error('Unavailable');}),null);
});

test('the repeated Chattogram read-back confirms the callers later explicit restatement, never the corrupt proposal',async()=>{
  let state=newCase('operator'),repairs=0;
  const db={get:async()=>state,apply:async(_,event)=>state=applyEvent(state,event)};
  const live=new LiveWorkflow(db,state,{}, {readback:async()=>null,locationRestatement:async({turns,readback})=>{repairs++;assert.match(readback,/চট্টগ্রাম/);return {turnId:turns.find(t=>t.text==='আমার অবস্থান হচ্ছে চট্টগ্রাম।')?.id,value:'চট্টগ্রাম'};}});
  await live.turn('caller','chotodam');
  await live.invoke({id:'bad-proposal',name:'propose_facts',args:{scope:'profile',facts:[{key:'location',value:'chotodam',raw:'chotodam'}]}});
  await live.played(await live.turn('assistant','আপনার অবস্থান হলো চট্টগ্রাম। এটি কি সঠিক?'));
  await live.turn('caller','হ্যাঁ।');
  const blocked=await live.invoke({id:'first-yes',name:'confirm_facts'});
  assert.match(blocked.recovery,/Repeating/);assert.equal(state.profile.location,undefined);assert.equal(repairs,0);
  const restated=await live.turn('caller','আমার অবস্থান হচ্ছে চট্টগ্রাম।');
  const readback=await live.turn('assistant','আপনার অবস্থান হলো চট্টগ্রাম। এটি কি সঠিক?');await live.played(readback);
  const yes=await live.turn('caller','হ্যাঁ সঠিক');
  await live.invoke({id:'grounded-confirmation',name:'confirm_facts'});
  assert.equal(state.profile.location.value,'চট্টগ্রাম');assert.equal(state.profile.location.sourceTurn,restated);assert.equal(state.profile.location.confirmedBy,yes);assert.equal(state.pending,null);
  assert.ok(state.turns.findIndex(t=>t.id===restated)<state.turns.findIndex(t=>t.id===readback));
});

test('restatement recovery cannot confirm before playback or on refusal',async()=>{
  for(const reply of ['না','হ্যাঁ কিন্তু জায়গা ভুল']){
    let state=newCase('operator');const db={get:async()=>state,apply:async(_,event)=>state=applyEvent(state,event)};
    const live=new LiveWorkflow(db,state,{}, {readback:async()=>null,locationRestatement:async({turns})=>({turnId:turns.at(-1).id,value:'চট্টগ্রাম'}),confirmation:async context=>({decision:'CORRECTION',confidence:.99,evidence:context.reply})});
    await live.turn('caller','chotodam');await live.invoke({id:'bad',name:'propose_facts',args:{scope:'profile',facts:[{key:'location',value:'chotodam',raw:'chotodam'}]}});
    await live.turn('caller','আমার অবস্থান হচ্ছে চট্টগ্রাম।');const readback=await live.turn('assistant','আপনার অবস্থান হলো চট্টগ্রাম। এটি কি সঠিক?');await live.turn('caller',reply);
    await assert.rejects(live.invoke({id:'unplayed',name:'confirm_facts'}),/Read back/);
    await live.played(readback);await live.invoke({id:'refusal',name:'confirm_facts'});assert.equal(state.profile.location,undefined);
  }
});

test('read-back equivalence requires every field, grounded quotes and high confidence',async()=>{
  const context={readback:'আপনি চট্টগ্রাম জেলার রাঙ্গুনিয়াতে থাকেন, এটি কি ঠিক?',facts:[{key:'location',value:'rangunia, chittagong',raw:'আমি চট্টগ্রাম এলাকার রাঙ্গুনিয়াতে থাকি।'}]};
  const valid={decision:'EQUIVALENT',confidence:.99,fields:[{key:'location',evidence:'চট্টগ্রাম জেলার রাঙ্গুনিয়াতে'}]};
  assert.equal((await interpretReadback(context,async()=>valid)).fields[0].value,'rangunia, chittagong');
  for(const result of [{...valid,decision:'MISMATCH'},{...valid,decision:'UNCERTAIN'},{...valid,confidence:.9},{...valid,fields:[]},{...valid,fields:[{key:'name',evidence:'চট্টগ্রাম'}]},{...valid,fields:[{key:'location',evidence:'invented quote'}]}])assert.equal(await interpretReadback(context,async()=>result),null);
  assert.equal(await interpretReadback(context,async()=>{throw new Error('Unavailable');}),null);
  assert.equal(await interpretReadback({...context,facts:[{key:'phone',value:'+8801712345678'}]},async()=>{assert.fail('Phone comparison must stay deterministic');}),null);
});

test('English location proposal and Bangla read-back confirm on one yes after playback',async()=>{
  let state=newCase('operator'),checks=0;const db={get:async()=>state,apply:async(_,event)=>state=applyEvent(state,event)};
  for(const [key,value] of [['name','পরীক্ষক'],['phone','+8801712345678'],['serviceConsent',true]])state.profile[key]={key,value,status:'confirmed',confirmedBy:'previous-confirmation'};
  const live=new LiveWorkflow(db,state,{}, {readback:async context=>{checks++;assert.equal(context.facts[0].value,'rangunia, chittagong');return {decision:'EQUIVALENT',confidence:.99,fields:[{key:'location',value:'rangunia, chittagong',evidence:'চট্টগ্রাম জেলার রাঙ্গুনিয়াতে'}]};}});
  const source=await live.turn('caller','আমি চট্টগ্রাম এলাকার রাঙ্গুনিয়াতে থাকি।');
  await live.invoke({id:'location',name:'propose_facts',args:{scope:'profile',facts:[{key:'location',value:'rangunia, chittagong',raw:'আমি চট্টগ্রাম এলাকার রাঙ্গুনিয়াতে থাকি।'}]}});
  const readback=await live.turn('assistant','আপনি চট্টগ্রাম জেলার রাঙ্গুনিয়াতে থাকেন, এটি কি ঠিক?');
  await live.turn('caller','হ্যাঁ');await assert.rejects(live.invoke({id:'unplayed',name:'confirm_facts'}),/Read back/);
  await live.played(readback);assert.equal(state.pending.readbackTurn,readback);assert.equal(state.profile.location,undefined);
  await live.invoke({id:'mark-again',name:'mark_readback'});assert.equal(checks,1);
  const reply=await live.turn('caller','হ্যাঁ');await live.invoke({id:'one-yes',name:'confirm_facts'});
  assert.equal(state.profile.location.value,'rangunia, chittagong');assert.equal(state.profile.location.sourceTurn,source);assert.equal(state.profile.location.confirmedBy,reply);assert.equal(state.pending,null);
  const registered=await live.invoke({id:'register',name:'complete_registration'});assert.equal(registered.registrationComplete,true);assert.deepEqual(registered.registration.missingFields,[]);assert.equal(registered.registration.nextField,null);
});

test('raw wording cannot hide a missing location component or consent value',()=>{
  assert.equal(matchesReadback({key:'location',value:'rangunia, chittagong',raw:'চট্টগ্রাম'},'আপনি চট্টগ্রামে থাকেন, ঠিক?'),false);
  assert.equal(matchesReadback({key:'serviceConsent',value:true,raw:'ঠিক আছে'},'আপনি ঠিক আছে বলেছেন'),false);
});

test('unavailable semantic read-back checking stays pending and is cached for the same playback',async()=>{
  let state=newCase('operator'),checks=0;const db={get:async()=>state,apply:async(_,event)=>state=applyEvent(state,event)};
  const live=new LiveWorkflow(db,state,{}, {readback:async()=>{checks++;return null;}});
  await live.turn('caller','আমি চট্টগ্রামের রাঙ্গুনিয়াতে থাকি।');await live.invoke({id:'proposal',name:'propose_facts',args:{scope:'profile',facts:[{key:'location',value:'rangunia, chittagong',raw:'আমি চট্টগ্রামের রাঙ্গুনিয়াতে থাকি।'}]}});
  const delivered=await live.turn('assistant','আপনি চট্টগ্রামের রাঙ্গুনিয়াতে থাকেন, ঠিক?');await live.played(delivered);await live.invoke({id:'retry',name:'mark_readback'});
  assert.equal(checks,1);assert.equal(state.pending.readbackTurn,null);assert.equal(state.profile.location,undefined);
});

test('semantic read-back proof cannot bypass role, batch, turn or strict phone checks',()=>{
  let state=newCase('operator');const apply=event=>state=applyEvent(state,event);
  apply({id:'source',type:'turn',turnId:'caller',role:'caller',text:'আমি চট্টগ্রাম এলাকার রাঙ্গুনিয়াতে থাকি।'});
  apply({id:'proposal',type:'propose',scope:'profile',turnId:'caller',facts:[{key:'location',value:'rangunia, chittagong',raw:'আমি চট্টগ্রাম এলাকার রাঙ্গুনিয়াতে থাকি।'}]});
  apply({id:'assistant',type:'turn',turnId:'readback',role:'assistant',text:'আপনি চট্টগ্রাম জেলার রাঙ্গুনিয়াতে থাকেন, এটি কি ঠিক?'});
  const proof={batchId:'proposal',turnId:'readback',decision:'EQUIVALENT',confidence:.99,fields:[{key:'location',value:'rangunia, chittagong',evidence:'চট্টগ্রাম জেলার রাঙ্গুনিয়াতে'}]};
  const event={id:'read',type:'readback',batchId:'proposal',turnId:'readback',actor:'readback_interpreter',interpretation:proof};
  for(const invalid of [{...event,actor:'operator'},{...event,interpretation:{...proof,batchId:'stale'}},{...event,interpretation:{...proof,turnId:'other'}},{...event,interpretation:{...proof,fields:[{key:'location',value:'Dhaka',evidence:'চট্টগ্রাম'}]}}])assert.throws(()=>applyEvent(state,invalid),/all proposed values/);
  apply(event);assert.equal(state.pending.readbackTurn,'readback');assert.equal(state.profile.location,undefined);
  state=newCase('operator');apply({id:'phone-source',type:'turn',turnId:'caller',role:'caller',text:'01712345678'});apply({id:'phone-proposal',type:'propose',scope:'profile',turnId:'caller',facts:[{key:'phone',value:'01712345678',raw:'01712345678'}]});apply({id:'phone-assistant',type:'turn',turnId:'readback',role:'assistant',text:'আপনার নম্বর 01812345678'});
  assert.throws(()=>applyEvent(state,{...event,batchId:'phone-proposal',interpretation:{...proof,batchId:'phone-proposal',fields:[{key:'phone',value:'+8801712345678',evidence:'01812345678'}]}}),/all proposed values/);
});

test('natural affirmation commits only after read-back, while refusals, corrections and uncertainty never confirm',async()=>{
  for(const decision of ['AFFIRM','DENY','CORRECTION','UNCERTAIN']){
    let state=newCase('operator'),interpretations=0;
    const db={get:async()=>state,apply:async(_,event)=>state=applyEvent(state,event)};
    const live=new LiveWorkflow(db,state,{}, {confirmation:async context=>{interpretations++;assert.equal(context.readback,'আপনার এলাকা কুমিল্লা');assert.equal(context.fields[0].key,'location');return {decision,confidence:.99,evidence:context.reply};}});
    await live.turn('caller','কুমিল্লা');await live.invoke({id:'proposal',name:'propose_facts',args:{scope:'profile',facts:[{key:'location',value:'কুমিল্লা',raw:'কুমিল্লা'}]}});
    await live.turn('caller','সব তথ্য ঠিক, রেখে দেন');await assert.rejects(live.invoke({id:'early',name:'confirm_facts'}),/Read back/);assert.equal(interpretations,0);
    await live.played(await live.turn('assistant','আপনার এলাকা কুমিল্লা'));
    await live.turn('caller','সব তথ্য ঠিক, রেখে দেন');
    const result=await live.invoke({id:'confirmation',name:'confirm_facts'});
    assert.equal(interpretations,1);
    if(decision==='AFFIRM')assert.ok(state.profile.location.confirmedBy);
    else{assert.equal(state.profile.location,undefined);assert.equal(decision==='DENY'?state.pending===null:!!state.pending,true);}
    if(['CORRECTION','UNCERTAIN'].includes(decision))assert.equal(result.confirmation,decision);
  }
});
