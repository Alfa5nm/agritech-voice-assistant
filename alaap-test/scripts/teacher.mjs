import {GoogleGenAI} from '@google/genai';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {caseFields} from '../backend/workflow.js';

process.loadEnvFile(new URL('../.env.local',import.meta.url));
const count=Number(process.argv[2]||30);
if(!Number.isInteger(count)||count<1||count>300)throw new Error('Choose 1–300 synthetic drafts');
const ai=new GoogleGenAI({vertexai:true,project:process.env.GOOGLE_CLOUD_PROJECT,location:process.env.GOOGLE_CLOUD_LOCATION||'us-central1'});
const folder=new URL('../../research/private/',import.meta.url);await mkdir(folder,{recursive:true});
const resume=process.argv[3];if(resume&&!/^teacher-[\w-]+\.jsonl$/.test(resume))throw new Error('Resume using a teacher draft filename only');
const path=new URL(resume||'teacher-'+new Date().toISOString().replace(/[:.]/g,'-')+'.jsonl',folder);
const examples=resume?(await readFile(path,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse):[];
for(let offset=examples.length;offset<count;offset+=10){
  const size=Math.min(10,count-offset);
  const response=await ai.models.generateContent({model:process.env.GEMINI_EXTRACT_MODEL||'gemini-2.5-flash',contents:`Generate ${size} diverse synthetic Bengali farmer utterances for rice intake: leaf spots, yellowing, insects, negation, corrections, quantities and asking for repetition. Include some Chittagonian examples, clearly marked as synthetic and needing native-speaker review. No names, ages, phone numbers, precise locations, treatments or medical/chemical advice. Each item has text, normalized (same meaning, numbers and negation preserved), intent, dialect, and facts. Fact values must be exact substrings of text, from keys ${caseFields.join(', ')}. Return a JSON array only. This is batch ${offset/10+1}; vary scenarios rather than repeating templates.`,config:{responseMimeType:'application/json',thinkingConfig:{thinkingBudget:0},responseJsonSchema:{type:'array',items:{type:'object',properties:{text:{type:'string'},normalized:{type:'string'},intent:{type:'string'},dialect:{type:'string'},facts:{type:'object',properties:Object.fromEntries(caseFields.map(key=>[key,{type:'string'}])),additionalProperties:false}},required:['text','normalized','intent','dialect','facts'],additionalProperties:false}},maxOutputTokens:8192,httpOptions:{timeout:45000}}});
  const items=JSON.parse(response.text);
  if(!Array.isArray(items)||items.length!==size)throw new Error('Teacher returned an unexpected batch');
  for(const item of items){
    if(typeof item.text!=='string'||typeof item.normalized!=='string'||!item.facts||Object.keys(item.facts).some(key=>!caseFields.includes(key)))throw new Error('Invalid synthetic example');
    if(/(?:\+?88|\+?৮৮)?[0০][1১][0-9০-৯]{9}/u.test(item.text))throw new Error('Phone-like content rejected');
    const spans=Object.entries(item.facts),invalid=spans.some(([,value])=>typeof value!=='string'||!value||!item.text.includes(value));
    const entities=spans.filter(([,value])=>typeof value==='string'&&value&&item.text.includes(value)).map(([label,value])=>({label,start:item.text.indexOf(value),end:item.text.indexOf(value)+value.length}));
    examples.push({...item,id:randomUUID(),groupId:randomUUID(),split:'unassigned',entities,requiresSpanReview:invalid,status:'draft',reviewedBy:null,containsPersonalData:false,source:'synthetic-teacher',teacherModel:process.env.GEMINI_EXTRACT_MODEL||'gemini-2.5-flash',knowledgeApproval:false});
  }
  await writeFile(path,examples.map(item=>JSON.stringify(item)).join('\n')+'\n');
  console.log('Saved draft batch',examples.length);
}
await writeFile(new URL(path.href+'.complete'),'complete\n');
console.log(JSON.stringify({drafts:examples.length,path:fileURLToPath(path),reviewed:0,trainingEligible:false}));
