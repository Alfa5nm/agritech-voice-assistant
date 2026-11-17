import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AlaapClient,registration,diagnostic} from './client.js';
function fixture(overrides={}){
  const events=[],states=[];
  const client=new AlaapClient({log:e=>events.push(e),status:s=>states.push(s),audio:{srcObject:null},media:{},Socket:class{},Peer:class{},...overrides});
  return {client,events,states};
}
test('registration uses explicit proxy and original realm; validates input',()=>{
  const body=registration('227','pbx-manager.btcliptelephony.gov.bd','private');
  assert.equal(body.username,'sip:227@pbx-manager.btcliptelephony.gov.bd');
  assert.equal(body.display_name,'227@pbx-manager.btcliptelephony.gov.bd');
  assert.equal(body.outbound_proxy,'sip:114.130.145.82:5060');
  assert.throws(()=>registration('227\r\n','example.com','private'));
  assert.throws(()=>registration('227','sip:example.com','private'));
});
test('diagnostics exclude raw payloads, credentials, caller identity and SDP',()=>{
  const result=diagnostic('registered',{token:'sensitive',password:'sensitive',sdp:'sensitive',url:'sensitive',username:'sensitive',reason:'sensitive',inboundBytes:50});
  assert.deepEqual(Object.keys(result).sort(),['event','inboundBytes','time']);
  assert.ok(!JSON.stringify(result).includes('sensitive'));
});
test('ack does not complete transaction; final reply does',async()=>{
  const {client}=fixture();let sent;
  client.socket={readyState:1,send:s=>{sent=JSON.parse(s);}};
  client.session=12;
  const pending=client.request('attach',{plugin:'janus.plugin.sip'});
  assert.equal(sent.session_id,12);
  client.receive({janus:'ack',transaction:sent.transaction});assert.equal(client.pending.size,1);
  client.receive({janus:'success',transaction:sent.transaction,data:{id:44}});
  assert.equal((await pending).data.id,44);assert.equal(client.pending.size,0);
});
test('registered event and rejection set clear state',()=>{
  const {client,states}=fixture();
  client.receive({plugindata:{data:{result:{event:'registered'}}}});assert.equal(client.registered,true);
  client.receive({plugindata:{data:{result:{event:'registration_failed',code:403}}}});
  assert.equal(client.registered,false);assert.match(states.at(-1),/rejected/);
});
test('declines additional calls as busy and disabled auto-answer as declined',()=>{
  const {client}=fixture();const sent=[];client.message=body=>{sent.push(body);return Promise.resolve();};
  client.call={};client.receive({plugindata:{data:{result:{event:'incomingcall'}}}});
  client.call=null;client.receive({plugindata:{data:{result:{event:'incomingcall'}}}});
  assert.deepEqual(sent,[{request:'decline',code:486},{request:'decline',code:603}]);
});
test('call cleanup is idempotent and releases microphone, peer and audio',()=>{
  const {client,events}=fixture();let stopped=0,closed=0;
  client.registered=true;client.audio.srcObject={};
  client.call={connected:true,pc:{close:()=>closed++},stream:{getTracks:()=>[{stop:()=>stopped++}]}};
  client.endCall('remote_hangup');client.endCall('remote_hangup');
  assert.equal(stopped,1);assert.equal(closed,1);assert.equal(client.audio.srcObject,null);
  assert.equal(client.completedCalls,1);assert.equal(events.length,1);
});
test('microphone denial declines and resets the call',async()=>{
  const {client,events}=fixture({media:{getUserMedia:async()=>{throw Object.assign(new Error(),{name:'NotAllowedError'});}}});
  const sent=[];client.message=b=>{sent.push(b);return Promise.resolve();};
  await client.answer({type:'offer',sdp:'test'});
  assert.equal(client.call,null);assert.equal(sent[0].request,'decline');
  assert.ok(events.some(e=>e.event==='microphone_denied'));
});
test('hangup during permission prompt stops late microphone stream',async()=>{
  let resolve,stopped=0;const media={getUserMedia:()=>new Promise(r=>resolve=r)};
  const {client}=fixture({media});const answering=client.answer({type:'offer',sdp:'test'});
  client.endCall('remote_hangup');resolve({getTracks:()=>[{stop:()=>stopped++}]});
  await answering;assert.equal(stopped,1);assert.equal(client.call,null);
});
test('disconnect rejects pending requests and closes signalling',async()=>{
  const {client}=fixture();let closed=0;
  client.socket={readyState:1,send:()=>{},close:()=>closed++};
  const pending=client.request('create');client.disconnect();
  await assert.rejects(pending,/Disconnected/);assert.equal(client.pending.size,0);assert.equal(closed,1);assert.equal(client.socket,null);
});
test('keepalive and ICE transactions finish on ack without false timeout',async()=>{
  const {client}=fixture();let sent;
  client.socket={readyState:1,send:s=>{sent=JSON.parse(s);}};
  for(const type of ['keepalive','trickle']){
    const pending=client.request(type);
    client.receive({janus:'ack',transaction:sent.transaction});
    assert.equal((await pending).janus,'ack');assert.equal(client.pending.size,0);
  }
});
test('answered calls exchange SDP/ICE, then support successive remote and local hangups',async()=>{
  const peers=[],sent=[];let stopped=0;
  class Peer{
    constructor(config){assert.equal(config.iceTransportPolicy,'relay');peers.push(this);}
    addTrack(){}
    async setRemoteDescription(offer){assert.equal(offer.type,'offer');}
    async createAnswer(){return {type:'answer',sdp:'local-test-sdp'};}
    async setLocalDescription(answer){this.localDescription=answer;this.onicecandidate({candidate:null});}
    close(){this.closed=true;}
  }
  const {client}=fixture({Peer,autoAnswer:()=>true,media:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>stopped++}]})}});
  client.registered=true;client.handle=2;
  client.message=async(body,jsep)=>{sent.push({body,jsep});};
  client.request=async(type,extra)=>{sent.push({type,...extra});};
  for(let i=0;i<2;i++){
    await client.answer({type:'offer',sdp:'remote-test-sdp'});
    peers[i].connectionState='connected';peers[i].onconnectionstatechange();
    if(i===0)client.receive({plugindata:{data:{result:{event:'hangup'}}}});else client.hangup();
    assert.equal(client.call,null);assert.equal(peers[i].closed,true);
  }
  assert.equal(client.completedCalls,2);assert.equal(stopped,2);
  assert.equal(sent[0].body.request,'accept');assert.equal(sent[0].jsep.type,'answer');
  assert.equal(sent[1].type,'trickle');assert.deepEqual(sent[1].candidate,{completed:true});
});
