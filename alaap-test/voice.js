export function pcm16(samples){
  const buffer=new ArrayBuffer(samples.length*2),view=new DataView(buffer);
  samples.forEach((sample,index)=>view.setInt16(index*2,Math.round(Math.max(-1,Math.min(1,sample))*32767),true));
  return buffer;
}

export function decodePcm(data){
  const bytes=Uint8Array.from(atob(data),char=>char.charCodeAt(0));
  if(!bytes.length||bytes.length%2)throw new Error('Invalid Vertex audio');
  const view=new DataView(bytes.buffer),samples=new Float32Array(bytes.length/2);
  samples.forEach((_,index)=>{samples[index]=view.getInt16(index*2,true)/32768;});
  return samples;
}

export async function startVoice(call,audio,status,transcript,{caseId=null}={}){
  if(call?.stopVoice)return;
  const stream=audio.srcObject;
  const sender=call?.pc?.getSenders().find(s=>s.track?.kind==='audio');
  if(!call?.connected||!stream?.getAudioTracks().length||!sender){
    status.textContent='Connect a phone call first';return;
  }
  const microphone=sender.track,context=new AudioContext({sampleRate:16000});
  const sources=new Set(),lines=[];
  let socket,node,input,stopped=false,ready=false,nextTime=0,lastSpeaker='',playedTurn=null;
  const acknowledge=()=>{if(playedTurn&&!sources.size&&ready&&socket.readyState===1){socket.send(JSON.stringify({type:'played',turnId:playedTurn}));playedTurn=null;}};
  const flush=()=>{
    for(const source of sources){source.onended=null;try{source.stop();}catch{}source.disconnect();}
    sources.clear();playedTurn=null;nextTime=context.currentTime;
  };
  const stop=(message='Vertex AI voice stopped')=>{
    if(stopped)return;
    stopped=true;ready=false;socket?.close();node?.disconnect();input?.disconnect();flush();
    context.close().catch(()=>{});sender.replaceTrack(microphone).catch(()=>{});
    delete call.stopVoice;status.textContent=message;
  };
  const caption=(speaker,text)=>{
    if(!text)return;
    if(lastSpeaker===speaker)lines[lines.length-1]+=text;
    else{lines.push(speaker+': '+text);lastSpeaker=speaker;}
    if(lines.length>100)lines.shift();
    transcript.textContent=lines.join('\n');
  };
  call.stopVoice=stop;status.textContent='Connecting Vertex AI voice';transcript.textContent='';
  try{
    await context.resume();
    await context.audioWorklet.addModule('/bangla-pcm.js');
    if(stopped)return;
    const destination=context.createMediaStreamDestination();
    node=new AudioWorkletNode(context,'phone-pcm');
    socket=new WebSocket('ws://'+location.host+'/vertex'+(caseId?'?case='+encodeURIComponent(caseId):''));
    node.port.onmessage=({data})=>{
      if(!ready||stopped||socket.readyState!==1)return;
      if(socket.bufferedAmount>64000){stop('Vertex upload fell behind; restart AI voice');return;}
      socket.send(pcm16(data));
    };
    socket.onmessage=async({data})=>{
      if(stopped)return;
      try{
        const message=JSON.parse(data);
        if(message.error){stop(message.error);return;}
        if(message.ready){
          await sender.replaceTrack(destination.stream.getAudioTracks()[0]);
          if(stopped){sender.replaceTrack(microphone).catch(()=>{});return;}
          input=context.createMediaStreamSource(stream);
          input.connect(node).connect(context.destination);
          ready=true;status.textContent='Vertex AI voice connected';
        }
        if(message.interrupted)flush();
        if(message.workflowError)status.textContent=message.workflowError;
        if(message.assistantTurnId){playedTurn=message.assistantTurnId;acknowledge();}
        caption('Caller',message.input);caption('AI',message.output);
        for(const audio of message.audio||[]){
          const samples=decodePcm(audio.data);
          const rate=Number(audio.mimeType.match(/rate=(\d+)/)?.[1]||24000);
          const buffer=context.createBuffer(1,samples.length,rate);
          buffer.copyToChannel(samples,0);
          const source=context.createBufferSource();source.buffer=buffer;source.connect(destination);
          nextTime=Math.max(context.currentTime,nextTime);
          if(nextTime-context.currentTime>30)throw new Error('Audio playback fell behind');
          sources.add(source);source.onended=()=>{sources.delete(source);source.disconnect();acknowledge();};
          source.start(nextTime);nextTime+=buffer.duration;
        }
        if(message.turnComplete)lastSpeaker='';
      }catch{stop('Could not process Vertex audio; restart AI voice');}
    };
    socket.onerror=()=>stop('Vertex connection failed; check the local server');
    socket.onclose=()=>stop('Vertex session ended; start AI voice again');
  }catch{stop('Could not start Vertex audio; check browser audio support');}
}
