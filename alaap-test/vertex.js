import {GoogleGenAI} from '@google/genai';
import {WebSocketServer} from 'ws';

function connectionFailure(reason=''){
  if(reason.includes('invalid_grant'))return 'Google credentials expired; run gcloud auth application-default login';
  if(/billing/i.test(reason))return 'Vertex requires billing enabled on the configured Google Cloud project';
  return 'Unable to connect to Vertex; check credentials, model access and quota';
}

export function connectVertex(callbacks){
  const ai=new GoogleGenAI({vertexai:true,project:process.env.GOOGLE_CLOUD_PROJECT,location:process.env.GOOGLE_CLOUD_LOCATION||'us-central1'});
  return ai.live.connect({
    model:process.env.VERTEX_LIVE_MODEL||'gemini-live-2.5-flash-native-audio',callbacks,
    config:{
      responseModalities:['AUDIO'],inputAudioTranscription:{},outputAudioTranscription:{},
      systemInstruction:'You are an AI assistant in an agricultural helpline test. Speak short, clear Bengali by default and follow the caller’s language. Ask one question at a time and confirm uncertain crop names, symptoms and numbers. This test has no reviewed agricultural knowledge or real expert referral service. Do not diagnose diseases or recommend chemical treatments or doses. Recommend consulting an agricultural specialist when advice is needed; never claim a referral or SMS was sent.',
    },
  });
}

export function attachVertex(server,{connect=connectVertex}={}){
  const sockets=new WebSocketServer({noServer:true,maxPayload:8192});
  server.on('upgrade',(req,socket,head)=>{
    const host='127.0.0.1:'+server.address().port;
    if(req.url!=='/vertex'||req.headers.host!==host||req.headers.origin!=='http://'+host){
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;
    }
    if(sockets.clients.size){socket.end('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n');return;}
    sockets.handleUpgrade(req,socket,head,ws=>sockets.emit('connection',ws));
  });
  sockets.on('connection',ws=>{
    let session,closed=false;
    const stop=(message)=>{
      if(closed)return;
      closed=true;clearTimeout(setupTimer);clearTimeout(limitTimer);
      session?.close();
      if(ws.readyState===1){if(message)ws.send(JSON.stringify({error:message}));ws.close();}
    };
    const send=message=>{
      if(closed||ws.readyState!==1)return;
      if(ws.bufferedAmount>1_000_000){stop('Vertex audio playback fell behind; restart AI voice');return;}
      ws.send(JSON.stringify(message));
    };
    const setupTimer=setTimeout(()=>stop('Vertex connection timed out; check Google credentials and project access'),20000);
    const limitTimer=setTimeout(()=>stop('Ten-minute AI test finished; start again if needed'),600000);
    ws.on('close',()=>stop());ws.on('error',()=>stop());
    ws.on('message',(data,binary)=>{
      if(!session||!binary||data.length<2||data.length%2){stop('Invalid or premature audio frame');return;}
      try{session.sendRealtimeInput({audio:{data:data.toString('base64'),mimeType:'audio/pcm;rate=16000'}});}
      catch{stop('Unable to send caller audio to Vertex');}
    });
    Promise.resolve().then(()=>connect({
      onmessage:message=>{
        const content=message.serverContent;
        if(!content)return;
        const audio=(content.modelTurn?.parts||[]).filter(p=>p.inlineData?.mimeType?.startsWith('audio/pcm')).map(p=>p.inlineData);
        send({audio,input:content.inputTranscription?.text,output:content.outputTranscription?.text,interrupted:content.interrupted,turnComplete:content.turnComplete});
      },
      onerror:()=>stop('Vertex connection failed; check Google sign-in, model access and quota'),
      onclose:event=>stop(connectionFailure(event?.reason)),
    })).then(value=>{
      session=value;
      if(closed){session.close();return;}
      clearTimeout(setupTimer);send({ready:true});
      session.sendClientContent({turns:[{role:'user',parts:[{text:'Introduce yourself briefly in Bengali as an AI test assistant, then ask how you can help.'}]}],turnComplete:true});
    }).catch(error=>stop(connectionFailure(String(error.message))));
  });
  return sockets;
}
