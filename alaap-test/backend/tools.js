import {randomUUID} from 'node:crypto';
import {modelCase,profileFields,caseFields,requireValue,text,confirmationText,confirmationAnswer,matchesReadback} from './workflow.js';
import {projectWorkspace} from './workspace.js';
import {interpretConfirmation,interpretLocationRestatement,interpretReadback} from './confirmation.js';
import {transcriptQuality} from '../speech-guard.js';

const strings=names=>Object.fromEntries(names.map(name=>[name,{type:'string'}]));
const declaration=(name,description,properties={},required=[])=>({name,description,parametersJsonSchema:{type:'object',properties,required,additionalProperties:false}});
function readbackRecovery(state){
  return {error:'Read-back must include all proposed values',...modelCase(state),requiredReadback:confirmationText(state.pending),
    sourceText:state.turns.findLast(t=>t.role==='caller')?.text,
    recovery:'The spoken read-back does not match the stored proposal. Repeating that read-back or asking for yes again cannot confirm it. If the latest caller explicitly supplied the corrected detail, call propose_facts to replace the pending batch using that turn and its exact raw quote. Otherwise ask the caller to say the detail again, then propose it. Check the returned value before reading it back. Never treat a yes as a corrected location or name; never silently translate or guess a stored value.'};
}
export const declarations=[
  declaration('case_status','Get current backend state and latest caller/assistant turn IDs.'),
  declaration('propose_facts','Propose facts from the latest caller transcript; the backend binds the source turn. Values remain unconfirmed. Copy raw wording exactly. Phone values must be strings retaining the leading zero. Never invent facts.',{
    scope:{type:'string',enum:['profile','facts']},facts:{type:'array',maxItems:12,items:{type:'object',properties:{key:{type:'string',enum:[...profileFields,...caseFields]},value:{anyOf:[{type:'string'},{type:'number'},{type:'boolean'}]},raw:{type:'string'}},required:['key','value','raw'],additionalProperties:false}},
  },['scope','facts']),
  declaration('mark_readback','Check the latest delivered assistant read-back for the active proposal. Playback is recorded automatically; wait for it to finish before asking for confirmation.'),
  declaration('confirm_facts','Confirm the active proposal using the latest caller reply after delivered read-back. No IDs are needed. Corrections require a new proposal.'),
  declaration('complete_registration','Register only after the backend confirms name, location, phone and service consent.'),
  declaration('retrieve_guidance','Retrieve only reviewed guidance matching confirmed rice case facts. No model-supplied farmer or case ID is accepted.'),
  declaration('request_referral','Record a referral REQUEST, never a confirmed appointment or callback.',strings(['reason']),['reason']),
];
export class LiveWorkflow{
  constructor(database,state,knowledge,{confirmation=interpretConfirmation,locationRestatement=interpretLocationRestatement,readback=interpretReadback}={}){Object.assign(this,{database,id:state.id,knowledge,confirmation,locationRestatement,readback});this.serial=Promise.resolve();this.cancelled=new Set();this.delivered=new Set();this.readbackChecks=new Map();}
  queue(work){const result=this.serial.then(work);this.serial=result.catch(()=>{});return result;}
  workspace(){return this.queue(async()=>projectWorkspace(await this.database.get(this.id)));}
  turn(role,content){return this.queue(async()=>{
    if(!content?.trim())return;
    if(role==='caller'){this.callerRejected=!transcriptQuality(content).usable;if(this.callerRejected)return;}
    const turnId=randomUUID();await this.database.apply(this.id,{id:turnId,type:'turn',turnId,role,text:content});return turnId;
  });}
  cancel(ids){ids.forEach(id=>this.cancelled.add(id));}
  async recordReadback(state,event){
    try{return await this.database.apply(this.id,event);}
    catch(error){
      if(error.message!=='Read-back must include all proposed values')throw error;
      const turn=state.turns.find(t=>t.id===event.turnId),facts=state.pending.facts.filter(f=>!matchesReadback(f,turn.text));
      if(facts.some(f=>!['name','location'].includes(f.key)))throw error;
      const cacheKey=state.pending.id+':'+turn.id;
      if(!this.readbackChecks.has(cacheKey))this.readbackChecks.set(cacheKey,await this.readback({readback:turn.text,facts:facts.map(({key,value,raw,sourceTurn})=>({key,value,raw,sourceText:state.turns.find(t=>t.id===sourceTurn)?.text}))}));
      const proof=this.readbackChecks.get(cacheKey);if(!proof)throw error;
      return this.database.apply(this.id,{...event,actor:'readback_interpreter',interpretation:{...proof,batchId:state.pending.id,turnId:turn.id}});
    }
  }
  played(turnId){return this.queue(async()=>{
    const state=await this.database.get(this.id);
    requireValue(state.turns.some(turn=>turn.id===turnId&&turn.role==='assistant'),'Unknown assistant playback turn');
    this.delivered.add(turnId);
    if(state.pending&&!state.pending.readbackTurn){
      try{return await this.recordReadback(state,{id:'played:'+turnId,type:'readback',batchId:state.pending.id,turnId});}
      catch{return state;}
    }
    return state;
  });}
  invoke(call){return this.queue(async()=>{
    requireValue(typeof call.id==='string'&&call.id.length<=128,'Tool call ID required');
    if(this.cancelled.has(call.id))return {cancelled:true};
    const args=call.args||{};
    if(['propose_facts','confirm_facts'].includes(call.name))requireValue(!this.callerRejected,'Caller speech is unclear; ask for a repeat before using any previous turn');
    let state=await this.database.get(this.id);
    if(call.name==='case_status')return modelCase(state);
    if(call.name==='retrieve_guidance')return state.registrationComplete?this.knowledge.retrieve(state):{kind:'REGISTRATION_REQUIRED',registration:modelCase(state).registration};
    const event={id:call.id};
    switch(call.name){
      case 'propose_facts':Object.assign(event,{type:'propose',scope:args.scope,turnId:args.turnId??state.turns.findLast(t=>t.role==='caller')?.id,facts:args.facts});break;
      case 'mark_readback':{
        const turnId=args.turnId??state.pending?.readbackTurn??state.turns.findLast(t=>t.role==='assistant'&&this.delivered.has(t.id))?.id;
        requireValue(this.delivered.has(turnId),'Wait until read-back audio has finished playing');Object.assign(event,{type:'readback',batchId:args.batchId??state.pending?.id,turnId});break;
      }
      case 'confirm_facts':{
        Object.assign(event,{type:'confirm',batchId:args.batchId??state.pending?.id,turnId:args.turnId??state.turns.findLast(t=>t.role==='caller')?.id});
        let pending=state.pending,readback=state.turns.find(t=>t.id===pending?.readbackTurn);
        const reply=state.turns.find(t=>t.id===event.turnId&&t.role==='caller');
        if(pending&&pending.id===event.batchId&&!readback){
          const sourceIndex=state.turns.findIndex(t=>t.id===pending.facts[0].sourceTurn),replyIndex=state.turns.indexOf(reply);
          const delivered=state.turns.findLast((t,i)=>i>sourceIndex&&i<replyIndex&&t.role==='assistant'&&this.delivered.has(t.id));
          if(delivered){
            // Recover only an explicit caller restatement; a yes alone cannot rewrite a place.
            if(pending.scope==='profile'&&pending.facts.length===1&&pending.facts[0].key==='location'){
              const turns=state.turns.slice(sourceIndex+1,state.turns.indexOf(delivered)).filter(t=>t.role==='caller').slice(-8);
              const repair=turns.length?await this.locationRestatement({readback:delivered.text,turns}):null;
              if(this.cancelled.has(call.id))return {cancelled:true};
              const source=turns.find(t=>t.id===repair?.turnId);
              if(source&&typeof repair.value==='string'&&repair.value.trim().length>=2&&source.text.includes(repair.value)&&delivered.text.includes(repair.value)&&transcriptQuality(source.text).usable){
                state=await this.database.apply(this.id,{id:randomUUID(),type:'propose',scope:'profile',turnId:source.id,facts:[{key:'location',value:repair.value,raw:repair.value}]});
                state=await this.database.apply(this.id,{id:randomUUID(),type:'readback',batchId:state.pending.id,turnId:delivered.id});
                pending=state.pending;readback=delivered;event.batchId=pending.id;
              }
            }
            if(!readback)return readbackRecovery(state);
          }
        }
        requireValue(pending&&pending.id===event.batchId&&readback,'Read back the active batch first');
        requireValue(reply&&state.turns.findIndex(t=>t.id===reply.id)>state.turns.findIndex(t=>t.id===readback.id),'A later caller confirmation is required');
        requireValue(transcriptQuality(reply.text,{confirmation:true}).usable,'Caller confirmation is unclear; ask naturally for a repeat');
        if(confirmationAnswer(reply.text)===null){
          const decision=await this.confirmation({reply:reply.text,readback:readback.text,fields:pending.facts.map(({key,value})=>({key,value}))});
          if(!['AFFIRM','DENY'].includes(decision.decision))return {...modelCase(state),confirmation:decision.decision,question:decision.decision==='CORRECTION'?'কোন তথ্যটা বদলাতে হবে, বলবেন?':'আমি ঠিক বুঝেছি কি না নিশ্চিত হতে চাই—পড়ে শোনানো তথ্যগুলো ঠিক আছে, নাকি কিছু বদলাতে হবে?',interpretationStatus:decision.reason||'interpreted'};
          Object.assign(event,{actor:'confirmation_interpreter',interpretation:{...decision,readbackTurn:readback.id}});
        }
        break;
      }
      case 'complete_registration':event.type='register';break;
      case 'request_referral':Object.assign(event,{type:'referral',reason:text(args.reason)});break;
      default:throw new Error('Unknown backend tool');
    }
    try{state=event.type==='readback'?await this.recordReadback(state,event):await this.database.apply(this.id,event);}
    catch(error){
      if(call.name==='mark_readback'&&error.message==='Read-back must include all proposed values')return readbackRecovery(state);
      if(call.name==='propose_facts'&&error.message==='Fact wording must occur in the source turn'){
        const source=state.turns.find(t=>t.id===event.turnId&&t.role==='caller');
        return {error:error.message,sourceText:source?.text,recovery:'Copy raw wording exactly from this current source text. Do not normalize, paraphrase or invent the raw quote. Retry the proposal before reading it back.'};
      }
      throw error;
    }
    return {...modelCase(state),requiredReadback:state.pending?confirmationText(state.pending):null};
  });}
  async close(){await this.queue(()=>this.database.apply(this.id,{id:randomUUID(),type:'close'}));}
}
