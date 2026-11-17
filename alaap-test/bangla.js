import {nextBanglaQuestion} from './bangla-dialogue.js';

export function collectTurns(rate,onTurn){
  const preRoll=[];
  let blocks=[],duration=0,quiet=0,voiced=0;
  return samples=>{
    const ms=samples.length*1000/rate;
    const rms=Math.sqrt(samples.reduce((sum,sample)=>sum+sample*sample,0)/samples.length);
    // shortcut: fixed level threshold; use a trained VAD if phone noise triggers false turns.
    const speaking=rms>0.012;
    if(!blocks.length&&!speaking){
      preRoll.push(samples);
      if(preRoll.length>Math.ceil(250/ms))preRoll.shift();
      return;
    }
    if(!blocks.length)blocks=preRoll.splice(0);
    blocks.push(samples);
    duration+=ms;
    if(speaking){quiet=0;voiced+=ms;}else quiet+=ms;
    if(quiet>=600||duration>=12000){
      const turn=blocks;
      const valid=voiced>=200;
      blocks=[];duration=0;quiet=0;voiced=0;
      if(valid)onTurn(turn);
    }
  };
}

function wav(blocks,rate){
  const count=blocks.reduce((total,block)=>total+block.length,0);
  const bytes=new ArrayBuffer(44+count*2), view=new DataView(bytes);
  const tag=(offset,text)=>[...text].forEach((c,i)=>view.setUint8(offset+i,c.charCodeAt(0)));
  tag(0,'RIFF');view.setUint32(4,36+count*2,true);tag(8,'WAVE');tag(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);
  tag(36,'data');view.setUint32(40,count*2,true);
  let offset=44;
  for(const block of blocks)for(const sample of block){
    view.setInt16(offset,Math.max(-1,Math.min(1,sample))*32767,true);offset+=2;
  }
  return bytes;
}

export async function listenBangla(call,audio,status,results,qa,qaStatus){
  if(call?.stopBangla)return;
  const stream=audio.srcObject;
  const sender=call?.pc?.getSenders().find(s=>s.track?.kind==='audio');
  if(!call?.connected||!stream?.getAudioTracks().length||!sender||call.stopVoice){
    status.textContent='Connect a test call and stop AI voice first';return;
  }
  const microphone=sender.track;
  const abort=new AbortController();
  const context=new AudioContext({sampleRate:16000});
  let node,busy=false;
  const stop=()=>{
    abort.abort();
    qa.checked=false;
    node?.disconnect();
    context.close().catch(()=>{});
    sender.replaceTrack(microphone).catch(()=>{});
    delete call.stopBangla;
    status.textContent='Hands-free Bangla stopped';
  };
  call.stopBangla=stop;
  try{
    await context.resume();
    await context.audioWorklet.addModule('/bangla-pcm.js');
    const response=await fetch('/bangla-prompts.json',{signal:abort.signal});
    if(!response.ok)throw new Error('Bangla questions unavailable');
    const prompts=await response.json();
    const replies=new Map();
    const dialogue={};
    abort.signal.throwIfAborted();
    const destination=context.createMediaStreamDestination();
    const collect=collectTurns(context.sampleRate,async blocks=>{
      busy=true;
      const save=qa.checked;
      qa.checked=false;
      if(save)qaStatus.textContent='Preparing one QA capture';
      status.textContent='Transcribing Bangla locally';
      const started=performance.now();
      try{
        const clip=wav(blocks,context.sampleRate);
        const response=await fetch('/bangla/regional',{
          method:'POST',body:clip,signal:abort.signal
        });
        if(!response.ok)throw new Error(await response.text());
        const result=await response.json();
        abort.signal.throwIfAborted();
        const question=nextBanglaQuestion(dialogue,result);
        if(save){
          const bytes=new Uint8Array(clip);
          let binary='';
          for(let offset=0;offset<bytes.length;offset+=8192){
            binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
          }
          const capture={...result,question:prompts[question],audio:btoa(binary)};
          fetch('/bangla/qa',{
            method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(capture)
          }).then(async response=>{
            if(!response.ok)throw new Error(await response.text());
            qaStatus.textContent='Saved in qa/captures: '+await response.text();
          }).catch(()=>{qaStatus.textContent='Unable to save QA capture';});
        }
        results.textContent=[
          'Heard: '+(result.text||'[no speech]'),
          'Cleaned: '+(result.suspect?'[unreliable]':result.cleaned||'[no speech]'),
          'Latin script: '+(result.suspect?'[unreliable]':result.latin||'[no speech]'),
          'Assistant: '+prompts[question]
        ].join('\n');
        if(!replies.has(question)){
          const file=await fetch('/bangla-prompts/'+question+'.mp3',{signal:abort.signal});
          if(!file.ok)throw new Error('Bangla question audio unavailable');
          replies.set(question,await context.decodeAudioData(await file.arrayBuffer()));
        }
        abort.signal.throwIfAborted();
        const source=context.createBufferSource();
        source.buffer=replies.get(question);
        source.connect(destination);
        await sender.replaceTrack(destination.stream.getAudioTracks()[0]);
        abort.signal.throwIfAborted();
        await new Promise(resolve=>{
          const done=()=>{
            abort.signal.removeEventListener('abort',done);
            resolve();
          };
          source.onended=done;
          abort.signal.addEventListener('abort',done,{once:true});
          source.start();
          status.textContent='Asking a follow-up ('+Math.round(performance.now()-started)+' ms after speech detection ended)';
        });
        if(!abort.signal.aborted){
          await sender.replaceTrack(microphone);
          if(question==='finish'){stop();return;}
          status.textContent='Listening';
        }
      }catch(error){
        if(save&&qaStatus.textContent==='Preparing one QA capture')qaStatus.textContent='QA capture did not complete';
        if(!abort.signal.aborted){stop();status.textContent=error.message;}
      }
      finally{busy=false;}
    });
    node=new AudioWorkletNode(context,'phone-pcm');
    node.port.onmessage=event=>{if(!busy&&!abort.signal.aborted)collect(event.data);};
    context.createMediaStreamSource(stream).connect(node).connect(context.destination);
    status.textContent='Listening';
  }catch(error){if(!abort.signal.aborted){stop();status.textContent=error.message;}}
}

