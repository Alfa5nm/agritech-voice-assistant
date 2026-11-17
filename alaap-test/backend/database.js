import {createCipheriv,createDecipheriv,randomBytes,createHmac} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {applyEvent,newCase,normalizePhone,requireValue} from './workflow.js';

export function encryption(keyHex,lookupHex){
  requireValue(/^[a-f0-9]{64}$/i.test(keyHex||'')&&/^[a-f0-9]{64}$/i.test(lookupHex||'')&&keyHex!==lookupHex,'Configure two distinct 32-byte encryption and phone lookup keys');
  const key=Buffer.from(keyHex,'hex');
  return {
    seal(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);const body=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64');},
    open(value){const data=Buffer.from(value,'base64');requireValue(data.length>28,'Invalid encrypted record');const cipher=createDecipheriv('aes-256-gcm',key,data.subarray(0,12));cipher.setAuthTag(data.subarray(12,28));return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString('utf8'));},
    phoneHash(phone){return createHmac('sha256',Buffer.from(lookupHex,'hex')).update(normalizePhone(phone)).digest('hex');},
  };
}
export function supabaseClient(token){
  requireValue(process.env.SUPABASE_URL&&process.env.SUPABASE_PUBLISHABLE_KEY,'Dedicated Supabase configuration is missing');
  return createClient(process.env.SUPABASE_URL,process.env.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:token?{Authorization:'Bearer '+token}:{}}});
}
export class Database{
  constructor(client,ownerId,crypto){Object.assign(this,{client,ownerId,crypto});}
  async get(id){
    const {data,error}=await this.client.from('agritech_cases').select('payload').eq('id',id).eq('owner_id',this.ownerId).single();
    requireValue(!error&&data,'Case unavailable');const state=this.crypto.open(data.payload);requireValue(state.id===id&&state.ownerId===this.ownerId,'Case binding mismatch');return state;
  }
  async create(metadata){
    const {error:schemaError}=await this.client.from('agritech_cases').select('profile_id').limit(0);
    requireValue(!schemaError,'Apply the profile-history database migration before creating cases');
    const state=newCase(this.ownerId,metadata);
    const {error}=await this.client.from('agritech_cases').insert({id:state.id,owner_id:this.ownerId,version:0,status:state.status,payload:this.crypto.seal(state)});
    requireValue(!error,'Unable to create persistent case');return state;
  }
  async apply(id,event){
    const before=await this.get(id),after=applyEvent(before,event);if(before===after)return after;
    const registered=after.registrationComplete;
    const {error}=await this.client.rpc('agritech_commit_case',{
      p_case_id:id,p_expected_version:before.version,p_event_key:event.id,p_event_type:event.type,p_version:after.version,p_status:after.status,p_payload:this.crypto.seal(after),
      p_profile_id:registered?after.profileId:null,p_profile_payload:registered?this.crypto.seal(after.profile):null,
      p_phone_hash:registered?this.crypto.phoneHash(after.profile.phone.value):null,p_phone_cipher:registered?this.crypto.seal(after.profile.phone.value):null,
      p_plot_id:registered&&after.facts.farmLocation?.confirmedBy?after.plotId:null,p_plot_payload:registered&&after.facts.farmLocation?.confirmedBy?this.crypto.seal({farmLocation:after.facts.farmLocation}):null,
      p_cycle_id:registered&&after.facts.farmLocation?.confirmedBy&&after.facts.crop?.confirmedBy?after.cycleId:null,p_cycle_payload:registered&&after.facts.crop?.confirmedBy?this.crypto.seal({crop:after.facts.crop,stage:after.facts.stage||null}):null,
    });
    requireValue(!error,'Case changed or persistence failed; reload before retrying');return after;
  }
  async list(){
    const {data,error}=await this.client.from('agritech_cases').select('id,status,version,updated_at').eq('owner_id',this.ownerId).order('updated_at',{ascending:false}).limit(50);
    requireValue(!error,'Unable to list cases');return data;
  }
  async findProfiles(phone){
    const {data,error}=await this.client.from('agritech_phone_links').select('profile_id').eq('owner_id',this.ownerId).eq('phone_hash',this.crypto.phoneHash(phone));
    requireValue(!error,'Unable to look up phone');return data;
  }
  async history(caseId,profileId){
    const state=await this.get(caseId);requireValue(state.identityVerified&&state.verifiedProfileId===profileId,'Operator identity verification required for this profile before history access');
    const {data,error}=await this.client.from('agritech_profiles').select('payload').eq('id',profileId).eq('owner_id',this.ownerId).single();
    requireValue(!error&&data,'Profile unavailable');
    const {data:cases,error:caseError}=await this.client.from('agritech_cases').select('payload').eq('profile_id',profileId).eq('owner_id',this.ownerId).order('updated_at',{ascending:false}).limit(20);
    requireValue(!caseError,'Previous cases unavailable');
    return {profile:this.crypto.open(data.payload),cases:cases.map(item=>{const previous=this.crypto.open(item.payload);return {id:previous.id,status:previous.status,facts:previous.facts,referral:previous.referral,updatedAt:previous.updatedAt};})};
  }
}
