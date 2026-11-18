import {profileFields,caseFields,registrationStatus} from './workflow.js';

// Operator-only projection. Never pass this identity-bearing view to the model.
export function projectWorkspace(state){
  const project=(facts,keys)=>Object.fromEntries(keys.filter(key=>facts[key]).map(key=>{
    const fact=facts[key];
    return [key,{value:fact.value,status:fact.status,raw:fact.raw,sourceTurn:fact.sourceTurn,confirmedBy:fact.confirmedBy,previous:fact.previous}];
  }));
  return {caseId:state.id,version:state.version,status:state.status,synthetic:state.metadata?.synthetic===true,
    registrationComplete:state.registrationComplete,registration:registrationStatus(state),
    profile:project(state.profile,profileFields),facts:project(state.facts,caseFields),
    pending:state.pending?{scope:state.pending.scope,readbackTurn:state.pending.readbackTurn||null,
      facts:state.pending.facts.map(({key,value,raw,sourceTurn})=>({key,value,raw,sourceTurn,status:'proposed'}))}:null,
    turns:state.turns.slice(-30).map(({id,role,text})=>({id,role,text:text.slice(0,2000)}))};
}
