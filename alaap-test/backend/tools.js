import {randomUUID} from 'node:crypto';
import {modelCase,profileFields,caseFields,requireValue,text,confirmationText} from './workflow.js';

const strings=names=>Object.fromEntries(names.map(name=>[name,{type:'string'}]));
const declaration=(name,description,properties={},required=[])=>({name,description,parametersJsonSchema:{type:'object',properties,required,additionalProperties:false}});
export const declarations=[
  declaration('case_status','Get current backend state and latest caller/assistant turn IDs.'),
  declaration('propose_facts','Propose facts from the latest caller transcript. Values remain unconfirmed. Preserve negation, raw wording and numbers. Never invent facts.',{
    scope:{type:'string',enum:['profile','facts']},turnId:{type:'string'},facts:{type:'array',maxItems:12,items:{type:'object',properties:{key:{type:'string',enum:[...profileFields,...caseFields]},value:{anyOf:[{type:'string'},{type:'number'},{type:'boolean'}]},raw:{type:'string'}},required:['key','value','raw'],additionalProperties:false}},
  },['scope','turnId','facts']),
  declaration('mark_readback','After speaking every proposed value, record its delivered assistant turn ID. Never claim a read-back before the audio has played.',strings(['batchId','turnId']),['batchId','turnId']),
  declaration('confirm_facts','Record the later caller turn explicitly confirming the current read-back. Corrections require a new proposal.',strings(['batchId','turnId']),['batchId','turnId']),
  declaration('complete_registration','Register only after the backend confirms name, location, phone and service consent.'),
  declaration('retrieve_guidance','Retrieve only reviewed guidance matching confirmed rice case facts. No model-supplied farmer or case ID is accepted.'),
  declaration('request_referral','Record a referral REQUEST, never a confirmed appointment or callback.',strings(['reason']),['reason']),
];
export class LiveWorkflow{
  constructor(database,state,knowledge){Object.assign(this,{database,id:state.id,knowledge});this.serial=Promise.resolve();this.cancelled=new Set();this.delivered=new Set();}
  queue(work){const result=this.serial.then(work);this.serial=result.catch(()=>{});return result;}
  turn(role,content){return this.queue(async()=>{
    if(!content?.trim())return;
    const turnId=randomUUID();await this.database.apply(this.id,{id:turnId,type:'turn',turnId,role,text:content});return turnId;
  });}
  cancel(ids){ids.forEach(id=>this.cancelled.add(id));}
  played(turnId){return this.queue(async()=>{
    const state=await this.database.get(this.id);
    requireValue(state.turns.some(turn=>turn.id===turnId&&turn.role==='assistant'),'Unknown assistant playback turn');
    this.delivered.add(turnId);
    if(state.pending&&!state.pending.readbackTurn){
      try{return await this.database.apply(this.id,{id:'played:'+turnId,type:'readback',batchId:state.pending.id,turnId});}
      catch{return state;}
    }
    return state;
  });}
  invoke(call){return this.queue(async()=>{
    requireValue(typeof call.id==='string'&&call.id.length<=128,'Tool call ID required');
    if(this.cancelled.has(call.id))return {cancelled:true};
    const args=call.args||{};
    let state=await this.database.get(this.id);
    if(call.name==='case_status')return modelCase(state);
    if(call.name==='retrieve_guidance')return this.knowledge.retrieve(state);
    const event={id:call.id};
    switch(call.name){
      case 'propose_facts':Object.assign(event,{type:'propose',scope:args.scope,turnId:args.turnId,facts:args.facts});break;
      case 'mark_readback':requireValue(this.delivered.has(args.turnId),'Wait until read-back audio has finished playing');Object.assign(event,{type:'readback',batchId:args.batchId,turnId:args.turnId});break;
      case 'confirm_facts':Object.assign(event,{type:'confirm',batchId:args.batchId,turnId:args.turnId});break;
      case 'complete_registration':event.type='register';break;
      case 'request_referral':Object.assign(event,{type:'referral',reason:text(args.reason)});break;
      default:throw new Error('Unknown backend tool');
    }
    state=await this.database.apply(this.id,event);return {...modelCase(state),requiredReadback:state.pending?confirmationText(state.pending):null};
  });}
  async close(){await this.queue(()=>this.database.apply(this.id,{id:randomUUID(),type:'close'}));}
}
