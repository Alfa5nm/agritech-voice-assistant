import './app.js';
import {labels,toolLabels,stageForTool,factEntries,transcriptParts,acceptSnapshot,sourceUrl,retrievalExplanation} from './workspace-state.js';

const $=id=>document.getElementById(id);
let caseId=new URLSearchParams(location.search).get('case');
const feed=$('conversation-feed'),turns=new Map(),partials={caller:null,assistant:null},toolNames=new Map();
let state=null,lastSequence=0,voiceState='idle',voiceReady=false,phoneConnected=false,callerLevel=0,assistantLevel=0,lastCallerSpeech=0,awaitingReply=false,raf,lastPaint=0,lastRetrieval=null,localTurn=0;
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
const canvas=$('orb'),paint=canvas.getContext('2d');
const dialog=$('connection-panel');
let activeProvider=null;
let replyStarted=null;
const replyTicker=setInterval(()=>{if(replyStarted!==null)$('response-timer').textContent='Waiting for reply · '+((Date.now()-replyStarted)/1000).toFixed(1)+'s';},250);
window.addEventListener('pagehide',()=>clearInterval(replyTicker));
function renderProvider(connection='idle'){
  const provider=activeProvider||($('gemini-test').checked?'gemini':'vertex'),name=provider==='vertex'?'Vertex AI':'Gemini Developer API';
  $('provider-name').textContent=name;
  const connected=['listening','speaking','waiting','interrupted'].includes(connection);
  $('provider-state').textContent=connected?'Connected':connection==='connecting'?'Connecting…':connection==='failed'?'Connection failed':'Selected · not connected';
  $('provider-state').classList.toggle('saved',connected);
  $('provider-detail').textContent=connected?'Live audio session active · '+name:connection==='connecting'?'Waiting for generated audio from '+name:connection==='failed'?'See the connection message below.':provider==='vertex'?'Google Cloud · starts when you connect a call and start voice.':'Fictional tests only · free-tier data terms apply.';
  $('start-voice').textContent='◉ Start '+name;
}
$('gemini-test').addEventListener('change',()=>renderProvider());renderProvider();
$('setup-toggle').onclick=()=>{dialog.showModal();$('setup-toggle').setAttribute('aria-expanded','true');};
$('setup-close').onclick=()=>dialog.close();
dialog.addEventListener('close',()=>$('setup-toggle').setAttribute('aria-expanded','false'));
dialog.addEventListener('click',event=>{if(event.target===dialog){const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dialog.close();}});
$('start-voice').disabled=true;$('stop-voice').disabled=true;
if(caseId)$('session-label').textContent='Case '+caseId.slice(0,8);

