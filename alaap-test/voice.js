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

export async function startVoice(call,audio,status,transcript,{caseId=null,provider='vertex',synthetic=false,workspace=false,onEvent=()=>{}}={}){
  const emit=event=>{try{onEvent({...event,provider});}catch{/* Display observers must never interrupt audio. */}};
  if(provider==='gemini'&&caseId&&!synthetic){status.textContent='Gemini free-tier voice requires an explicitly synthetic case';return;}
  if(call?.stopVoice)return;
  const stream=audio.srcObject;
  const sender=call?.pc?.getSenders().find(s=>s.track?.kind==='audio');
  if(!call?.connected||!stream?.getAudioTracks().length||!sender){
    status.textContent='Connect a phone call first';return;
  }
  const microphone=sender.track,context=new AudioContext({sampleRate:16000});
  const sources=new Set(),lines=[];
  let socket,node,input,stopped=false,ready=false,nextTime=0,lastSpeaker='',playedTurn=null,outputAnalyser,animation,highpass,lowpass;
  const acknowledge=()=>{if(playedTurn&&!sources.size&&ready&&socket.readyState===1){socket.send(JSON.stringify({type:'played',turnId:playedTurn}));playedTurn=null;}};
  const flush=()=>{
    for(const source of sources){source.onended=null;try{source.stop();}catch{}source.disconnect();}
    sources.clear();playedTurn=null;nextTime=context.currentTime;
    emit({type:'playback',active:false});
  };
  const providerName=provider==='gemini'?'Gemini Developer API':'Vertex AI';
  const stop=(message=providerName+' voice stopped')=>{
    if(stopped)return;
    stopped=true;ready=false;socket?.close();node?.disconnect();input?.disconnect();flush();
    highpass?.disconnect();lowpass?.disconnect();
    if(animation)cancelAnimationFrame(animation);outputAnalyser?.disconnect();
    context.close().catch(()=>{});sender.replaceTrack(microphone).catch(()=>{});
    delete call.stopVoice;status.textContent=message;
    emit({type:'voice',state:/fail|error|could not|quota|expired|unable/i.test(message)?'failed':'idle',message});
  };
  const caption=(speaker,text)=>{
    if(!text)return;
    if(lastSpeaker===speaker)lines[lines.length-1]+=text;
    else{lines.push(speaker+': '+text);lastSpeaker=speaker;}
    if(lines.length>100)lines.shift();
    transcript.textContent=lines.join('\n');
    emit({type:'transcript',speaker:speaker==='Caller'?'caller':'assistant',text});
  };
  call.stopVoice=stop;status.textContent='Connecting '+providerName+' voice';transcript.textContent='';
  emit({type:'voice',state:'connecting',message:status.textContent});
  try{
    await context.resume();
    await context.audioWorklet.addModule('/bangla-pcm.js');
    if(stopped)return;
    const destination=context.createMediaStreamDestination();
    outputAnalyser=context.createAnalyser?.();
    if(outputAnalyser){
      outputAnalyser.fftSize=256;outputAnalyser.connect(destination);
      const samples=new Float32Array(256);let previous=0;
      const meter=time=>{if(stopped)return;if(time-previous>=50){previous=time;outputAnalyser.getFloatTimeDomainData(samples);emit({type:'level',speaker:'assistant',level:Math.sqrt(samples.reduce((sum,value)=>sum+value*value,0)/samples.length)});}animation=requestAnimationFrame(meter);};
      animation=requestAnimationFrame(meter);
    }
    node=new AudioWorkletNode(context,'phone-pcm');
    const query=new URLSearchParams();if(caseId)query.set('case',caseId);if(provider==='gemini')query.set('provider','gemini');
    if(workspace)query.set('workspace','1');
    socket=new WebSocket('ws://'+location.host+'/vertex'+(query.size?'?'+query:''));
    node.port.onmessage=({data})=>{
      if(!ready||stopped||socket.readyState!==1)return;
      if(socket.bufferedAmount>64000){stop('Vertex upload fell behind; restart AI voice');return;}
      socket.send(pcm16(data));
      emit({type:'level',speaker:'caller',level:Math.sqrt(data.reduce((sum,value)=>sum+value*value,0)/data.length)});
    };
    socket.onmessage=async({data})=>{
      if(stopped)return;
      try{
        const message=JSON.parse(data);
        if(message.workspace)emit({type:'workspace',event:message.workspace});
        if(message.speechQuality)emit({type:'speech_quality',...message.speechQuality});
        if(message.responseWait)emit({type:'response_wait',...message.responseWait});
        if(message.callerWait)emit({type:'caller_wait',...message.callerWait});
        if(message.error){stop(message.error);return;}
        if(message.connecting){status.textContent=message.connecting;emit({type:'voice',state:'connecting',message:message.connecting});}
        if(message.ready){
          await sender.replaceTrack(destination.stream.getAudioTracks()[0]);
          if(stopped){sender.replaceTrack(microphone).catch(()=>{});return;}
          input=context.createMediaStreamSource(stream);
          if(context.createBiquadFilter){highpass=context.createBiquadFilter();highpass.type='highpass';highpass.frequency.value=100;lowpass=context.createBiquadFilter();lowpass.type='lowpass';lowpass.frequency.value=7000;input.connect(highpass).connect(lowpass).connect(node).connect(context.destination);}
          else input.connect(node).connect(context.destination);
          ready=true;status.textContent=providerName+' voice connected';
          emit({type:'voice',state:'listening',message:status.textContent});
        }
        if(message.interrupted){flush();emit({type:'voice',state:'interrupted',message:'Playback interrupted'});}
        if(message.workflowError){status.textContent=message.workflowError;emit({type:'workflow_error',message:message.workflowError});}
        if(message.assistantTurnId)playedTurn=message.assistantTurnId;
        caption('Caller',message.input);caption('AI',message.output);
        for(const audio of message.audio||[]){
          const samples=decodePcm(audio.data);
          const rate=Number(audio.mimeType.match(/rate=(\d+)/)?.[1]||24000);
          const buffer=context.createBuffer(1,samples.length,rate);
          buffer.copyToChannel(samples,0);
          const source=context.createBufferSource();source.buffer=buffer;source.connect(outputAnalyser||destination);
          nextTime=Math.max(context.currentTime,nextTime);
          if(nextTime-context.currentTime>30)throw new Error('Audio playback fell behind');
          sources.add(source);source.onended=()=>{sources.delete(source);source.disconnect();acknowledge();if(!sources.size)emit({type:'playback',active:false});};
          source.start(nextTime);nextTime+=buffer.duration;
        }
        acknowledge();
        if(message.turnComplete){lastSpeaker='';emit({type:'turn_end'});}
      }catch{stop('Could not process Vertex audio; restart AI voice');}
    };
    socket.onerror=()=>stop('Vertex connection failed; check the local server');
    socket.onclose=()=>stop('Vertex session ended; start AI voice again');
  }catch{stop('Could not start Vertex audio; check browser audio support');}
}
