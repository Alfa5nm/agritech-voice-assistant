import {AlaapClient,diagnostic} from './client.js';
import {startVoice} from './voice.js';
import {captureBangla,listenBangla} from './bangla.js';
const $=id=>document.getElementById(id),entries=[];
let activeCase=new URLSearchParams(location.search).get('case');
let syntheticCase=new URLSearchParams(location.search).get('synthetic')==='1';
$('gemini-test').checked=!!activeCase&&syntheticCase&&new URLSearchParams(location.search).get('provider')==='gemini';
$('case-context').textContent=activeCase?(syntheticCase?'Synthetic registration case: ':'Registration case: ')+activeCase:document.body.dataset.workspace==='true'?'Choose a registration case to enable Vertex AI and farmer profiling. Your telephone can stay connected.':'Profiling is OFF: create and select a registration case in the operator page first. Voice-only mode does not save a farmer profile.';
const notify=detail=>document.dispatchEvent(new CustomEvent('agritech',{detail}));
document.addEventListener('agritech-case',({detail})=>{
  client.call?.stopVoice?.();activeCase=detail.caseId;syntheticCase=detail.synthetic===true;$('gemini-test').checked=false;
  $('case-context').textContent=(syntheticCase?'Synthetic registration case: ':'Registration case: ')+activeCase;
});
function log(entry){entries.push(entry);if(entries.length>1000)entries.shift();$('log').textContent=entries.map(e=>JSON.stringify(e)).join('\n');$('log').scrollTop=$('log').scrollHeight;notify({type:'phone_event',event:entry});}
const client=new AlaapClient({log,status:text=>{$('status').textContent=text;$('connect').disabled=!!client.socket;notify({type:'phone',message:text});},audio:$('audio'),microphone:()=>$('microphone').value,autoAnswer:()=>$('auto').checked});
async function connectTelephone(credentials,authorized=()=>true){
  if(client.socket)return;
  const response=await fetch('/ice-config',{method:'POST',headers:{'Content-Type':'application/json'}});if(!response.ok)throw new Error(await response.text());client.iceServers=(await response.json()).iceServers;if(!authorized())return;await client.connect(credentials);
}
$('credentials').onsubmit=async e=>{e.preventDefault();try{await connectTelephone({token:$('token').value,extension:$('extension').value.trim(),domain:$('domain').value.trim(),password:$('password').value});}catch(error){$('status').textContent=error.message;notify({type:'phone',message:error.message});}finally{$('token').value='';$('password').value='';}};
let automaticConnection,authGeneration=0;
document.addEventListener('agritech-auth',async({detail})=>{
  const generation=++authGeneration;
  if(!detail.signedIn){await client.logout();return;}
  if(client.socket||automaticConnection)return;
  automaticConnection=true;
  try{
    const response=await fetch('/api/telephone',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),credentials=await response.json();
    if(!response.ok)throw new Error(credentials.error||'Telephone setup unavailable');
    if(generation!==authGeneration)return;
    await connectTelephone(credentials,()=>generation===authGeneration);
  }catch(error){$('status').textContent=error.message;notify({type:'phone',message:error.message});}
  finally{automaticConnection=false;}
});
$('disconnect').onclick=()=>client.logout();$('hangup').onclick=()=>client.hangup();
$('play').onclick=()=>$('audio').play().catch(()=>$('status').textContent='Incoming audio is not available yet');
$('microphones').onclick=async()=>{let stream;try{stream=await navigator.mediaDevices.getUserMedia({audio:true});const devices=await navigator.mediaDevices.enumerateDevices();$('microphone').replaceChildren(new Option('System default',''),...devices.filter(d=>d.kind==='audioinput').map(d=>new Option(d.label||'Microphone',d.deviceId)));log(diagnostic('microphone_check_passed'));}catch{log(diagnostic('microphone_check_failed'));$('status').textContent='Microphone unavailable: check browser permission and connected device';}finally{stream?.getTracks().forEach(t=>t.stop());}};
$('download').onclick=()=>{const url=URL.createObjectURL(new Blob([entries.map(e=>JSON.stringify(e)).join('\n')],{type:'text/plain'}));const a=document.createElement('a');a.href=url;a.download='alaap-redacted-qa.jsonl';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
window.addEventListener('beforeunload',()=>client.disconnect());
$('start-voice').onclick=()=>{
  if(!activeCase&&!$('gemini-test').checked){$('voice-status').textContent='Choose a registration case to enable Vertex AI and farmer profiling.';notify({type:'case_required'});return;}
  if(client.call?.stopBangla){$('voice-status').textContent='Wait for the local Bangla test to finish';return;}
  startVoice(client.call,$('audio'),$('voice-status'),$('transcript'),{caseId:activeCase,synthetic:syntheticCase,provider:$('gemini-test').checked?'gemini':'vertex',workspace:document.body.dataset.workspace==='true',onEvent:notify});
};
$('stop-voice').onclick=()=>client.call?.stopVoice?.();
$('bangla-start').onclick=()=>captureBangla(client.call,$('audio'),$('bangla-status'),$('bangla-results'),$('bangla-finish'));
$('bangla-auto').onclick=()=>listenBangla(client.call,$('audio'),$('bangla-status'),$('bangla-results'),$('bangla-qa'),$('bangla-qa-status'));
$('bangla-stop').onclick=()=>client.call?.stopBangla?.();
