import {test} from 'node:test';
import assert from 'node:assert/strict';
import {transcriptQuality,ResponseDeadline} from './speech-guard.js';
import {LiveWorkflow} from './backend/tools.js';
import {newCase,applyEvent} from './backend/workflow.js';
import {liveAudioConfig} from './vertex.js';
import {interpretConfirmation} from './backend/confirmation.js';

test('speech guard rejects non-speech and script drift while preserving Bangla dialects, Roman Bangla and numbers',()=>{
  for(const value of ['[cough]','<noise>','...', 'কাশি','जी जी करें','جی جی کریں','অঅঅঅঅঅঅঅঅ','hello hello hello hello hello'])assert.equal(transcriptQuality(value).usable,false,value);
  for(const value of ['জি করান','ঠিকই কইছেন ভাই','Amar nam porikkhok','yes, that is correct','০১৭১২৩৪৫৬৭৮','<noise> আমার নাম পরীক্ষক <noise>'])assert.equal(transcriptQuality(value).usable,true,value);
  for(const value of ['শোনা যাচ্ছে না','অস্পষ্ট','জি জি জি জি জি','না না না না না'])assert.equal(transcriptQuality(value).usable,true,value);
  assert.equal(transcriptQuality('<noise> হ্যাঁ',{confirmation:true}).usable,false);
  assert.equal(transcriptQuality('জি',{confirmation:true}).usable,true);
  const config=liveAudioConfig();assert.equal(config.proactivity.proactiveAudio,true);assert.equal(config.realtimeInputConfig.automaticActivityDetection.startOfSpeechSensitivity,'START_SENSITIVITY_LOW');
  assert.deepEqual(config.inputAudioTranscription.languageCodes,['bn-BD']);assert.deepEqual(liveAudioConfig('gemini').inputAudioTranscription,{});
});

test('noise cannot fall back to an older caller answer or reach contextual confirmation',async()=>{
  let state=newCase('operator'),inferences=0;
  const live=new LiveWorkflow({get:async()=>state,apply:async(_,event)=>state=applyEvent(state,event)},state,{}, {confirmation:async()=>{inferences++;return {decision:'AFFIRM'};}});
  await live.turn('caller','হ্যাঁ');
  const count=state.turns.length;
  assert.equal(await live.turn('caller','[cough]'),undefined);assert.equal(state.turns.length,count);
  await assert.rejects(live.invoke({id:'noise-proposal',name:'propose_facts',args:{scope:'profile',facts:[{key:'serviceConsent',value:true,raw:'হ্যাঁ'}]}}),/speech is unclear/);
  await assert.rejects(live.invoke({id:'noise-confirm',name:'confirm_facts'}),/speech is unclear/);assert.equal(inferences,0);
  await live.turn('caller','পরীক্ষক');
  await live.invoke({id:'clear',name:'propose_facts',args:{scope:'profile',facts:[{key:'name',value:'পরীক্ষক',raw:'পরীক্ষক'}]}});assert.equal(state.pending.facts[0].value,'পরীক্ষক');
  const result=await interpretConfirmation({reply:'جی جی',readback:'তথ্য ঠিক আছে?',fields:[]},async()=>{throw new Error('Must not classify wrong-script audio');});assert.equal(result.reason,'unexpected_script');
});

test('response deadlines warn, expire, reset on activity and release timers on cleanup',()=>{
  let now=0,id=0;const timers=new Map(),events=[];
  const clock=new ResponseDeadline(event=>events.push(event),{now:()=>now,setTimer:(work,delay)=>{timers.set(++id,{work,at:now+delay});return id;},clearTimer:key=>timers.delete(key)});
  const advance=ms=>{const target=now+ms;while(true){const next=[...timers].filter(([,timer])=>timer.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].work();}now=target;};
  clock.start();advance(3999);assert.equal(events.length,0);advance(1);assert.equal(events[0].state,'slow');
  clock.start();advance(4000);assert.equal(events.at(-1).state,'slow');advance(8000);assert.equal(events.at(-1).state,'timeout');assert.equal(events.at(-1).elapsedMs,12000);assert.equal(timers.size,0);
  const count=events.length;clock.start();clock.clear();advance(15000);assert.equal(events.length,count);assert.equal(timers.size,0);
});

test('confirmation interpretation has a real three-second bound even if an upstream promise hangs',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const result=interpretConfirmation({reply:'সব তথ্য ঠিক, রেখে দেন',readback:'এলাকা কুমিল্লা',fields:[]},()=>new Promise(()=>{}));
  t.mock.timers.tick(3000);assert.equal((await result).reason,'interpretation_unavailable');
});
