import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import WebSocket from 'ws';
import {projectWorkspace} from './backend/workspace.js';
import {newCase} from './backend/workflow.js';
import {factEntries,transcriptParts,acceptSnapshot,sourceUrl,retrievalExplanation} from './workspace-state.js';
import {attachVertex} from './vertex.js';

test('workspace projection exposes only this case view and bounded transcript history',()=>{
  const state=newCase('private-owner',{synthetic:true});state.secret='never expose';state.metadata.accessToken='never expose';
  state.profile={name:{value:'Farmer',raw:'Farmer',sourceTurn:'caller-1',confirmedBy:'yes-1',status:'confirmed',secret:'never expose'}};
  state.turns=Array.from({length:100},(_,i)=>({id:'turn-'+i,role:'caller',text:'x'.repeat(3000),secret:'never expose'}));
  const view=projectWorkspace(state);
  assert.equal(view.profile.name.value,'Farmer');assert.equal(view.synthetic,true);assert.equal(view.turns.length,30);assert.equal(view.turns[0].text.length,2000);
  assert.ok(!JSON.stringify(view).includes('never expose'));assert.ok(!JSON.stringify(view).includes('private-owner'));
});

test('pending details do not become confirmed and highlights require the exact source turn',()=>{
  const state=newCase('operator');state.profile.name={value:'Old name',confirmedBy:'yes-1',status:'confirmed',raw:'Old name',sourceTurn:'old'};
  state.pending={scope:'profile',readbackTurn:'readback',facts:[{key:'name',value:'New name',raw:'New name',sourceTurn:'new'}]};
  const facts=factEntries(projectWorkspace(state)),fact=facts.find(f=>f.key==='name');
  assert.equal(fact.status,'proposed');assert.equal(fact.awaiting,true);assert.equal(fact.previous,'Old name');
  assert.equal(transcriptParts('New name','unrelated',facts).some(p=>p.key),false);
  assert.deepEqual(transcriptParts('My name is New name.','new',facts).map(p=>p.text),['My name is ','New name','.']);
  assert.equal(transcriptParts('My name is New name.','new',facts)[1].status,'proposed');
  const markup='<img src=x onerror=alert(1)>';
  assert.deepEqual(transcriptParts(markup,null,[]),[{text:markup}]);
});

test('workspace rejects stale or other-case snapshots and unsafe citation links',()=>{
  assert.equal(acceptSnapshot({version:5},{caseId:'one',version:4},'one'),false);
  assert.equal(acceptSnapshot({version:5},{caseId:'two',version:6},'one'),false);
  assert.equal(acceptSnapshot({version:5},{caseId:'one',version:6},'one'),true);
  for(const value of ['javascript:alert(1)','data:text/html,test','https://user:password@example.com','not-a-url'])assert.equal(sourceUrl(value),null);
  assert.equal(sourceUrl('https://example.com/rice'),'https://example.com/rice');
  assert.match(retrievalExplanation({kind:'REGISTRATION_REQUIRED'}),/Registration/);
  assert.match(retrievalExplanation({reason:'no_approved_evidence'}),/No approved evidence/);
});

test('workspace events report real tool failure, cancellation and authorised snapshots without raw arguments',async t=>{
  let callbacks,authorised=true;
  const state=newCase('operator'),server=createServer();
  const workflow={synthetic:true,authorized:()=>authorised,turn:async()=>undefined,played:async()=>{},cancel(){},close:async()=>{},workspace:async()=>projectWorkspace(state),invoke:async call=>{if(call.id==='fail')throw new Error('Persistence failed');if(call.id==='cancel')return {cancelled:true};return {kind:'REFER',reason:'no_approved_evidence',evidence:[]};}};
  const sockets=attachVertex(server,{backend:{openVoice:async()=>workflow},connect:async cb=>{callbacks=cb;return {close(){},sendToolResponse(){}};}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{for(const ws of sockets.clients)ws.terminate();sockets.close();await new Promise(resolve=>server.close(resolve));});
  const host='127.0.0.1:'+server.address().port;
  const ws=new WebSocket('ws://'+host+'/vertex?case='+state.id+'&workspace=1',{origin:'http://'+host});
  const messages=[];let wake;
  const observed=new Promise(resolve=>wake=resolve);
  ws.on('message',data=>{const message=JSON.parse(data);messages.push(message);if(message.workspace?.type==='tool'&&message.workspace.id==='cancel'&&message.workspace.status==='cancelled')wake();});
  await once(ws,'message');
  callbacks.onmessage({toolCall:{functionCalls:[{id:'fail',name:'complete_registration',args:{password:'private argument'}},{id:'ok',name:'retrieve_guidance',args:{}},{id:'cancel',name:'confirm_facts',args:{}}]}});
  await observed;
  assert.ok(messages.some(m=>m.workspace?.state?.caseId===state.id));
  assert.ok(messages.some(m=>m.workspace?.status==='failed'));
  assert.ok(messages.some(m=>m.workspace?.result?.reason==='no_approved_evidence'));
  assert.ok(!JSON.stringify(messages).includes('private argument'));
  authorised=false;const count=messages.length;
  callbacks.onmessage({toolCallCancellation:{ids:['late']}});
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(messages.length,count);
  ws.close();
});
