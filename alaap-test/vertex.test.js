import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import WebSocket from 'ws';
import {attachVertex,connectVertex} from './vertex.js';
import {pcm16,decodePcm,startVoice} from './voice.js';

async function fixture(t,connect){
  const server=createServer();
  const sockets=attachVertex(server,{connect});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{for(const socket of sockets.clients)socket.terminate();sockets.close();await new Promise(resolve=>server.close(resolve));});
  const host='127.0.0.1:'+server.address().port;
  return {url:'ws://'+host+'/vertex',origin:'http://'+host};
}

test('Vertex cycles regions with backoff and waits for audio before reporting readiness',async()=>{
  const regions=[],delays=[],events=[],closed=[];
  let activeCallbacks;
  const session=await connectVertex({onmessage:m=>events.push(m),onretry:e=>events.push(e)}, {
    locations:['us-central1','us-east1','us-west1'],wait:async ms=>delays.push(ms),
    open:async(callbacks,{location})=>{
      regions.push(location);activeCallbacks=callbacks;
      return {
        sendClientContent:()=>queueMicrotask(()=>{
          if(location!=='us-west1')callbacks.onclose({reason:'Resource exhausted'});
          else callbacks.onmessage({serverContent:{modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:'AAAA'}}]}}});
        }),close:()=>closed.push(location),sendRealtimeInput(){},sendToolResponse(){},
      };
    },
  });
  assert.deepEqual(regions,['us-central1','us-east1','us-west1']);
  assert.deepEqual(delays,[2000,4000]);
  assert.deepEqual(closed,['us-central1','us-east1']);
  assert.equal(events.filter(e=>e.serverContent).length,0);
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(events.filter(e=>e.serverContent).length,1);
  activeCallbacks.onmessage({serverContent:{turnComplete:true}});
  assert.equal(events.filter(e=>e.serverContent).length,2);
  session.close();
});

test('Vertex does not cycle credentials on permission errors or retry after cancellation',async()=>{
  let opened=0;
  await assert.rejects(connectVertex({}, {open:async()=>{opened++;throw new Error('Permission denied');},wait:async()=>assert.fail('Must not retry permission errors')}),/Permission denied/);
  assert.equal(opened,1);
  const controller=new AbortController();let closed=0;
  await assert.rejects(connectVertex({}, {signal:controller.signal,open:async()=>{controller.abort();return {close:()=>closed++};}}),/cancelled/);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(closed,1);
});

test('Vertex stops after three exhausted startup attempts',async()=>{
  let opened=0;
  await assert.rejects(connectVertex({}, {locations:['us-central1','us-east1','us-west1'],wait:async()=>{},open:async()=>{opened++;throw new Error('Resource exhausted');}}),/Resource exhausted/);
  assert.equal(opened,3);
});

test('Gemini synthetic voice uses its own provider without regional or key cycling',async()=>{
  let attempts=0;
  await assert.rejects(connectVertex({}, {provider:'gemini',open:async(_callbacks,options)=>{
    attempts++;assert.equal(options.provider,'gemini');assert.equal(options.workflow,false);throw new Error('Resource exhausted');
  },wait:async()=>assert.fail('Must not cycle free-tier keys')}),/Resource exhausted/);
  assert.equal(attempts,1);
  await assert.rejects(connectVertex({}, {provider:'gemini',workflow:true}),/cannot use registered farmer cases/);
  await assert.rejects(connectVertex({}, {provider:'unknown'}),/Invalid voice provider/);
});

test('Gemini provider rejects registered cases and unknown providers before connecting',async t=>{
  const {url,origin}=await fixture(t,()=>assert.fail('Invalid provider request must not connect'));
  for(const query of ['?provider=gemini&case=private-case','?provider=unknown']){
    const ws=new WebSocket(url+query,{origin});
    assert.match((await once(ws,'error'))[0].message,/403/);
  }
});

