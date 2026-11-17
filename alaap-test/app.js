import {AlaapClient,diagnostic} from './client.js';
import {startVoice} from './voice.js';
import {captureBangla,listenBangla} from './bangla.js';
const $=id=>document.getElementById(id),entries=[];
function log(entry){entries.push(entry);if(entries.length>1000)entries.shift();$('log').textContent=entries.map(e=>JSON.stringify(e)).join('\n');$('log').scrollTop=$('log').scrollHeight;}
const client=new AlaapClient({log,status:text=>{$('status').textContent=text;$('connect').disabled=!!client.socket;},audio:$('audio'),microphone:()=>$('microphone').value,autoAnswer:()=>$('auto').checked});
$('credentials').onsubmit=async e=>{e.preventDefault();try{const response=await fetch('/ice-config',{method:'POST',headers:{'Content-Type':'application/json'}});if(!response.ok)throw new Error(await response.text());client.iceServers=(await response.json()).iceServers;await client.connect({token:$('token').value,extension:$('extension').value.trim(),domain:$('domain').value.trim(),password:$('password').value});}catch(error){$('status').textContent=error.message;}finally{$('token').value='';$('password').value='';}};
$('disconnect').onclick=()=>client.logout();$('hangup').onclick=()=>client.hangup();
$('play').onclick=()=>$('audio').play().catch(()=>$('status').textContent='Incoming audio is not available yet');
$('microphones').onclick=async()=>{let stream;try{stream=await navigator.mediaDevices.getUserMedia({audio:true});const devices=await navigator.mediaDevices.enumerateDevices();$('microphone').replaceChildren(new Option('System default',''),...devices.filter(d=>d.kind==='audioinput').map(d=>new Option(d.label||'Microphone',d.deviceId)));log(diagnostic('microphone_check_passed'));}catch{log(diagnostic('microphone_check_failed'));$('status').textContent='Microphone unavailable: check browser permission and connected device';}finally{stream?.getTracks().forEach(t=>t.stop());}};
$('download').onclick=()=>{const url=URL.createObjectURL(new Blob([entries.map(e=>JSON.stringify(e)).join('\n')],{type:'text/plain'}));const a=document.createElement('a');a.href=url;a.download='alaap-redacted-qa.jsonl';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
window.addEventListener('beforeunload',()=>client.disconnect());
$('start-voice').onclick=()=>{
  if(client.call?.stopBangla){$('voice-status').textContent='Wait for the local Bangla test to finish';return;}
  startVoice(client.call,$('audio'),$('voice-status'),$('transcript'));
};
$('stop-voice').onclick=()=>client.call?.stopVoice?.();
$('bangla-start').onclick=()=>captureBangla(client.call,$('audio'),$('bangla-status'),$('bangla-results'),$('bangla-finish'));
$('bangla-auto').onclick=()=>listenBangla(client.call,$('audio'),$('bangla-status'),$('bangla-results'),$('bangla-qa'),$('bangla-qa-status'));
$('bangla-stop').onclick=()=>client.call?.stopBangla?.();
