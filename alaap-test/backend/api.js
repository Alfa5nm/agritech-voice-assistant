import {randomUUID} from 'node:crypto';
import {supabaseClient,Database,encryption} from './database.js';
import {Knowledge} from './knowledge.js';
import {LiveWorkflow} from './tools.js';
import {projectWorkspace} from './workspace.js';
import {requireValue,text} from './workflow.js';
import {createJobs} from './jobs.js';
import {operatorSessions,sessionAge} from './sessions.js';
import {readdir,readFile} from 'node:fs/promises';

export async function readJson(req){
  requireValue(req.headers['content-type']==='application/json','JSON required');
  const chunks=[];let bytes=0;
  for await(const chunk of req){bytes+=chunk.length;requireValue(bytes<=65536,'Request too large');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString()||'{}');
}
export async function verifiedTokenSession(client,token){
  text(token,4096);
  const {data,error}=await client.auth.getUser(token);
  requireValue(!error&&data.user?.email,'Invalid or expired sign-in session');
  const expires=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8')).exp;
  requireValue(Number.isFinite(expires)&&expires>Date.now()/1000,'Sign-in session expired');
  return {data:{user:data.user,session:{access_token:token,expires_at:expires}},error:null};
}
export function createBackend(){
  const sessions=operatorSessions(),attempts=new Map(),jobs=createJobs();
  const configured=()=>!!(process.env.SUPABASE_URL&&process.env.SUPABASE_PUBLISHABLE_KEY&&process.env.PROFILE_ENCRYPTION_KEY&&process.env.PHONE_LOOKUP_KEY);
  const crypt=()=>encryption(process.env.PROFILE_ENCRYPTION_KEY,process.env.PHONE_LOOKUP_KEY);
  const sessionFor=req=>sessions.get(req);
  const database=session=>new Database(supabaseClient(session.token),session.userId,crypt());
  return {
    async openVoice(req,caseId,{provider='vertex'}={}){
      if(!caseId)return null;
      const session=await sessions.get(req,11*60000);requireValue(session,'Operator sign-in required');
      const db=database(session),state=await db.get(caseId);requireValue(state.status!=='CLOSED','Create a new case for a new conversation');
      requireValue(provider!=='gemini'||state.metadata.synthetic===true,'Gemini free-tier voice requires an explicitly synthetic case');
      const workflow=new LiveWorkflow(db,state,new Knowledge(db.client));
      workflow.synthetic=state.metadata.synthetic===true;
      workflow.authorized=()=>sessions.valid(session);return workflow;
    },
    async handle(req,res){
      const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/api/'))return false;
      res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');
      const json=(status,data)=>res.writeHead(status).end(JSON.stringify(data));
      try{
        const host='127.0.0.1:'+req.socket.localPort;
        requireValue(req.headers.host===host&&(!req.headers['sec-fetch-site']||['same-origin','none'].includes(req.headers['sec-fetch-site'])),'Open the local operator page directly');
        if(req.method!=='GET')requireValue(req.headers.origin==='http://'+host,'Origin rejected');
        if(url.pathname==='/api/config'){
          let schemaReady=false;
          if(configured()){const {error}=await supabaseClient().from('agritech_cases').select('profile_id').limit(0);schemaReady=!error;}
          const session=configured()?await sessionFor(req):null;
          json(200,{configured:configured(),schemaReady,signedIn:!!session,telephoneConfigured:!!(process.env.ALAAP_ACCESS_TOKEN&&process.env.ALAAP_SIP_EXTENSION&&process.env.ALAAP_SIP_DOMAIN&&process.env.ALAAP_SIP_PASSWORD),researchOnly:true});return true;
        }
        requireValue(configured(),'Dedicated Supabase and encryption settings are not configured');
        if(url.pathname==='/api/auth/start'&&req.method==='POST'){
          const {email}=await readJson(req);text(email,254);
          const key=req.socket.remoteAddress,count=attempts.get(key)||{at:Date.now(),count:0};
          if(Date.now()-count.at>600000){count.at=Date.now();count.count=0;}requireValue(++count.count<=5,'Too many sign-in requests; wait ten minutes');attempts.set(key,count);
          const {error}=await supabaseClient().auth.signInWithOtp({email,options:{shouldCreateUser:true,emailRedirectTo:'http://'+host+'/operator.html'}});
          requireValue(!error,'Sign-in email could not be sent');json(200,{sent:true});return true;
        }
        if(['/api/auth/verify','/api/auth/callback'].includes(url.pathname)&&req.method==='POST'){
          const key='verify:'+req.socket.remoteAddress,count=attempts.get(key)||{at:Date.now(),count:0};
          if(Date.now()-count.at>600000){count.at=Date.now();count.count=0;}requireValue(++count.count<=10,'Too many verification attempts; wait ten minutes');attempts.set(key,count);
          const {email,code,accessToken,refreshToken}=await readJson(req);
          const client=supabaseClient();let verified;
          if(url.pathname==='/api/auth/callback')verified=await verifiedTokenSession(client,accessToken);
          else{
            text(email,254);text(code,4096);
            if(/^\d{6,10}$/.test(code))verified=await client.auth.verifyOtp({email,token:code,type:'email'});
            else{
              const link=new URL(code);
              if(link.origin===new URL(process.env.SUPABASE_URL).origin&&link.pathname==='/auth/v1/verify'&&['magiclink','signup','email'].includes(link.searchParams.get('type')))verified=await client.auth.verifyOtp({token_hash:link.searchParams.get('token'),type:link.searchParams.get('type')});
              else{
                requireValue(['http://'+host,'http://localhost:3000'].includes(link.origin),'Paste only the project sign-in link or local callback URL');
                const params=new URLSearchParams(link.hash.slice(1));
                verified=await verifiedTokenSession(client,params.get('access_token'));
                verified.data.session.refresh_token=params.get('refresh_token')||undefined;
              }
            }
          }
          const {data,error}=verified;
          requireValue(!error&&data.session&&data.user,'Invalid or expired sign-in code');
          if(refreshToken){text(refreshToken,4096);data.session.refresh_token=refreshToken;}
          requireValue(!email||data.user.email.toLowerCase()===email.toLowerCase(),'Sign-in email does not match');
          const {id,reviewer}=await sessions.create(data);
          res.setHeader('Set-Cookie','agritech_operator='+id+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+sessionAge);json(200,{signedIn:true,reviewer});return true;
        }
        if(url.pathname==='/api/auth/logout'&&req.method==='POST'){
          sessions.remove(req);
          res.setHeader('Set-Cookie','agritech_operator=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');json(200,{signedIn:false});return true;
        }
        const session=await sessionFor(req);if(!session){json(401,{error:'Operator sign-in required'});return true;}
        if(url.pathname==='/api/telephone'&&req.method==='POST'){
          await readJson(req);
          const credentials={token:process.env.ALAAP_ACCESS_TOKEN,extension:process.env.ALAAP_SIP_EXTENSION,domain:process.env.ALAAP_SIP_DOMAIN,password:process.env.ALAAP_SIP_PASSWORD};
          requireValue(Object.values(credentials).every(Boolean),'Telephone credentials are missing from .env.local');json(200,credentials);return true;
        }
        const db=database(session),body=req.method==='GET'?{}:await readJson(req);
        if(url.pathname==='/api/sources'&&req.method==='GET'){
          const {data,error}=await db.client.from('agritech_sources').select('*').order('id');requireValue(!error,'Source catalog unavailable');json(200,data);return true;
        }
        if(url.pathname==='/api/sources/permission'&&req.method==='POST'){
          requireValue(jobs.sources.some(source=>source.id===body.sourceId)&&['unknown','permitted','restricted'].includes(body.status),'Unknown source or reuse status');
          const basis=text(body.basis,2000);const {error}=await db.client.from('agritech_sources').update({reuse_status:body.status,reuse_basis:basis}).eq('id',body.sourceId);
          requireValue(!error,'Unable to record reuse decision');json(200,{recorded:true});return true;
        }
        if(url.pathname==='/api/ingestion'&&req.method==='POST'){json(202,jobs.start(session,body));return true;}
        if(url.pathname==='/api/embeddings'&&req.method==='POST'){json(202,jobs.start(session,{kind:'embedding'}));return true;}
        if(url.pathname==='/api/research'&&req.method==='GET'){
          const folder=new URL('../../research/reports/',import.meta.url),reports=[];
          for(const name of await readdir(folder).catch(()=>[]))if(/^[\w-]+\.json$/.test(name)){const content=await readFile(new URL(name,folder),'utf8');if(content.length<=200000)reports.push({name,result:JSON.parse(content)});}
          json(200,{reports,trainingRequiresHumanReview:true,liveModels:['Vertex Gemini Live'],studentDeploymentApproved:false});return true;
        }
        if(url.pathname.startsWith('/api/jobs/')&&req.method==='GET'){json(200,jobs.get(session.userId,url.pathname.split('/').at(-1)));return true;}
        if(url.pathname==='/api/cases'){
          if(req.method==='GET')json(200,await db.list());else if(req.method==='POST'){requireValue(body.storageConsent===true,'Obtain caller consent before storing registration or case details');json(201,await db.create(body));}else json(405,{error:'Method not allowed'});return true;
        }
        const match=url.pathname.match(/^\/api\/cases\/([a-f0-9-]{36})(?:\/(events|history|workspace))?$/);
        if(match){
          const [,id,action]=match;
          if(req.method==='GET'&&!action)json(200,await db.get(id));
          else if(req.method==='GET'&&action==='workspace')json(200,projectWorkspace(await db.get(id)));
          else if(req.method==='POST'&&action==='events'){
            requireValue(['propose','readback','confirm','register','verify_identity','referral','close'].includes(body.type),'Unsupported operator operation');
            json(200,await db.apply(id,{...body,id:body.id||randomUUID(),actor:'operator'}));
          }else if(req.method==='POST'&&action==='history')json(200,await db.history(id,text(body.profileId,36)));
          else json(405,{error:'Method not allowed'});return true;
        }
        if(url.pathname==='/api/profiles/lookup'&&req.method==='POST'){json(200,await db.findProfiles(body.phone));return true;}
        if(url.pathname==='/api/profiles/bind'&&req.method==='POST'){
          const {profile}=await db.history(text(body.caseId,36),text(body.profileId,36));
          json(200,await db.apply(body.caseId,{type:'bind_profile',id:body.id||randomUUID(),actor:'operator',profileId:body.profileId,profile}));return true;
        }
        if(url.pathname==='/api/knowledge/search'&&req.method==='POST'){
          json(200,await new Knowledge(db.client).search(body.query,{research:body.research===true,crop:body.crop||'rice',stage:body.stage||null,district:body.district||null}));return true;
        }
        if(url.pathname==='/api/knowledge/pending'&&req.method==='GET'){
          const {data,error}=await db.client.from('agritech_chunks').select('id,text,document_id,crop,stage,district,review_status').eq('review_status','PENDING').limit(30);requireValue(!error,'Review queue unavailable');json(200,data);return true;
        }
        if(url.pathname==='/api/knowledge/review'&&req.method==='POST'){
          requireValue(session.reviewer,'An authorized agronomy reviewer must approve guidance');
          const {error}=await db.client.rpc('agritech_review_chunk',{p_id:text(body.chunkId,128),p_status:body.status,p_note:text(body.note,4000),p_crop:body.crop||'rice',p_stage:body.stage||null,p_district:body.district||null,p_valid_until:body.validUntil||null});
          requireValue(!error,'Review rejected; verify source reuse permission and review details');json(200,{reviewed:true});return true;
        }
        if(url.pathname==='/api/coverage'&&req.method==='GET'){
          const {data,error}=await db.client.rpc('agritech_coverage');requireValue(!error,'Coverage unavailable');json(200,data);return true;
        }
        json(404,{error:'Unknown API operation'});
      }catch(error){json(400,{error:error instanceof SyntaxError?'Invalid JSON':error.message});}
      return true;
    },
  };
}
