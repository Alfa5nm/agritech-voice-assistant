import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import WebSocket from 'ws';
import {attachVertex} from './vertex.js';
import {pcm16,decodePcm,startVoice} from './voice.js';

async function fixture(t,connect){
  const server=createServer();
  const sockets=attachVertex(server,{connect});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{for(const socket of sockets.clients)socket.terminate();sockets.close();await new Promise(resolve=>server.close(resolve));});
  const host='127.0.0.1:'+server.address().port;
  return {url:'ws://'+host+'/vertex',origin:'http://'+host};
}

test('PCM audio clamps samples and preserves little-endian speech values',()=>{
  const bytes=pcm16(new Float32Array([-2,-0.5,0,0.5,2]));
  assert.deepEqual([...decodePcm(Buffer.from(bytes).toString('base64'))],[-32767/32768,-16383/32768,0,16384/32768,32767/32768]);
  assert.throws(()=>decodePcm('AA=='),/Invalid/);
});

test('Vertex rejects cross-site connections before opening a Google session',async t=>{
  let connected=false;
  const {url}=await fixture(t,()=>{connected=true;});
  const ws=new WebSocket(url,{origin:'https://other.example'});
  const [error]=await once(ws,'error');
  assert.match(error.message,/403/);assert.equal(connected,false);
});

test('Vertex streams PCM and captions, rejects concurrent AI sessions and closes upstream',async t=>{
  let callbacks,received,closed=0,upstreamClosed;
  const finished=new Promise(resolve=>upstreamClosed=resolve);
  const audioReceived=new Promise(resolve=>received=resolve);
  const {url,origin}=await fixture(t,async cb=>{
    callbacks=cb;
    return {sendRealtimeInput:received,sendClientContent:()=>{},close:()=>{closed++;upstreamClosed();}};
  });
  const ws=new WebSocket(url,{origin});
  assert.deepEqual(JSON.parse((await once(ws,'message'))[0]),{ready:true});
  const second=new WebSocket(url,{origin});
  assert.match((await once(second,'error'))[0].message,/409/);
  ws.send(Buffer.from([0,0,1,0]));
  assert.deepEqual(await audioReceived,{audio:{data:'AAABAA==',mimeType:'audio/pcm;rate=16000'}});
  const output=once(ws,'message');
  callbacks.onmessage({serverContent:{inputTranscription:{text:'ধান'},outputTranscription:{text:'কোন সমস্যা?'},interrupted:true,modelTurn:{parts:[{text:'private reasoning'},{inlineData:{data:'AAAA',mimeType:'audio/pcm;rate=24000'}}]}}});
  const message=JSON.parse((await output)[0]);
  assert.equal(message.input,'ধান');assert.equal(message.interrupted,true);assert.equal(message.audio.length,1);
  assert.ok(!JSON.stringify(message).includes('private reasoning'));
  ws.close();await finished;assert.equal(closed,1);
});

test('Vertex rejects invalid audio and closes a session that finishes connecting after cancellation',async t=>{
  let resolve,closed=0;
  const {url,origin}=await fixture(t,()=>new Promise(done=>resolve=done));
  const ws=new WebSocket(url,{origin});await once(ws,'open');
  const error=once(ws,'message');ws.send('untrusted configuration');
  assert.match(JSON.parse((await error)[0]).error,/Invalid/);
  await once(ws,'close');
  resolve({close:()=>closed++});await new Promise(done=>setImmediate(done));
  assert.equal(closed,1);
});

test('AI voice requires an active call before creating audio or network resources',async()=>{
  const status={};await startVoice(null,{srcObject:null},status,{});
  assert.equal(status.textContent,'Connect a phone call first');
});

test('registered case voice binds backend tools to the authenticated workflow',async t=>{
  let callbacks,reply,invoked,closed=false,finishClose;
  const workflowClosed=new Promise(resolve=>finishClose=resolve);
  const answered=new Promise(resolve=>reply=resolve);
  const workflow={authorized:()=>true,turn:async()=>undefined,cancel(){},played:async()=>{},invoke:async call=>{invoked=call;return {status:'INCOMPLETE'};},close:async()=>{closed=true;finishClose();}};
  const server=createServer();
  const sockets=attachVertex(server,{backend:{openVoice:async(_req,id)=>{assert.equal(id,'test-case');return workflow;}},connect:async cb=>{callbacks=cb;return {close(){},sendClientContent(){},sendToolResponse:reply,sendRealtimeInput(){}};}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{for(const socket of sockets.clients)socket.terminate();sockets.close();await new Promise(resolve=>server.close(resolve));});
  const host='127.0.0.1:'+server.address().port;
  const ws=new WebSocket('ws://'+host+'/vertex?case=test-case',{origin:'http://'+host});
  await once(ws,'message');
  callbacks.onmessage({toolCall:{functionCalls:[{id:'tool-1',name:'case_status',args:{}}]}});
  assert.deepEqual(await answered,{functionResponses:[{id:'tool-1',name:'case_status',response:{status:'INCOMPLETE'}}]});
  assert.equal(invoked.name,'case_status');
  ws.close();await workflowClosed;assert.equal(closed,true);
});

test('AI voice routes both audio directions, interrupts playback and restores the microphone on stop',async t=>{
  let socket,node,context,playbackStops=0,contextClosed=0;
  const microphone={kind:'audio'},generated={},replaced=[],sent=[];
  const originals=new Map(['AudioContext','AudioWorkletNode','WebSocket','location'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  t.after(()=>{for(const [key,descriptor] of originals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
  globalThis.location={host:'127.0.0.1:8765'};
  globalThis.AudioContext=class{
    constructor(){context=this;this.currentTime=0;this.audioWorklet={addModule:async()=>{}};}
    async resume(){}
    async close(){contextClosed++;}
    createMediaStreamDestination(){return {stream:{getAudioTracks:()=>[generated]}};}
    createMediaStreamSource(){return {connect:value=>value,disconnect(){}};}
    createBuffer(_channels,length,rate){return {duration:length/rate,copyToChannel(){}};}
    createBufferSource(){return {connect(){},disconnect(){},start(){},stop(){playbackStops++;}};}
  };
  globalThis.AudioWorkletNode=class{constructor(){node=this;this.port={};}connect(){}disconnect(){}};
  globalThis.WebSocket=class{
    constructor(){socket=this;this.readyState=1;this.bufferedAmount=0;}
    send(data){sent.push(data);}
    close(){this.readyState=3;}
  };
  const sender={track:microphone,replaceTrack:async track=>replaced.push(track)};
  const call={connected:true,pc:{getSenders:()=>[sender]}};
  const status={},transcript={};
  await startVoice(call,{srcObject:{getAudioTracks:()=>[{}]}},status,transcript);
  await socket.onmessage({data:'{"ready":true}'});
  assert.equal(replaced[0],generated);
  node.port.onmessage({data:new Float32Array([0.5,-0.5])});
  assert.equal(sent[0].byteLength,4);
  await socket.onmessage({data:JSON.stringify({audio:[{data:'AAAAAA==',mimeType:'audio/pcm;rate=24000'}],input:'ধান',output:'বলুন'})});
  assert.match(transcript.textContent,/Caller: ধান/);assert.match(transcript.textContent,/AI: বলুন/);
  await socket.onmessage({data:'{"interrupted":true}'});assert.equal(playbackStops,1);
  const stop=call.stopVoice;stop();stop();
  assert.equal(contextClosed,1);assert.equal(socket.readyState,3);assert.equal(call.stopVoice,undefined);
  assert.equal(replaced.at(-1),microphone);
  assert.ok(context);
});
