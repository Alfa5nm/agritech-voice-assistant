import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {operatorSessions} from './backend/sessions.js';
import {encryption} from './backend/database.js';

test('operator sessions persist encrypted, renew once concurrently, reject revoked access and stay logged out',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'agritech-session-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=pathToFileURL(join(dir,'sessions')),crypt=()=>encryption('11'.repeat(32),'22'.repeat(32));
  let refreshes=0,allowed=true;
  const client=()=>({auth:{refreshSession:async()=>{refreshes++;await new Promise(r=>setTimeout(r,10));return {data:{user:{id:'u',email:'operator@example.invalid'},session:{access_token:'renewed-secret',refresh_token:'rotated-secret',expires_at:Date.now()/1000+3600}},error:null};}},from:()=>({select:()=>({eq:()=>({single:async()=>({data:allowed?{can_review:false}:null,error:null})})})})});
  let store=operatorSessions({file,crypt,client});
  const data={user:{id:'u',email:'operator@example.invalid'},session:{access_token:'access-secret',refresh_token:'refresh-secret',expires_at:Date.now()/1000-1}};
  const {id}=await store.create(data),req={headers:{cookie:'agritech_operator='+id}};
  const raw=await readFile(file,'utf8');assert.ok(!raw.includes('refresh-secret'));assert.ok(!raw.includes('operator@example'));
  store=operatorSessions({file,crypt,client});
  const [a,b]=await Promise.all([store.get(req),store.get(req)]);assert.equal(a,b);assert.equal(a.token,'renewed-secret');assert.equal(refreshes,1);
  store.remove(req);assert.equal(store.valid(a),false);assert.equal(await operatorSessions({file,crypt,client}).get(req),null);
  const second=await store.create(data);allowed=false;
  assert.equal(await store.get({headers:{cookie:'agritech_operator='+second.id}}),null);
});

test('logout during renewal cannot recreate an operator session',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'agritech-session-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  let finish;const waiting=new Promise(resolve=>finish=resolve);
  const client=()=>({auth:{refreshSession:()=>waiting},from:()=>({select:()=>({eq:()=>({single:async()=>({data:{can_review:false}})})})})});
  const store=operatorSessions({file:pathToFileURL(join(dir,'sessions')),crypt:()=>encryption('11'.repeat(32),'22'.repeat(32)),client});
  const data={user:{id:'u',email:'operator@example.invalid'},session:{access_token:'old',refresh_token:'refresh',expires_at:1}};
  const {id}=await store.create(data),req={headers:{cookie:'agritech_operator='+id}};
  const pending=store.get(req);store.remove(req);finish({data:{user:data.user,session:{...data.session,expires_at:Date.now()/1000+3600}}});
  assert.equal(await pending,null);assert.equal(await store.get(req),null);
});
