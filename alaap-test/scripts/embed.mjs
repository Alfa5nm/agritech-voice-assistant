import {supabaseClient} from '../backend/database.js';
import {embed} from '../backend/knowledge.js';
process.loadEnvFile(new URL('../.env.local',import.meta.url));
if(!process.env.AGRITECH_ACCESS_TOKEN)throw new Error('Provide a temporary authenticated operator access token');
const client=supabaseClient(process.env.AGRITECH_ACCESS_TOKEN);
const {data,error}=await client.from('agritech_chunks').select('id,text').is('embedding',null).limit(50);
if(error)throw new Error('Unable to read pending embeddings');
let embedded=0;
for(const item of data){
  const values=await embed(item.text,'RETRIEVAL_DOCUMENT');
  const {error}=await client.rpc('agritech_set_embedding',{p_id:item.id,p_embedding:values,p_model:'gemini-embedding-001'});
  if(error)throw new Error('Embedding write failed');embedded++;
}
console.log(JSON.stringify({embedded,model:'gemini-embedding-001',dimensions:768}));
