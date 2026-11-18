export const labels={name:'Name',age:'Age · optional',location:'Location',phone:'Phone',language:'Language',serviceConsent:'Service consent',recordingConsent:'Recording consent',trainingConsent:'Training consent',followupConsent:'Follow-up consent',crop:'Crop',stage:'Growth stage',symptom:'Issue',symptomLocation:'Where on plant',duration:'Since',farmLocation:'Field location',priorActions:'Inputs / actions',quantity:'Quantity',unit:'Local unit',negation:'Negation'};
export const toolLabels={case_status:'Checking case context',propose_facts:'Extracting proposed facts',mark_readback:'Recording delivered read-back',confirm_facts:'Checking caller confirmation',complete_registration:'Saving confirmed registration',retrieve_guidance:'Retrieving reviewed evidence',request_referral:'Recording referral request'};
export const stageForTool={case_status:'context',propose_facts:'extraction',mark_readback:'confirmation',confirm_facts:'confirmation',complete_registration:'context',retrieve_guidance:'retrieval',request_referral:'context'};

export function factEntries(state){
  if(!state)return [];
  const fields=new Map();
  for(const scope of ['profile','facts'])for(const [key,fact] of Object.entries(state[scope]||{}))if(labels[key])fields.set(scope+':'+key,{...fact,key,scope});
  for(const fact of state.pending?.facts||[]){
    const scope=state.pending.scope;if(!labels[fact.key]||!['profile','facts'].includes(scope))continue;
    const previous=fields.get(scope+':'+fact.key)?.value;
    fields.set(scope+':'+fact.key,{...fact,scope,status:'proposed',awaiting:!!state.pending.readbackTurn,previous:previous??null});
  }
  return [...fields.values()];
}

export function transcriptParts(text,turnId,fields){
  const matches=[];
  if(turnId)for(const fact of fields){
    if(fact.sourceTurn!==turnId||typeof fact.raw!=='string'||!fact.raw.length)continue;
    const index=text.indexOf(fact.raw);if(index>=0)matches.push({start:index,end:index+fact.raw.length,key:fact.key,status:fact.status});
  }
  matches.sort((a,b)=>a.start-b.start||b.end-a.end);
  const parts=[];let offset=0;
  for(const match of matches){if(match.start<offset)continue;if(match.start>offset)parts.push({text:text.slice(offset,match.start)});parts.push({text:text.slice(match.start,match.end),key:match.key,status:match.status});offset=match.end;}
  if(offset<text.length||!parts.length)parts.push({text:text.slice(offset)});
  return parts;
}

export function acceptSnapshot(current,next,caseId){
  return !!next&&next.caseId===caseId&&Number.isInteger(next.version)&&(!current||next.version>=current.version);
}

export function sourceUrl(value){
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}
}

export function retrievalExplanation(result){
  const reasons={unconfirmed_crop:'The crop needs confirmation.',unconfirmed_symptom:'The symptom needs confirmation.',missing_location:'Where the symptom appears is missing.',missing_duration:'The symptom duration is missing.',unsupported_crop:'This research intake supports rice only.',unsupported_pathway:'This symptom is outside the current rice pathways.',no_approved_evidence:'No approved evidence matched this case.',reviewed_context_only:'Reviewed context was retrieved; it does not authorise a diagnosis or dose.'};
  if(result.kind==='REGISTRATION_REQUIRED')return 'Registration must be completed before retrieval.';
  return reasons[result.reason]||'Retrieval returned a result. Review it before use.';
}
