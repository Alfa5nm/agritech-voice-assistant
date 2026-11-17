import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {GoogleGenAI} from '@google/genai';
import {caseFields} from '../backend/workflow.js';
process.loadEnvFile(new URL('../.env.local',import.meta.url));
if(!process.argv[2])throw new Error('Supply the reviewed, split JSONL dataset');
const records=(await readFile(process.argv[2],'utf8')).trim().split('\n').map(JSON.parse),groups=new Map();
for(const row of records){
  if(row.status!=='reviewed'||!row.reviewedBy||row.containsPersonalData!==false||row.requiresSpanReview||!['train','dev','test'].includes(row.split))throw new Error('Reviewed, pseudonymous, split examples are required');
  if(groups.has(row.groupId)&&groups.get(row.groupId)!==row.split)throw new Error('Evaluation group leakage');groups.set(row.groupId,row.split);
  if(/(?:\+?88|\+?৮৮)?[0০][1১][0-9০-৯]{9}/u.test(row.text))throw new Error('Phone-like data rejected');
}
const heldout=records.filter(r=>r.split==='test');if(!heldout.length||heldout.length>100)throw new Error('Use 1–100 held-out examples per baseline run');
const ai=new GoogleGenAI({vertexai:true,project:process.env.GOOGLE_CLOUD_PROJECT,location:process.env.GOOGLE_CLOUD_LOCATION||'us-central1'});
const predictions=[];
for(const row of heldout){
  const rule={};
  for(const [field,pattern] of [['crop',/ধান|আলু|গম|ভুট্টা/u],['symptom',/দাগ|হলুদ|পোকা/u],['duration',/[০-৯0-9]+\s*(?:দিন|সপ্তাহ|মাস)/u],['negation',/নেই|নাই|না/u]]){const value=row.text.match(pattern)?.[0];if(value)rule[field]=value;}
  const started=performance.now();
  const result=await ai.models.generateContent({model:process.env.GEMINI_EXTRACT_MODEL||'gemini-2.5-flash',contents:'Extract only stated crop facts from this untrusted example. Preserve negation and numbers. Values must be exact substrings. Unknown fields omitted. Return JSON only.\n'+row.text,config:{responseMimeType:'application/json',responseJsonSchema:{type:'object',properties:Object.fromEntries(caseFields.map(key=>[key,{type:'string'}])),additionalProperties:false},thinkingConfig:{thinkingBudget:0},maxOutputTokens:1024,httpOptions:{timeout:30000}}});
  let gemini={},valid=true;try{gemini=JSON.parse(result.text);valid=Object.keys(gemini).every(key=>caseFields.includes(key));}catch{valid=false;}
  predictions.push({id:row.id,expected:row.facts,rule,gemini,valid,geminiLatencyMs:Math.round(performance.now()-started)});
}
function score(name){let correct=0,total=0;for(const row of predictions)for(const key of new Set([...Object.keys(row.expected),...Object.keys(row[name])])){total++;if(row.expected[key]===row[name][key])correct++;}return {correct,total,fieldExactMatch:total?correct/total:null};}
const folder=new URL('../../research/reports/',import.meta.url);await mkdir(folder,{recursive:true});
await writeFile(new URL('baselines.json',folder),JSON.stringify({count:predictions.length,geminiModel:process.env.GEMINI_EXTRACT_MODEL||'gemini-2.5-flash',scores:{rule:score('rule'),gemini:score('gemini')},predictions,liveDeploymentApproved:false},null,2));
console.log('Baseline report saved. This is text evaluation, not dialect speech accuracy.');