test('Gemini synthetic provider reaches the connector without credentials in the client URL',async t=>{
  const {url,origin}=await fixture(t,async(_callbacks,options)=>{
    assert.equal(options.provider,'gemini');assert.equal(options.workflow,false);
    return {close(){}};
  });
  const ws=new WebSocket(url+'?provider=gemini',{origin});
  assert.deepEqual(JSON.parse((await once(ws,'message'))[0]),{ready:true});
  ws.close();
});

test('registered farmer cases cannot start free-tier audio resources in the client',async()=>{
  const status={};await startVoice(null,{},status,{}, {provider:'gemini',caseId:'private-case'});
  assert.match(status.textContent,/explicitly synthetic case/);
});

test('synthetic registration can execute startup tools before the first audio without deadlocking',async()=>{
  let upstream,toolReceived=false,greeting='';
  const audio={serverContent:{modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:'AAAA'}}]}}};
  const session=await connectVertex({
    onstartup:value=>upstream=value,
    onmessage:message=>{if(message.toolCall){toolReceived=true;upstream.sendToolResponse({});}},
  },{provider:'gemini',workflow:true,synthetic:true,open:async(callbacks,options)=>{
    assert.equal(options.workflow,true);assert.equal(options.provider,'gemini');
    return {close(){},sendClientContent:value=>{greeting=value.turns[0].parts[0].text;queueMicrotask(()=>callbacks.onmessage({toolCall:{functionCalls:[{id:'status',name:'case_status'}]}}));},sendToolResponse:()=>queueMicrotask(()=>callbacks.onmessage(audio))};
  }});
  assert.equal(toolReceived,true);assert.match(greeting,/Assalamu alaikum/);assert.match(greeting,/case_status/);
  session.close();
});

test('synthetic registration routing uses backend authorization, not a caller query flag',async t=>{
  const server=createServer();let checked=false;
  const sockets=attachVertex(server,{backend:{openVoice:async(_req,id,options)=>{checked=true;assert.equal(id,'real-case');assert.equal(options.provider,'gemini');throw new Error('Not synthetic');}},connect:()=>assert.fail('Unauthorized profile must not reach Google')});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{sockets.close();await new Promise(resolve=>server.close(resolve));});
  const host='127.0.0.1:'+server.address().port;
  const ws=new WebSocket('ws://'+host+'/vertex?provider=gemini&case=real-case&synthetic=1',{origin:'http://'+host});
  assert.match((await once(ws,'error'))[0].message,/401/);assert.equal(checked,true);
});

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
  const output=new Promise(resolve=>{const listener=data=>{const message=JSON.parse(data);if(message.input){ws.off('message',listener);resolve(message);}};ws.on('message',listener);});
  callbacks.onmessage({serverContent:{inputTranscription:{text:'ধান'},outputTranscription:{text:'কোন সমস্যা?'},interrupted:true,modelTurn:{parts:[{text:'private reasoning'},{inlineData:{data:'AAAA',mimeType:'audio/pcm;rate=24000'}}]}}});
  const message=await output;
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

