import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('restored operator login connects the telephone once; logout cancels pending connection',async()=>{
  const code=(await readFile(new URL('app.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
  const listeners={},elements=new Map(),calls=[],events=[],voiceStarts=[];
  const node=id=>{if(!elements.has(id))elements.set(id,{value:'',checked:false,textContent:'',scrollHeight:0});return elements.get(id);};
  let release,hold=false;
  class Client{constructor(){this.socket=null;}async connect(credentials){calls.push(credentials);this.socket={};}async logout(){this.socket=null;calls.push('logout');}disconnect(){}}
  runInNewContext(code,{AlaapClient:Client,diagnostic:()=>{},startVoice:(...args)=>voiceStarts.push(args),CustomEvent:class{constructor(type,{detail}){Object.assign(this,{type,detail});}},location:{search:''},URLSearchParams,document:{body:{dataset:{}},getElementById:node,addEventListener:(name,handler)=>listeners[name]=handler,dispatchEvent:event=>events.push(event)},window:{addEventListener:()=>{}},fetch:async url=>{
    if(url==='/api/telephone'&&hold)await new Promise(resolve=>release=resolve);
    return {ok:true,json:async()=>url==='/ice-config'?{iceServers:[]}:{token:'private',extension:'227',domain:'example.invalid',password:'secret'}};
  }});
  await listeners['agritech-auth']({detail:{signedIn:true}});assert.equal(calls.length,1);assert.equal(calls[0].extension,'227');
  await listeners['agritech-auth']({detail:{signedIn:true}});assert.equal(calls.length,1);
  await listeners['agritech-auth']({detail:{signedIn:false}});assert.equal(calls[1],'logout');
  hold=true;const pending=listeners['agritech-auth']({detail:{signedIn:true}});
  await listeners['agritech-auth']({detail:{signedIn:false}});release();await pending;
  assert.equal(calls.length,3);assert.equal(calls[2],'logout');
  node('start-voice').onclick();assert.equal(voiceStarts.length,0);assert.equal(events.at(-1).detail.type,'case_required');
  listeners['agritech-case']({detail:{caseId:'selected-case',synthetic:true}});
  node('start-voice').onclick();assert.equal(voiceStarts.length,1);assert.equal(voiceStarts[0][4].caseId,'selected-case');assert.equal(voiceStarts[0][4].provider,'vertex');assert.equal(voiceStarts[0][4].synthetic,true);
});
