import {randomUUID} from 'node:crypto';

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
  return {id:randomUUID(),ownerId,version:0,profileId:randomUUID(),plotId:randomUUID(),cycleId:randomUUID(),status:'INCOMPLETE',identityVerified:false,registrationComplete:false,profile:{},facts:{},turns:[],pending:null,referral:null,metadata:{numberSource:metadata.numberSource==='provider'?'provider_unverified':'caller_unverified',storageConsent:metadata.storageConsent===true,consentVersion:'research-demo-v1'},events:[],updatedAt:new Date().toISOString()};
}
export function confirmationText(pending){return pending.facts.map(f=>f.key+': '+(typeof f.value==='boolean'?(f.value?'হ্যাঁ':'না'):String(f.value))).join('। ');}
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
      requireValue(state.pending?.id===event.batchId,'Stale confirmation batch');
      const turn=state.turns.find(t=>t.id===event.turnId&&t.role==='assistant');requireValue(turn,'Delivered assistant read-back required');
      requireValue(state.turns.indexOf(turn)>state.turns.findIndex(t=>t.id===state.pending.facts[0].sourceTurn),'Read-back must follow the source utterance');
      const spoken=turn.text.replace(/[০-৯]/g,char=>String(char.charCodeAt(0)-0x09e6));
      requireValue(state.pending.facts.every(f=>spoken.includes(typeof f.value==='boolean'?(f.value?'হ্যাঁ':'না'):String(f.value))||spoken.includes(f.raw)),'Read-back must include all proposed values');
      state.pending.readbackTurn=turn.id;break;
    }
    case 'confirm':{
      const pending=state.pending;requireValue(pending?.id===event.batchId&&pending.readbackTurn,'Read back the active batch first');
      const index=state.turns.findIndex(t=>t.id===pending.readbackTurn);
      const reply=state.turns.find((t,i)=>i>index&&t.id===event.turnId&&t.role==='caller');requireValue(reply,'A later caller confirmation is required');
      const answer=reply.text.normalize('NFC').trim().replace(/[।.!?,]/g,'').trim();
      if(/^(না|নাই|না জি|no)$/iu.test(answer)){state.pending=null;break;}
      requireValue(/^(হ্যাঁ|হ্যা|জি|হ|ঠিক|ঠিক আছে|হ্যাঁ ঠিক|হ্যাঁ ঠিক আছে|yes|correct)$/iu.test(answer),'Ambiguous answer; ask for an explicit yes or correction');
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
export function modelCase(state){
  // Only pending registration values are exposed for read-back; stored identity stays out of retrieval.
  return {caseId:state.id,status:state.status,registrationComplete:state.registrationComplete,facts:state.facts,pending:state.pending?{batchId:state.pending.id,scope:state.pending.scope,fields:state.pending.facts.map(f=>({key:f.key,value:f.value}))}:null,latestCallerTurn:state.turns.filter(t=>t.role==='caller').at(-1)?.id,latestAssistantTurn:state.turns.filter(t=>t.role==='assistant').at(-1)?.id,referral:state.referral};
}
