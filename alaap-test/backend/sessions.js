import {mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {encryption,supabaseClient} from './database.js';

export const sessionAge=7*24*60*60;
// Local single-server store; tokens are encrypted and never returned to the browser.
export function operatorSessions({file=new URL('../.secrets/operator-sessions',import.meta.url),client=supabaseClient,crypt=()=>encryption(process.env.PROFILE_ENCRYPTION_KEY,process.env.PHONE_LOOKUP_KEY)}={}){
  let records;const refreshing=new Map();
  function load(){
    if(records)return;
    try{records=new Map(crypt().open(readFileSync(file,'utf8')));}catch(error){if(error.code!=='ENOENT')throw new Error('Stored operator sessions could not be opened');records=new Map();}
  }
  function save(){mkdirSync(new URL('.',file),{recursive:true});const temp=new URL(file.href+'.tmp');writeFileSync(temp,crypt().seal([...records]),{mode:0o600});renameSync(temp,file);}
  function idFor(req){return req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('agritech_operator='))?.slice(18);}
  async function operator(token,email){const {data,error}=await client(token).from('agritech_operators').select('can_review').eq('email',email.toLowerCase()).single();if(error||!data)throw new Error('This account is not an authorized Agritech operator');return data;}
  return {
    async create(data){
      load();const role=await operator(data.session.access_token,data.user.email);
      for(const [id,session] of records)if(session.until<Date.now())records.delete(id);
      if(records.size>=100)throw new Error('Operator session limit reached');
      const id=randomBytes(32).toString('hex');
      records.set(id,{userId:data.user.id,email:data.user.email,token:data.session.access_token,refreshToken:data.session.refresh_token,reviewer:role.can_review,expires:data.session.expires_at*1000,until:Date.now()+sessionAge*1000});save();return {id,reviewer:role.can_review};
    },
    async get(req,minValidity=60000){
      load();const id=idFor(req),session=records.get(id);if(!session)return null;
      if(session.until<=Date.now()){records.delete(id);save();return null;}
      if(session.expires>Date.now()+minValidity)return session;
      if(!session.refreshToken){records.delete(id);save();return null;}
      if(!refreshing.has(id))refreshing.set(id,(async()=>{
        const {data,error}=await client().auth.refreshSession({refresh_token:session.refreshToken});
        if(error){if(error.status>=400&&error.status<500&&error.status!==429){records.delete(id);save();return null;}throw new Error('Session renewal unavailable; retry shortly');}
        if(!data.session||data.user?.id!==session.userId){records.delete(id);save();return null;}
        let role;try{role=await operator(data.session.access_token,data.user.email);}catch{records.delete(id);save();return null;}
        // A concurrent logout must not resurrect the session.
        if(records.get(id)!==session)return null;
        Object.assign(session,{token:data.session.access_token,refreshToken:data.session.refresh_token,expires:data.session.expires_at*1000,reviewer:role.can_review});save();return session;
      })().finally(()=>refreshing.delete(id)));
      return refreshing.get(id);
    },
    remove(req){load();records.delete(idFor(req));save();},
    valid(session){return records&&[...records.values()].includes(session)&&session.expires>Date.now()&&session.until>Date.now();},
  };
}