test('Vertex explains exhausted capacity without exposing upstream details',async t=>{
  let callbacks;
  const {url,origin}=await fixture(t,async cb=>{
    callbacks=cb;
    return {sendClientContent(){},close(){}};
  });
  const ws=new WebSocket(url,{origin});
  await once(ws,'message');
  const failure=once(ws,'message');
  callbacks.onclose({code:1011,reason:'Resource exhausted. Please try again later. private upstream details'});
  assert.deepEqual(JSON.parse((await failure)[0]),{error:'Vertex is temporarily out of capacity or quota; wait a minute and start AI voice again'});
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

test('an interrupted assistant turn cannot acknowledge a delayed read-back',async t=>{
  let callbacks,finishTurn;
  const workflow={authorized:()=>true,turn:async(role,text)=>role==='assistant'&&text?new Promise(resolve=>finishTurn=resolve):undefined,close:async()=>{}};
  const server=createServer(),sockets=attachVertex(server,{backend:{openVoice:async()=>workflow},connect:async value=>{callbacks=value;return {close(){},sendRealtimeInput(){}};}});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{for(const socket of sockets.clients)socket.terminate();sockets.close();await new Promise(resolve=>server.close(resolve));});
  const host='127.0.0.1:'+server.address().port,ws=new WebSocket('ws://'+host+'/vertex?case=test',{origin:'http://'+host}),received=[];
  ws.on('message',data=>received.push(JSON.parse(data)));await once(ws,'message');
  callbacks.onmessage({serverContent:{outputTranscription:{text:'unfinished read-back'},turnComplete:true}});
  callbacks.onmessage({serverContent:{interrupted:true}});
  finishTurn('interrupted-turn');await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(!received.some(message=>message.assistantTurnId==='interrupted-turn'));
});

test('AI voice routes both audio directions, interrupts playback and restores the microphone on stop',async t=>{
  let socket,node,context,playbackStops=0,contextClosed=0,lastSource;const filters=[];
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
    createBiquadFilter(){const filter={frequency:{value:0},connect:value=>value,disconnect(){this.closed=true;}};filters.push(filter);return filter;}
    createBuffer(_channels,length,rate){return {duration:length/rate,copyToChannel(){}};}
    createBufferSource(){return lastSource={connect(){},disconnect(){},start(){},stop(){playbackStops++;}};}
  };
  globalThis.AudioWorkletNode=class{constructor(){node=this;this.port={};}connect(){}disconnect(){}};
  globalThis.WebSocket=class{
    constructor(){socket=this;this.readyState=1;this.bufferedAmount=0;}
    send(data){sent.push(data);}
    close(){this.readyState=3;}
  };
  const sender={track:microphone,replaceTrack:async track=>replaced.push(track)};
  const call={connected:true,pc:{getSenders:()=>[sender]}};
  const status={},transcript={},observed=[];
  await startVoice(call,{srcObject:{getAudioTracks:()=>[{}]}},status,transcript,{onEvent:event=>observed.push(event)});
  await socket.onmessage({data:'{"ready":true}'});
  assert.equal(replaced[0],generated);
  assert.deepEqual(filters.map(filter=>[filter.type,filter.frequency.value]),[['highpass',100],['lowpass',7000]]);
  node.port.onmessage({data:new Float32Array([0.5,-0.5])});
  assert.equal(sent[0].byteLength,4);
  assert.equal(observed.find(e=>e.type==='level'&&e.speaker==='caller').level,0.5);
  await socket.onmessage({data:JSON.stringify({audio:[{data:'AAAAAA==',mimeType:'audio/pcm;rate=24000'}],input:'ধান',output:'বলুন'})});
  assert.match(transcript.textContent,/Caller: ধান/);assert.match(transcript.textContent,/AI: বলুন/);
  assert.ok(observed.some(e=>e.type==='transcript'&&e.speaker==='caller'&&e.text==='ধান'));
  await socket.onmessage({data:'{"interrupted":true}'});assert.equal(playbackStops,1);
  await socket.onmessage({data:JSON.stringify({assistantTurnId:'readback-1',audio:[{data:'AAAAAA==',mimeType:'audio/pcm;rate=24000'}]})});
  assert.ok(!sent.some(value=>typeof value==='string'&&value.includes('readback-1')));
  lastSource.onended();assert.ok(sent.some(value=>value==='{"type":"played","turnId":"readback-1"}'));
  const stop=call.stopVoice;stop();stop();
  assert.equal(contextClosed,1);assert.equal(socket.readyState,3);assert.equal(call.stopVoice,undefined);
  assert.ok(filters.every(filter=>filter.closed));
  assert.equal(replaced.at(-1),microphone);
  assert.ok(observed.some(e=>e.type==='voice'&&e.state==='idle'));
  assert.ok(observed.filter(e=>e.type==='voice').every(e=>e.provider==='vertex'));
  assert.ok(context);
});