function element(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
function stage(name,status,description){const item=$('pipeline').querySelector('[data-stage="'+name+'"]');if(!item)return;item.dataset.status=status;item.querySelector('.stage-status').textContent={running:'Working',complete:'Complete',failed:'Failed',cancelled:'Cancelled',idle:'Idle'}[status]||status;if(description)item.querySelector('small').textContent=description;}
function activity(text,status='complete',at=new Date().toISOString()){
  $('activity-feed').querySelector('.activity-placeholder')?.remove();
  const li=element('li');li.dataset.status=status;const time=element('time','',new Date(at).toLocaleTimeString([],{hour12:false}));time.dateTime=at;li.append(time,element('span','',text));$('activity-feed').prepend(li);
  while($('activity-feed').children.length>100)$('activity-feed').lastElementChild.remove();
}
function phase(next){
  if(voiceState===next)return;voiceState=next;$('orb-wrap').dataset.state=next;
  const names={idle:'READY WHEN YOU ARE',connecting:'CONNECTING',listening:'LISTENING',waiting:'WAITING FOR REPLY',speaking:'SPEAKING',interrupted:'PLAYBACK INTERRUPTED',failed:'CONNECTION NEEDS ATTENTION'};
  $('voice-phase').textContent=names[next]||next.toUpperCase();
  $('voice-heading').textContent={idle:'A conversation. A little more clarity.',connecting:'Making the connection.',listening:'Listening to the farmer.',waiting:'A moment for the next step.',speaking:'An answer, out loud.',interrupted:'Giving the farmer the floor.',failed:'Let’s check the connection.'}[next];
}
function draw(time){
  if(time-lastPaint>40){
    lastPaint=time;const level=Math.min(1,Math.max(callerLevel,assistantLevel)*7),active=['listening','speaking'].includes(voiceState)&&level>.015;
    paint.clearRect(0,0,600,600);const gradient=paint.createLinearGradient(110,100,490,490);gradient.addColorStop(0,'#9de5a0');gradient.addColorStop(.48,'#d7c58a');gradient.addColorStop(1,'#df7e78');
    for(let layer=0;layer<3;layer++){
      paint.beginPath();for(let i=0;i<=200;i++){const angle=i/200*Math.PI*2;const movement=active&&!reducedMotion.matches?Math.sin(angle*6+time/500+layer)*level*17+Math.cos(angle*9-time/800)*level*9:0;const radius=181+layer*12+movement;const x=300+Math.cos(angle)*radius,y=300+Math.sin(angle)*radius;if(i===0)paint.moveTo(x,y);else paint.lineTo(x,y);}
      paint.closePath();paint.strokeStyle=gradient;paint.lineWidth=layer===0?1.9:1;paint.globalAlpha=layer===0?.8:.2-layer*.04;paint.stroke();
    }
    paint.globalAlpha=1;
    if(voiceReady){
      if(assistantLevel>.008)phase('speaking');
      else if(callerLevel>.008)phase('listening');
      else if(awaitingReply&&Date.now()-lastCallerSpeech>650)phase('waiting');
    }
  }
  if(!document.hidden)raf=requestAnimationFrame(draw);
}
raf=requestAnimationFrame(draw);
document.addEventListener('visibilitychange',()=>{cancelAnimationFrame(raf);if(!document.hidden)raf=requestAnimationFrame(draw);});
window.addEventListener('pagehide',()=>cancelAnimationFrame(raf));

function renderTurn(record){
  const nearBottom=feed.scrollHeight-feed.scrollTop-feed.clientHeight<100;
  $('conversation-empty')?.remove();
  if(!record.node){record.node=element('article','turn '+record.role);const header=element('div','turn-header');header.append(element('span','role-indicator'),element('span','',record.role==='caller'?'FARMER':'AGRI ASSISTANT'));record.body=element('p');record.node.append(header,record.body);feed.append(record.node);}
  record.node.classList.toggle('partial',!record.id);record.body.replaceChildren();
  for(const part of transcriptParts(record.text,record.id,factEntries(state))){const node=element(part.key?'mark':'span','',part.text);if(part.key){node.dataset.status=part.status||'proposed';node.title=labels[part.key]+' · '+(part.status||'proposed');}record.body.append(node);}
  while(feed.children.length>100){const node=feed.firstElementChild;for(const [id,item] of turns)if(item.node===node)turns.delete(id);node.remove();}
  if(nearBottom)feed.scrollTop=feed.scrollHeight;
}
function completeTurn(turn){
  if(!turn||!['caller','assistant'].includes(turn.role)||typeof turn.id!=='string'||typeof turn.text!=='string')return;
  let record=turns.get(turn.id);
  if(!record){const pending=partials[turn.role];if(pending&&turn.text.startsWith(pending.text)){record=pending;partials[turn.role]=null;}else record={role:turn.role};turns.set(turn.id,record);}
  Object.assign(record,{id:turn.id,text:turn.text});renderTurn(record);
}
function delta(speaker,text){
  if(!text||!['caller','assistant'].includes(speaker))return;
  let record=partials[speaker];if(!record)record=partials[speaker]={role:speaker,text:''};record.text=(record.text+text).slice(-8000);renderTurn(record);
  if(speaker==='caller')stage('speech','running','Receiving caller transcript');
}
function valueText(value){return typeof value==='boolean'?(value?'Yes':'No'):String(value??'');}
function row(key,fact){
  const div=element('div','fact-row');div.append(element('dt','',labels[key]));const dd=element('dd');
  if(!fact)dd.append(element('span','fact-empty','Not provided'));
  else{
    dd.append(element('strong','fact-value',valueText(fact.value)));
    if(fact.previous!==null&&fact.previous!==undefined&&fact.previous!==fact.value)dd.append(element('span','previous',valueText(fact.previous)));
    const label=fact.status==='proposed'?(fact.awaiting?'Awaiting confirmation':'Proposed · not saved to profile'):fact.status==='corrected'?'Corrected · confirmed':fact.confirmedBy?'Confirmed':'Unconfirmed';
    dd.append(element('span','fact-state '+(fact.status||'proposed'),label));
  }
  div.append(dd);return div;
}
function renderFacts(){
  const fields=factEntries(state),profile=fields.filter(f=>f.scope==='profile'),facts=fields.filter(f=>f.scope==='facts');
  $('profile-fields').replaceChildren(...['name','age','location','phone','language','serviceConsent'].map(key=>row(key,profile.find(f=>f.key===key))));
  $('case-fields').replaceChildren(...['crop','symptom','symptomLocation','duration'].map(key=>row(key,facts.find(f=>f.key===key))),...facts.filter(f=>!['crop','symptom','symptomLocation','duration'].includes(f.key)).map(f=>row(f.key,f)));
  $('profile-name').textContent=state?.profile?.name?.confirmedBy?state.profile.name.value:'Waiting to meet the farmer';
  $('profile-state').textContent=state?.registrationComplete?'Registration saved · confirmed profile':state?.pending?'Details awaiting caller confirmation':'Registration comes first';
  $('save-state').textContent=state?'Synced · v'+state.version:'No case';$('save-state').classList.toggle('saved',!!state?.registrationComplete);
  $('case-stage').textContent=state?.status?.replaceAll('_',' ')||'Not started';
  $('session-kind').textContent=state?.synthetic?'Fictional test':'Supervised';
  if(state){$('next-question').textContent=state.pending?'Read back the proposed values, wait for playback, then ask for explicit confirmation.':state.registration?.consentDeclined?'Consent declined. Stop respectfully; do not continue registration.':state.registration?.question||(!state.registrationComplete?'Required details confirmed. Complete registration before guidance.':lastRetrieval?(lastRetrieval.question||retrievalExplanation(lastRetrieval)):'Registration complete. Confirm crop, symptoms, location and duration.');}
  for(const record of turns.values())renderTurn(record);
}
renderFacts();
function snapshot(next){
  if(!acceptSnapshot(state,next,caseId))return;
  const first=!state;if(state&&JSON.stringify(state.facts)!==JSON.stringify(next.facts))lastRetrieval=null;state=next;
  for(const turn of next.turns||[])completeTurn(turn);
  renderFacts();
  if(next.registrationComplete)stage('context','complete','Confirmed registration saved');
  if(first)$('pipeline-summary').textContent='Case connected · live backend events';
}
function showEvidence(result){
  lastRetrieval=result;
  const description=retrievalExplanation(result);$('next-question').textContent=result.question||description;$('pipeline-summary').textContent=description;
  $('evidence-list').replaceChildren();const evidence=result.evidence||[];$('source-count').textContent=String(evidence.length);
  if(!evidence.length){const box=element('div','empty-evidence');box.append(element('span','','▤'),element('h3','','No reviewed evidence returned'),element('p','',description));$('evidence-list').append(box);}
  for(const source of evidence){const card=element('article','source-card');const title=element('h3');const url=sourceUrl(source.url);if(url){const link=element('a','',source.title||'Source passage');link.href=url;link.target='_blank';link.rel='noopener noreferrer';title.append(link);}else title.textContent=source.title||'Source passage';card.append(title,element('p','',source.text||''),element('small','',[source.review_status||'Review status unknown',source.page?'Page '+source.page:null,source.section].filter(Boolean).join(' · ')));$('evidence-list').append(card);}
  activity(description);
}
function backendEvent(event){
  if(!caseId||!event||!Number.isInteger(event.sequence)||event.sequence<=lastSequence)return;lastSequence=event.sequence;
  if(event.type==='snapshot')snapshot(event.state);
  if(event.type==='turn'){completeTurn(event.turn);stage('speech','complete','Transcript turn recorded');}
  if(event.type==='tool'){
    if(event.name)toolNames.set(event.id,event.name);
    const name=event.name||toolNames.get(event.id),title=toolLabels[name]||'Backend operation',pipelineStage=stageForTool[name];
    while(toolNames.size>100)toolNames.delete(toolNames.keys().next().value);
    if(pipelineStage)stage(pipelineStage,event.status);
    activity(title+' · '+event.status+(event.reason?' · '+event.reason:''),event.status,event.at);
    if(event.status==='failed')$('pipeline-summary').textContent=event.reason||'An operation failed. Existing confirmed records remain unchanged.';
  }
  if(event.type==='retrieval')showEvidence(event.result||{});
  if(event.type==='sync_error'){activity('Context could not be refreshed. Use Refresh to retry.','failed',event.at);$('save-state').textContent='Sync unavailable';}
}
document.addEventListener('agritech',({detail:event})=>{
  if(event.type==='speech_quality'){
    const reason={non_speech:'Non-speech sound ignored',unexpected_script:'Unexpected transcription script · please repeat in Bangla',unclear_speech:'Speech unclear · please repeat',incoherent:'Incoherent transcript · please repeat'};
    $('speech-quality').textContent=reason[event.reason]||'Unclear speech · please repeat';activity($('speech-quality').textContent,'cancelled');
  }
  if(event.type==='response_wait'){
    if(event.state==='waiting'){replyStarted=Date.now();$('response-timer').textContent='Waiting for reply · 0.0s';}
    if(event.state==='slow'){$('speech-quality').textContent='Reply is taking longer than usual';}
    if(['answered','timeout'].includes(event.state)){replyStarted=null;$('response-timer').textContent=event.state==='answered'?'Reply audio received':'Reply timed out · call stays connected';}
  }
  if(event.type==='caller_wait')$('speech-quality').textContent=event.state==='repeat'?'No clear reply · asking once more':'Listening · a gentle repeat after 20 seconds';
  if(event.type==='case_required')openCasePicker();
  if(event.type==='workspace')backendEvent(event.event);
  if(event.type==='transcript'){delta(event.speaker,event.text);if(event.speaker==='caller')$('speech-quality').textContent='Caller transcript received · confirmation still required';}
  if(event.type==='turn_end'&&!caseId){for(const role of ['caller','assistant']){const pending=partials[role];if(pending){pending.id='local-'+(++localTurn);turns.set(pending.id,pending);partials[role]=null;renderTurn(pending);}}}
  if(event.type==='level'){
    if(event.speaker==='caller'){callerLevel=event.level;if(event.level>.008){lastCallerSpeech=Date.now();awaitingReply=true;}}
    else{assistantLevel=event.level;if(event.level>.008)awaitingReply=false;}
  }
  if(event.type==='voice'){
    const active=!['idle','failed'].includes(event.state);
    activeProvider=active?(event.provider||'vertex'):null;$('gemini-test').disabled=active;renderProvider(event.state);
    phase(event.state);
    if(event.state==='connecting'){lastSequence=0;voiceReady=false;callerLevel=assistantLevel=0;awaitingReply=false;partials.caller=partials.assistant=null;$('start-voice').disabled=true;$('stop-voice').disabled=false;}
    if(event.state==='listening')voiceReady=true;
    if(event.state==='idle'||event.state==='failed'){voiceReady=false;callerLevel=assistantLevel=0;awaitingReply=false;$('start-voice').disabled=!phoneConnected;$('stop-voice').disabled=true;}
    if(event.state==='idle'||event.state==='failed'){replyStarted=null;if(!/timed out/i.test(event.message||''))$('response-timer').textContent='No reply pending';}
  }
  if(event.type==='playback'&&!event.active&&voiceReady){assistantLevel=0;awaitingReply=false;phase('listening');}
  if(event.type==='workflow_error'){activity(event.message,'failed');$('save-state').textContent='Write not confirmed';}
  if(event.type==='phone'){$('phone-state').textContent=event.message;$('connection-dot').classList.toggle('connected',/Registered|Call connected|Answering/.test(event.message));}
  if(event.type==='phone_event'){
    const name=event.event.event;
    if(name==='media_connected'){phoneConnected=true;$('start-voice').disabled=false;stage('speech','running','Telephone media connected');}
    if(['remote_hangup','media_hangup','local_hangup','connection_cleanup','disconnected','answer_cleanup'].includes(name)){phoneConnected=false;$('start-voice').disabled=true;}
  }
});

const tabs=[$('profile-tab'),$('evidence-tab')];
function selectTab(index){tabs.forEach((tab,i)=>{tab.setAttribute('aria-selected',String(i===index));tab.tabIndex=i===index?0:-1;$(tab.getAttribute('aria-controls')).hidden=i!==index;});}
tabs.forEach((tab,index)=>{tab.onclick=()=>selectTab(index);tab.onkeydown=event=>{if(['ArrowRight','ArrowLeft','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?1:1-index;selectTab(next);tabs[next].focus();}};});
async function refresh(){
  if(!caseId){$('pipeline-summary').textContent='Profiling off · select a case in the operator console';return;}
  try{
    const response=await fetch('/api/cases/'+encodeURIComponent(caseId)+'/workspace');
    if(!response.ok){
      if([401,403,404].includes(response.status)){
        state=null;lastRetrieval=null;turns.clear();partials.caller=partials.assistant=null;feed.replaceChildren();renderFacts();
        $('evidence-list').replaceChildren();$('source-count').textContent='0';$('activity-feed').replaceChildren();
      }
      throw new Error(response.status===401?'Sign in to the operator console to load this case.':'This case could not be loaded. Check access in the operator console.');
    }
    snapshot(await response.json());
  }catch(error){$('next-question').textContent=error.message;$('save-state').textContent='Case unavailable';$('pipeline-summary').textContent='Case access required · profile is not loaded';}
}
$('refresh-context').onclick=refresh;
refresh();
const account=$('account-panel');
$('account-toggle').onclick=()=>account.showModal();$('account-close').onclick=()=>account.close();
async function accountApi(path,body){
  const response=await fetch('/api/'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),result=await response.json();
  if(!response.ok)throw new Error(result.error||'Sign-in unavailable');return result;
}
function accountState(signedIn){
  $('account-toggle').textContent=signedIn?'Signed in':'Sign in';$('account-forms').hidden=signedIn;$('account-logout').hidden=!signedIn;
  $('account-status').textContent=signedIn?'Signed in. Telephone registration starts automatically.':'Sign in once to connect the workspace and telephone.';
  document.dispatchEvent(new CustomEvent('agritech-auth',{detail:{signedIn}}));
}
function accountAction(work){return async event=>{event?.preventDefault();const buttons=account.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);try{await work();}catch(error){$('account-status').textContent=error.message;}finally{buttons.forEach(b=>b.disabled=false);}};}
$('account-login').onsubmit=accountAction(async()=>{await accountApi('auth/start',{email:$('account-email').value});$('account-status').textContent='Check your email. Enter the verification code or paste the full sign-in link below.';});
$('account-verify').onsubmit=accountAction(async()=>{const code=$('account-code').value;$('account-code').value='';await accountApi('auth/verify',{email:$('account-email').value,code});accountState(true);account.close();await refresh();});
$('account-logout').onclick=accountAction(async()=>{await accountApi('auth/logout',{});accountState(false);await refresh();});
async function restoreAccount(){
  try{
    const params=new URLSearchParams(location.hash.slice(1)),accessToken=params.get('access_token');
    if(location.hash)history.replaceState(null,'',location.pathname+location.search);
    if(accessToken)await accountApi('auth/callback',{accessToken,refreshToken:params.get('refresh_token')||undefined});
    const config=await accountApi('config');accountState(config.signedIn);
    if(config.signedIn)await refresh();else if(!account.open&&!dialog.open)account.showModal();
  }catch(error){$('account-status').textContent=error.message;if(!account.open&&!dialog.open)account.showModal();}
}
restoreAccount();
const renewal=setInterval(async()=>{try{const config=await accountApi('config');if(config.signedIn===$('account-logout').hidden){accountState(config.signedIn);if(config.signedIn)account.close();await refresh();}}catch{/* Keep the current call during temporary network errors. */}},60000);
window.addEventListener('pagehide',()=>clearInterval(renewal));
const casePicker=$('case-picker');
async function openCasePicker(){
  if(!casePicker.open)casePicker.showModal();$('case-picker-status').textContent='Loading your cases…';
  try{const cases=await accountApi('cases');$('workspace-cases').replaceChildren(new Option('Choose a case',''),...cases.filter(item=>item.status!=='CLOSED').map(item=>new Option(item.id.slice(0,8)+' · '+item.status,item.id)));$('case-picker-status').textContent=cases.length?'Select an open case, or create a new registration below.':'No saved cases. Obtain storage consent before creating a registration.';}
  catch(error){$('case-picker-status').textContent=error.message;}
}
$('choose-case').onclick=openCasePicker;$('case-picker-close').onclick=()=>casePicker.close();
async function useCase(id){
  const next=await accountApi('cases/'+encodeURIComponent(id)+'/workspace');
  if(next.caseId!==id)throw new Error('Case binding mismatch');
  document.dispatchEvent(new CustomEvent('agritech-case',{detail:{caseId:id,synthetic:next.synthetic}}));
  caseId=id;state=null;lastSequence=0;lastRetrieval=null;turns.clear();partials.caller=partials.assistant=null;feed.replaceChildren();$('evidence-list').replaceChildren();$('source-count').textContent='0';$('activity-feed').replaceChildren();
  for(const name of ['speech','extraction','confirmation','context','retrieval'])stage(name,'idle');
  snapshot(next);renderProvider();$('session-label').textContent='Case '+id.slice(0,8);$('choose-case').textContent='Change case';
  const url=new URL(location.href);url.searchParams.set('case',id);url.searchParams.delete('provider');if(next.synthetic)url.searchParams.set('synthetic','1');else url.searchParams.delete('synthetic');history.replaceState(null,'',url.pathname+url.search);
  $('voice-status').textContent='Case selected. '+(phoneConnected?'Start Vertex AI when ready.':'Connect a phone call, then start Vertex AI.');casePicker.close();
}
function caseAction(work){return async event=>{event.preventDefault();const buttons=casePicker.querySelectorAll('button');buttons.forEach(button=>button.disabled=true);try{await work();}catch(error){$('case-picker-status').textContent=error.message;}finally{buttons.forEach(button=>button.disabled=false);}};}
$('select-case-form').onsubmit=caseAction(()=>useCase($('workspace-cases').value));
$('create-case-form').onsubmit=caseAction(async()=>{const next=await accountApi('cases',{storageConsent:$('case-consent').checked,synthetic:$('case-synthetic').checked});await useCase(next.id);$('case-consent').checked=false;$('case-synthetic').checked=false;});