export async function captureBangla(call,audio,status,results,finish){
  if(call?.stopBangla)return;
  const stream=audio.srcObject;
  const sender=call?.pc?.getSenders().find(s=>s.track?.kind==='audio');
  if(!call?.connected||!stream?.getAudioTracks().length||!sender||call.stopVoice){
    status.textContent='Connect a test call and stop AI voice first';
    return;
  }
  const microphone=sender.track;
  const abort=new AbortController();
  const context=new AudioContext();
  let recorder,source,timer;
  call.stopBangla=()=>{
    abort.abort();
    clearTimeout(timer);
    if(recorder?.state==='recording')recorder.stop();
    if(source){source.onended=null;try{source.stop();}catch{}}
    if(context.state!=='closed')context.close().catch(()=>{});
    finish.disabled=true;
  };
  try{
    await context.resume();
    const reply=await fetch('/bangla-reply.mp3',{signal:abort.signal});
    if(!reply.ok)throw new Error('Scripted Bangla reply is unavailable');
    const buffer=await context.decodeAudioData(await reply.arrayBuffer());
    abort.signal.throwIfAborted();
    recorder=new MediaRecorder(stream);
    const chunks=[];
    recorder.ondataavailable=event=>chunks.push(event.data);
    const recorded=new Promise((resolve,reject)=>{
      recorder.onstop=()=>resolve(new Blob(chunks,{type:recorder.mimeType}));
      recorder.onerror=()=>reject(new Error('Could not capture caller audio'));
    });
    recorder.start();
    finish.disabled=false;
    finish.onclick=()=>{if(recorder.state==='recording')recorder.stop();};
    timer=setTimeout(finish.onclick,15000);
    status.textContent='Listening. Click Finish utterance when the caller stops.';
    results.textContent='';
    const clip=await recorded;
    const stopped=performance.now();
    clearTimeout(timer);
    finish.disabled=true;
    status.textContent='Transcribing locally';
    abort.signal.throwIfAborted();
    for(const model of ['regional','standard']){
      const response=await fetch('/bangla/'+model,{method:'POST',body:clip,signal:abort.signal});
      if(!response.ok)throw new Error(await response.text());
      const result=await response.json();
      const text=result.suspect?'[unreliable script; please repeat]':result.text||'[no speech]';
      results.textContent+=model+' ('+result.inferenceMs+' ms): '+text+'\n';
      if(model==='regional'){
        const destination=context.createMediaStreamDestination();
        source=context.createBufferSource();
        source.buffer=buffer;
        source.connect(destination);
        await sender.replaceTrack(destination.stream.getAudioTracks()[0]);
        abort.signal.throwIfAborted();
        source.start();
        status.textContent='Scripted reply started '+Math.round(performance.now()-stopped)+' ms after capture ended';
        source.onended=()=>sender.replaceTrack(microphone).catch(()=>{});
      }
    }
    if(source)await new Promise(resolve=>setTimeout(resolve,Math.ceil(buffer.duration*1000)));
  }catch(error){
    status.textContent=abort.signal.aborted?'Bangla test ended':error.message;
  }finally{
    call.stopBangla();
    delete call.stopBangla;
    await sender.replaceTrack(microphone).catch(()=>{});
  }
}
