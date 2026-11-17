import {GoogleGenAI} from '@google/genai';
import {requireValue,text} from './workflow.js';

export const ricePathways={
  spots:{question:'দাগগুলো পাতার কোন অংশে দেখা যাচ্ছে?',required:['crop','symptom','symptomLocation','duration']},
  yellow:{question:'পুরো পাতা হলুদ, নাকি শুধু ডগা বা কিনারা?',required:['crop','symptom','symptomLocation','duration']},
  insects:{question:'পোকাগুলো পাতার ওপরে নাকি নিচে দেখছেন?',required:['crop','symptom','symptomLocation','duration']},
};
export async function embed(content,taskType){
  const ai=new GoogleGenAI({vertexai:true,project:process.env.GOOGLE_CLOUD_PROJECT,location:process.env.GOOGLE_CLOUD_LOCATION||'us-central1'});
  const result=await ai.models.embedContent({model:'gemini-embedding-001',contents:content,config:{taskType,outputDimensionality:768,httpOptions:{timeout:15000}}});
  const vector=result.embeddings?.[0]?.values;
  requireValue(vector?.length===768&&vector.every(Number.isFinite),'Embedding service returned invalid dimensions');return vector;
}
export class Knowledge{
  constructor(client,{embedding=embed}={}){Object.assign(this,{client,embedding});}
  async search(query,{crop=null,stage=null,district=null,research=false,semantic=true}={}){
    query=text(query,1000);
    let vector=null,embeddingStatus='keyword-only';
    if(semantic){try{vector=await this.embedding(query,'RETRIEVAL_QUERY');embeddingStatus='semantic+keyword';}catch{embeddingStatus='embedding-unavailable; keyword fallback';}}
    const {data,error}=await this.client.rpc('agritech_search',{p_query:query,p_embedding:vector,p_crop:crop,p_stage:stage,p_district:district,p_research:research});
    requireValue(!error,'Knowledge search unavailable');return {evidence:data||[],embeddingStatus};
  }
  async retrieve(state){
    const facts=state.facts,value=key=>facts[key]?.confirmedBy?facts[key].value:null;
    const crop=value('crop');
    if(!crop)return {kind:'ASK',question:'কোন ফসলে সমস্যা হচ্ছে? ফসলের নামটি বলবেন?',reason:'unconfirmed_crop',evidence:[]};
    if(!/^(ধান|rice)$/iu.test(crop))return {kind:'REFER',reason:'unsupported_crop',message:'এই পরীক্ষায় শুধু ধানের তথ্য যাচাই করা হচ্ছে। একজন কৃষি বিশেষজ্ঞের পরামর্শ নিন।',evidence:[]};
    const symptom=value('symptom');
    if(!symptom)return {kind:'ASK',question:'ফসলে কী লক্ষণ দেখছেন?',reason:'unconfirmed_symptom',evidence:[]};
    const pathway=/দাগ|spot/iu.test(symptom)?ricePathways.spots:/হলুদ|yellow/iu.test(symptom)?ricePathways.yellow:/পোকা|insect/iu.test(symptom)?ricePathways.insects:null;
    if(!pathway)return {kind:'REFER',reason:'unsupported_pathway',evidence:[]};
    if(!value('symptomLocation'))return {kind:'ASK',question:pathway.question,reason:'missing_location',evidence:[]};
    if(!value('duration'))return {kind:'ASK',question:'সমস্যাটি কবে থেকে দেখা যাচ্ছে?',reason:'missing_duration',evidence:[]};
    const query=['ধান',symptom,value('symptomLocation'),value('duration')].join(' ');
    const result=await this.search(query,{crop:'rice',stage:value('stage'),district:value('farmLocation')});
    return {kind:result.evidence.length?'EVIDENCE':'REFER',...result,reason:result.evidence.length?'reviewed_context_only':'no_approved_evidence',restriction:'This research demo does not authorize disease diagnosis, chemical treatment or dosing. Do not invent advice, appointments or SMS.'};
  }
}
