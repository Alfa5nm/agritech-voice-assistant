import {randomUUID} from 'node:crypto';
import {transcriptQuality} from '../speech-guard.js';

export const profileFields=['name','age','location','language','phone','serviceConsent','recordingConsent','trainingConsent','followupConsent'];
export const caseFields=['crop','stage','symptom','symptomLocation','duration','farmLocation','priorActions','quantity','unit','negation'];
export function requireValue(condition,message){if(!condition)throw new Error(message);}
export function text(value,max=1000){requireValue(typeof value==='string'&&value.trim().length>0&&value.length<=max,'Invalid text');return value.trim().normalize('NFC');}
export function normalizePhone(value){
  value=text(value,40).replace(/[০-৯]/g,char=>String(char.charCodeAt(0)-0x09e6)).replace(/[\s()-]/g,'');
  if(/^01[3-9]\d{8}$/.test(value))value='+88'+value;
  requireValue(/^\+8801[3-9]\d{8}$/.test(value),'Use a Bangladesh mobile number in +880 format');return value;
}
export function newCase(ownerId,metadata={}){
  return {id:randomUUID(),ownerId,version:0,profileId:randomUUID(),plotId:randomUUID(),cycleId:randomUUID(),status:'INCOMPLETE',identityVerified:false,registrationComplete:false,profile:{},facts:{},turns:[],pending:null,referral:null,metadata:{numberSource:metadata.numberSource==='provider'?'provider_unverified':'caller_unverified',storageConsent:metadata.storageConsent===true,synthetic:metadata.synthetic===true,consentVersion:'research-demo-v1'},events:[],updatedAt:new Date().toISOString()};
}
export function confirmationText(pending){return pending.facts.map(f=>f.key+': '+(typeof f.value==='boolean'?(f.value?'হ্যাঁ':'না'):String(f.value))).join('। ');}
export function confirmationAnswer(value){
  if(/[?？]/u.test(value))return null;
  const answer=value.normalize('NFC').replace(/[\p{P}\p{S}]/gu,' ').replace(/\s+/g,' ').trim();
  if(/^(না|নাই|না জি|না ঠিক না|না ভুল|no)$/iu.test(answer))return false;
  // Accept short explicit acknowledgements, never a yes followed by a correction or new detail.
  const words=answer.split(' ');
  const yes=/^(হ্যাঁ|হ্যা|হ|জি|জ্বি|ঠিক|আছে|সঠিক|একদম|করুন|করেন|করান|করে|দিন|দেন|নিশ্চিত|কনফার্ম|সব|সবই|yes|correct|confirm|it|please)$/iu;
  return words.every(word=>yes.test(word))&&/(হ্যাঁ|হ্যা|জি|জ্বি|ঠিক|সঠিক|নিশ্চিত|কনফার্ম|yes|correct|confirm|^হ$)/iu.test(answer)?true:null;
}
export function matchesReadback(fact,content){
  const digits=value=>String(value).normalize('NFC').replace(/[০-৯]/g,char=>String(char.charCodeAt(0)-0x09e6));
  const spoken=digits(content);
  if(fact.key==='phone'){
    return (spoken.match(/\+?[0-9][0-9\s()-]{8,}[0-9]/g)||[]).some(value=>{try{return normalizePhone(value)===fact.value;}catch{return false;}});
  }
  const valueMatches=spoken.includes(typeof fact.value==='boolean'?(fact.value?'হ্যাঁ':'না'):digits(fact.value));
  return valueMatches||(!['name','location'].includes(fact.key)&&typeof fact.value!=='boolean'&&spoken.includes(digits(fact.raw)));
}
function validateFact(key,value){
  if(key.endsWith('Consent')){requireValue(typeof value==='boolean','Consent must be explicit');return value;}
  if(key==='age'){requireValue(Number.isInteger(value)&&value>=1&&value<=120,'Age must be between 1 and 120');return value;}
  if(key==='phone')return normalizePhone(value);
  return text(value);
}
export function applyEvent(current,event){
  requireValue(event&&typeof event.id==='string'&&event.id.length<=128,'Event ID required');
  if(current.events.includes(event.id))return current;
  requireValue(current.status!=='CLOSED'||event.type==='close','A resolved case cannot be modified; create a new case');
  const state=structuredClone(current);
  switch(event.type){
    case 'turn':{
      requireValue(['caller','assistant'].includes(event.role),'Invalid turn role');
      requireValue(typeof event.turnId==='string'&&event.turnId.length<=128,'Turn ID required');
      if(!state.turns.some(turn=>turn.id===event.turnId))state.turns.push({id:event.turnId,role:event.role,text:text(event.text,8000),at:new Date().toISOString()});
      requireValue(state.turns.length<=500,'Call turn limit reached');break;
    }
    case 'propose':{
      requireValue(['profile','facts'].includes(event.scope),'Invalid fact scope');
      requireValue(Array.isArray(event.facts)&&event.facts.length>0&&event.facts.length<=12,'Supply up to twelve facts');
      const turn=state.turns.find(turn=>turn.id===event.turnId&&turn.role==='caller');requireValue(turn,'Caller source turn required');
      requireValue(transcriptQuality(turn.text).usable,'Caller speech is unclear; ask for a repeat before proposing details');
      const permitted=event.scope==='profile'?profileFields:caseFields;
      const facts=event.facts.map(fact=>{
        requireValue(permitted.includes(fact.key),'Unsupported fact field');
        const raw=text(fact.raw,1000);requireValue(turn.text.includes(raw),'Fact wording must occur in the source turn');
        return {key:fact.key,value:validateFact(fact.key,fact.value),raw,sourceTurn:event.turnId,status:'proposed'};
      });
      requireValue(new Set(facts.map(f=>f.key)).size===facts.length,'Duplicate fact field');
      state.pending={id:event.id,scope:event.scope,facts,readbackTurn:null};break;
    }
    case 'readback':{
      requireValue(state.pending&&state.pending.id===event.batchId,'Stale confirmation batch');
      const turn=state.turns.find(t=>t.id===event.turnId&&t.role==='assistant');requireValue(turn,'Delivered assistant read-back required');
      requireValue(state.turns.indexOf(turn)>state.turns.findIndex(t=>t.id===state.pending.facts[0].sourceTurn),'Read-back must follow the source utterance');
      const missing=state.pending.facts.filter(f=>!matchesReadback(f,turn.text));
      if(missing.length){
        const proof=event.interpretation;
        requireValue(event.actor==='readback_interpreter'&&proof?.batchId===state.pending.id&&proof.turnId===turn.id&&proof.decision==='EQUIVALENT'&&Number.isFinite(proof.confidence)&&proof.confidence>=.98&&proof.confidence<=1&&Array.isArray(proof.fields)&&proof.fields.length===missing.length&&new Set(proof.fields.map(f=>f.key)).size===missing.length&&missing.every(f=>['name','location'].includes(f.key)&&proof.fields.some(p=>p.key===f.key&&p.value===f.value&&typeof p.evidence==='string'&&p.evidence.trim().length>=2&&turn.text.includes(p.evidence))),'Read-back must include all proposed values');
        state.pending.readbackInterpretation=proof;
      }
      state.pending.readbackTurn=turn.id;break;
    }
    case 'confirm':{
      const pending=state.pending;requireValue(pending&&pending.id===event.batchId&&pending.readbackTurn,'Read back the active batch first');
      const index=state.turns.findIndex(t=>t.id===pending.readbackTurn);
      const reply=state.turns.find((t,i)=>i>index&&t.id===event.turnId&&t.role==='caller');requireValue(reply,'A later caller confirmation is required');
      requireValue(transcriptQuality(reply.text,{confirmation:true}).usable,'Caller confirmation is unclear; ask naturally for a repeat');
      let answer=confirmationAnswer(reply.text);
      if(answer===null&&event.actor==='confirmation_interpreter'){
        const decision=event.interpretation;
        requireValue(decision&&decision.readbackTurn===pending.readbackTurn&&['AFFIRM','DENY'].includes(decision.decision)&&Number.isFinite(decision.confidence)&&decision.confidence>=.9&&decision.confidence<=1&&typeof decision.evidence==='string'&&decision.evidence.trim()&&reply.text.includes(decision.evidence),'Invalid confirmation interpretation');
        answer=decision.decision==='AFFIRM';
      }
      if(answer===false){state.pending=null;break;}
      requireValue(answer===true,'Ambiguous answer; ask for a short explicit yes or correction');
      for(const fact of pending.facts){
        const previous=state[pending.scope][fact.key];
        state[pending.scope][fact.key]={...fact,status:previous&&previous.value!==fact.value?'corrected':'confirmed',confirmedBy:event.turnId,previous:previous?.value??null};
      }
      state.pending=null;break;
    }
    case 'register':{
      requireValue(!state.pending,'Confirm pending details before registration');
      for(const key of ['name','location','phone'])requireValue(state.profile[key]?.confirmedBy,'Confirm '+key+' first');
      requireValue(state.profile.serviceConsent?.value===true&&state.profile.serviceConsent.confirmedBy,'Service consent is required');
      state.registrationComplete=true;state.status='COLLECTING';break;
    }
    case 'verify_identity':requireValue(event.actor==='operator','Only an operator can verify identity');requireValue(/^[a-f0-9-]{36}$/i.test(event.profileId||''),'Select the profile whose identity was verified');state.identityVerified=true;state.verifiedProfileId=event.profileId;break;
    case 'bind_profile':requireValue(event.actor==='operator'&&state.identityVerified&&state.verifiedProfileId===event.profileId,'Operator verification required');state.profileId=text(event.profileId,36);state.profile=event.profile;state.registrationComplete=true;state.status='COLLECTING';break;
    case 'referral':{
      requireValue(state.profile.serviceConsent?.value===true,'Service consent required');
      if(!state.referral)state.referral={id:randomUUID(),status:'REQUESTED',reason:text(event.reason),at:new Date().toISOString()};
      state.status='REFERRED';break;
    }
    case 'close':if(state.status!=='CLOSED')state.status=event.resolved===true&&event.actor==='operator'?'CLOSED':'INCOMPLETE';break;
    default:throw new Error('Unsupported case event');
  }
  state.events.push(event.id);state.version++;state.updatedAt=new Date().toISOString();return state;
}
export function registrationStatus(state){
  const questions={serviceConsent:'আপনার নাম, এলাকা আর ফোন নম্বর এই সেবার জন্য সংরক্ষণ করতে পারি?',name:'আপনাকে কী নামে ডাকব?',location:'আপনি কোন জেলা আর উপজেলা বা গ্রামে থাকেন?',phone:'এই সেবায় আপনার কোন মোবাইল নম্বরটি রাখব?'};
  const declined=!!state.profile.serviceConsent?.confirmedBy&&state.profile.serviceConsent.value===false;
  const missing=state.registrationComplete?[]:Object.keys(questions).filter(key=>!state.profile[key]?.confirmedBy||(key==='serviceConsent'&&state.profile[key].value!==true));
  const nextField=declined?null:missing[0]||null;
  return {missingFields:missing,nextField,question:nextField?questions[nextField]:null,consentDeclined:declined,confirmedFields:Object.keys(state.profile).filter(key=>state.profile[key]?.confirmedBy),optionalFields:['age','language']};
}
export function modelCase(state){
  // Only pending registration values are exposed for read-back; stored identity stays out of retrieval.
  return {caseId:state.id,status:state.status,registrationComplete:state.registrationComplete,registration:registrationStatus(state),facts:state.facts,pending:state.pending?{batchId:state.pending.id,scope:state.pending.scope,readbackDelivered:!!state.pending.readbackTurn,fields:state.pending.facts.map(f=>({key:f.key,value:f.value}))}:null,requiredReadback:state.pending?confirmationText(state.pending):null,latestCallerTurn:state.turns.filter(t=>t.role==='caller').at(-1)?.id,latestAssistantTurn:state.turns.filter(t=>t.role==='assistant').at(-1)?.id,referral:state.referral};
}
