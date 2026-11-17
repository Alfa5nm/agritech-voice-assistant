export const gateway='wss://ippbx.alaapcloud.gov.bd:4321/telco-ws';
export const proxy='sip:114.130.145.82:5060';
export function registration(extension,domain,password){
  if(!/^[0-9]+$/.test(extension)||!/^[a-zA-Z0-9.-]+$/.test(domain)||!password)throw new Error('Invalid account details');
  return {request:'register',username:`sip:${extension}@${domain}`,authuser:extension,display_name:`${extension}@${domain}`,secret:password,outbound_proxy:proxy,send_register:true};
}
// Only allowlisted diagnostics leave the client; never serialize provider messages.
export function diagnostic(event,values={}){
  const safe={time:new Date().toISOString(),event};
  for(const key of ['code','inboundBytes','outboundBytes','completedCalls'])if(Number.isFinite(values[key]))safe[key]=values[key];
  return safe;
}
export class AlaapClient{
  constructor({log=()=>{},status=()=>{},audio,microphone=()=>'',autoAnswer=()=>false,media=navigator.mediaDevices,Socket=WebSocket,Peer=RTCPeerConnection,iceServers=[]}={}){
    Object.assign(this,{log,status,audio,microphone,autoAnswer,media,Socket,Peer,iceServers});
    this.pending=new Map();this.registered=false;this.completedCalls=0;this.call=null;
  }
  report(event,data){this.log(diagnostic(event,data));}
  request(janus,extra={}){
    if(this.socket?.readyState!==1)return Promise.reject(new Error('Signalling disconnected'));
    const transaction=crypto.randomUUID();
    const message={janus,transaction,...(this.session?{session_id:this.session}:{}),...extra};
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(transaction);reject(new Error('Provider response timeout'));},15000);
      this.pending.set(transaction,{resolve,reject,timer,ackFinal:janus==='keepalive'||janus==='trickle'});
      try{this.socket.send(JSON.stringify(message));}catch{clearTimeout(timer);this.pending.delete(transaction);reject(new Error('Signalling send failed'));}
    });
  }
  message(body,jsep){return this.request('message',{handle_id:this.handle,body,...(jsep?{jsep}: {})});}
  async connect({token,extension,domain,password}){
    if(this.socket)throw new Error('Disconnect before reconnecting');
    const body=registration(extension,domain,password);
    if(!token.trim())throw new Error('Access token required');
    this.status('Connecting');
    try{
      const socket=this.socket=new this.Socket(`${gateway}?token=${encodeURIComponent(token.trim())}`,'janus-protocol');
      socket.onmessage=e=>{try{this.receive(JSON.parse(e.data));}catch{this.report('invalid_provider_message');}};
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{reject(new Error('WebSocket connection timeout'));socket.close();},15000);
        socket.onopen=()=>{clearTimeout(timer);resolve();};
        socket.onerror=()=>{clearTimeout(timer);reject(new Error('WebSocket failed: check token, expiry, network and TLS'));};
        socket.onclose=()=>{clearTimeout(timer);reject(new Error('WebSocket closed'));this.disconnect(false);};
      });
      this.report('websocket_authenticated');
      this.session=(await this.request('create')).data.id;this.report('session_created');
      this.handle=(await this.request('attach',{plugin:'janus.plugin.sip',opaque_id:`qa-${crypto.randomUUID()}`})).data.id;this.report('sip_plugin_attached');
      this.keepalive=setInterval(()=>this.request('keepalive').then(()=>this.report('keepalive_ack')).catch(()=>this.disconnect()),25000);
      this.registrationTimer=setTimeout(()=>{this.report('registration_timeout');this.disconnect();},20000);
      await this.message(body);
      if(!this.socket)throw new Error('SIP registration failed; check the redacted event log');
      if(!this.registered)this.status('Waiting for SIP registration');
    }catch(error){this.disconnect();throw error;}
  }
  receive(msg){
    const pending=this.pending.get(msg.transaction);
    if(pending&&(msg.janus!=='ack'||pending.ackFinal)){
      clearTimeout(pending.timer);this.pending.delete(msg.transaction);
      if(msg.janus==='error')pending.reject(new Error(`Provider error ${Number(msg.error?.code)||0}`));else pending.resolve(msg);
    }
    if(msg.janus==='timeout'){this.report('session_timeout');this.disconnect();return;}
    if(msg.janus==='trickle'&&msg.candidate&&this.call){
      const candidate=msg.candidate.completed?null:msg.candidate;
      if(this.call.remoteReady)this.call.pc.addIceCandidate(candidate).catch(()=>this.report('remote_ice_error'));
      else this.call.candidates.push(candidate);
    }
    if(msg.janus==='hangup'){this.endCall('media_hangup');return;}
    const data=msg.plugindata?.data;
    if(data?.error){this.report('sip_error',{code:Number(data.error_code)});this.status('SIP error: check credentials, realm or account conflict');this.disconnect();return;}
    const result=data?.result;
    if(!result)return;
    switch(result.event){
      case 'registered':clearTimeout(this.registrationTimer);this.registered=true;this.report('registered');this.status('Registered — ready for incoming calls');break;
      case 'registration_failed':{
        const code=Number(result.code);this.report('registration_failed',{code});
        this.disconnect();this.status(code===401||code===403?'Registration rejected: check credentials and realm':'Registration failed: check realm, proxy or extension conflict');break;
      }
      case 'incomingcall':
        this.report('incoming_call');
        if(this.call||!this.autoAnswer())this.message({request:'decline',code:this.call?486:603}).catch(()=>this.report('decline_failed'));
        else this.answer(msg.jsep);break;
      case 'accepted':this.report('call_accepted');break;
      case 'hangup':this.endCall('remote_hangup');break;
      case 'unregistered':this.disconnect();break;
    }
  }
  async answer(offer){
    const call=this.call={pc:null,stream:null,candidates:[],remoteReady:false,connected:false};
    this.status('Answering');
    try{
      if(offer?.type!=='offer'||typeof offer.sdp!=='string')throw new Error('Missing SDP offer');
      call.stream=await this.media.getUserMedia({audio:this.microphone()?{deviceId:{exact:this.microphone()},echoCancellation:true}:true,video:false});
      if(this.call!==call){call.stream.getTracks().forEach(t=>t.stop());return;}
      const pc=call.pc=new this.Peer({iceServers:this.iceServers,iceTransportPolicy:'relay'});
      call.stream.getTracks().forEach(t=>pc.addTrack(t,call.stream));
      pc.ontrack=e=>{this.audio.srcObject=e.streams[0]||new MediaStream([e.track]);this.audio.play().catch(()=>this.report('audio_playback_needs_click'));};
      call.localCandidates=[];call.acceptSent=false;
      pc.onicecandidate=e=>{const candidate=e.candidate?.toJSON()||{completed:true};if(call.acceptSent)this.sendCandidate(candidate);else call.localCandidates.push(candidate);};
      pc.onconnectionstatechange=()=>{
        if(this.call!==call)return;
        if(pc.connectionState==='connected'){call.connected=true;this.status('Call connected — check speech both ways');this.report('media_connected');}
        if(pc.connectionState==='failed'){this.report('media_failed');this.hangup();}
      };
      await pc.setRemoteDescription(offer);call.remoteReady=true;
      for(const candidate of call.candidates)await pc.addIceCandidate(candidate);
      await pc.setLocalDescription(await pc.createAnswer());
      if(this.call!==call)return;
      const accepted=this.message({request:'accept'},{type:'answer',sdp:pc.localDescription.sdp});
      call.acceptSent=true;for(const candidate of call.localCandidates)this.sendCandidate(candidate);
      await accepted;
      if(this.call!==call)return;
      call.statsTimer=setInterval(async()=>{
        try{
          let inboundBytes=0,outboundBytes=0;
          (await pc.getStats()).forEach(s=>{if(s.kind==='audio'||s.mediaType==='audio'){if(s.type==='inbound-rtp')inboundBytes+=s.bytesReceived||0;if(s.type==='outbound-rtp')outboundBytes+=s.bytesSent||0;}});
          this.report('audio_counters',{inboundBytes,outboundBytes});
        }catch{this.report('stats_unavailable');}
      },3000);
      call.mediaTimer=setTimeout(()=>{if(this.call===call&&!call.connected){this.report('media_connection_timeout');this.hangup();}},30000);
    }catch(error){
      if(this.call!==call)return;
      this.report(error.name==='NotAllowedError'?'microphone_denied':'answer_failed');
      this.message({request:call.remoteReady?'hangup':'decline',code:480}).catch(()=>{});
      this.endCall('answer_cleanup');this.status('Could not answer: check microphone permission and media connectivity');
    }
  }
  sendCandidate(candidate){this.request('trickle',{handle_id:this.handle,candidate}).catch(()=>this.report('ice_send_failed'));}
  hangup(){if(!this.call)return;this.message({request:'hangup'}).catch(()=>this.report('hangup_send_failed'));this.endCall('local_hangup');}
  endCall(event){
    const call=this.call;if(!call)return;this.call=null;
    call.stopVoice?.();
    call.stopBangla?.();
    clearInterval(call.statsTimer);clearTimeout(call.mediaTimer);
    if(call.pc){call.pc.onconnectionstatechange=null;call.pc.onicecandidate=null;call.pc.ontrack=null;call.pc.close();}
    call.stream?.getTracks().forEach(t=>t.stop());
    if(this.audio)this.audio.srcObject=null;
    if(call.connected)this.completedCalls++;
    this.report(event,{completedCalls:this.completedCalls});this.status(this.registered?'Registered — ready for next call':'Disconnected');
  }
  disconnect(close=true){
    clearInterval(this.keepalive);clearTimeout(this.registrationTimer);this.registered=false;this.endCall('connection_cleanup');
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Disconnected'));}this.pending.clear();
    const socket=this.socket;this.socket=null;this.session=null;this.handle=null;
    if(socket){socket.onclose=null;socket.onmessage=null;if(close)socket.close();}
    this.status('Disconnected — reconnect manually');this.report('disconnected');
  }
  async logout(){
    this.hangup();
    try{if(this.registered)await this.message({request:'unregister'});}catch{}finally{this.disconnect();}
  }
}
