import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {attachVertex} from './vertex.js';
try{process.loadEnvFile(new URL('.env.local',import.meta.url));}catch(error){if(error.code!=='ENOENT')throw error;}
const files={'/':'index.html','/app.js':'app.js','/client.js':'client.js','/voice.js':'voice.js','/bangla.js':'bangla.js','/bangla-pcm.js':'bangla-pcm.js','/bangla-dialogue.js':'bangla-dialogue.js','/bangla-prompts.json':'bangla-prompts.json','/bangla-reply.mp3':'bangla-reply.mp3'};
const port=Number(process.env.PORT||8765);
const server=createServer(async(req,res)=>{
  if(req.method==='POST'&&req.url==='/ice-config'){
    const host='127.0.0.1:'+port;
    if(req.headers.host!==host||req.headers.origin!=='http://'+host||req.headers['content-type']!=='application/json')return res.writeHead(403).end('Open the local tester directly');
    const username=process.env.ALAAP_TURN_USERNAME,credential=process.env.ALAAP_TURN_CREDENTIAL;
    if(!username||!credential)return res.writeHead(503).end('Set ALAAP_TURN_USERNAME and ALAAP_TURN_CREDENTIAL in .env.local');
    return res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({iceServers:[{urls:'turn:ippbx.alaapcloud.gov.bd:3478',username,credential},{urls:'stun:ippbx.alaapcloud.gov.bd:3478'}]}));
  }
  if(req.method==='POST'&&req.url==='/bangla/qa'){
    const host='127.0.0.1:'+port;
    if(req.headers.host!==host||req.headers.origin!=='http://'+host||req.headers['content-type']!=='application/json')return res.writeHead(403).end('Open the local tester directly');
    let capture;
    try{
      const chunks=[];let bytes=0;
      for await(const chunk of req){
        bytes+=chunk.length;
        if(bytes>650000)return res.writeHead(413).end('QA capture too large');
        chunks.push(chunk);
      }
      capture=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }catch{return res.writeHead(400).end('Invalid QA capture');}
    const fields=['text','cleaned','latin','question'];
    if(!capture||typeof capture.audio!=='string'||!fields.every(key=>typeof capture[key]==='string'&&capture[key].length<=4000))return res.writeHead(400).end('Invalid QA capture fields');
    const clip=Buffer.from(capture.audio,'base64');
    if(clip.length<44||clip.toString('ascii',0,4)!=='RIFF'||clip.toString('ascii',8,12)!=='WAVE')return res.writeHead(400).end('WAV audio required');
    try{
      const name=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8);
      const folder=new URL('qa/captures/',import.meta.url);
      await mkdir(folder,{recursive:true});
      await writeFile(new URL(name+'.wav',folder),clip,{flag:'wx'});
      const record=Object.fromEntries(fields.map(key=>[key,capture[key]]));
      record.suspect=capture.suspect===true;
      record.inferenceMs=Number.isFinite(capture.inferenceMs)?capture.inferenceMs:null;
      record.audio=name+'.wav';
      await writeFile(new URL(name+'.json',folder),JSON.stringify(record,null,2),{flag:'wx'});
      return res.writeHead(201,{'Content-Type':'text/plain','Cache-Control':'no-store'}).end(name);
    }catch{return res.writeHead(500).end('Unable to save QA capture');}
  }
  if(req.method==='POST'&&['/bangla/standard','/bangla/regional'].includes(req.url)){
    const host='127.0.0.1:'+port;
    if(req.headers.host!==host||req.headers.origin!=='http://'+host)return res.writeHead(403).end('Open the local tester directly');
    try{
      const chunks=[];let bytes=0;
      for await(const chunk of req){
        bytes+=chunk.length;
        if(bytes>1_000_000)return res.writeHead(413).end('Audio too large');
        chunks.push(chunk);
      }
      const result=await fetch('http://127.0.0.1:8767/'+req.url.split('/').at(-1),{
        method:'POST',body:Buffer.concat(chunks),signal:AbortSignal.timeout(30000)
      });
      if(!result.ok)return res.writeHead(502).end('Local transcription failed');
      return res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(await result.text());
    }catch{return res.writeHead(502).end('Local Bangla worker unavailable');}
  }
  const file=files[req.url]||(/^\/bangla-prompts\/[a-z]+\.mp3$/.test(req.url)?req.url.slice(1):null);
  if(req.method!=='GET'||!file){res.writeHead(404).end();return;}
  try{
    const body=await readFile(new URL(file,import.meta.url));
    const type=file.endsWith('.mp3')?'audio/mpeg':file.endsWith('.json')?'application/json':file.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8';
    res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':`default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:${port} wss://ippbx.alaapcloud.gov.bd:4321; media-src 'self' blob:; frame-ancestors 'none'`}).end(body);
  }catch{res.writeHead(500).end('Unable to load client');}
});
attachVertex(server);
server.listen(port,'127.0.0.1',()=>console.log('Alaap test: http://127.0.0.1:'+port));
