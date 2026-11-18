const $=id=>document.getElementById(id);
let callbackToken=new URLSearchParams(location.hash.slice(1)).get('access_token');
let callbackRefresh=new URLSearchParams(location.hash.slice(1)).get('refresh_token');
if(location.hash)history.replaceState(null,'',location.pathname+location.search);
async function api(path,body){
  const response=await fetch('/api/'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'Request failed');return result;
}
function run(work){return async event=>{event?.preventDefault();try{await work();}catch(error){$('status').textContent=error.message;}};}
async function cases(){
  const selected=$('cases').value,items=await api('cases');
  $('cases').replaceChildren(new Option('Select a case',''),...items.map(item=>new Option(item.id+' · '+item.status,item.id)));
  $('cases').value=selected;return items;
}
async function current(){
  const id=$('cases').value;if(!id)return;
  const state=await api('cases/'+id);$('state').textContent=JSON.stringify(state,null,2);
  $('call-link').href='/workspace.html?case='+encodeURIComponent(id)+(state.metadata.synthetic?'&synthetic=1':'');
  $('status').textContent='Persistent case loaded. Unconfirmed facts remain proposals.';
}
$('login').onsubmit=run(async()=>{await api('auth/start',{email:$('email').value});$('status').textContent='Check your email. Enter the verification code or copy the sign-in link into the field below.';});
$('verify').onsubmit=run(async()=>{const code=$('code').value;$('code').value='';await api('auth/verify',{email:$('email').value,code});$('status').textContent='Signed in as an Agritech operator.';await cases();});
$('logout').onclick=run(async()=>{await api('auth/logout',{});$('state').textContent='Signed out.';$('profile').textContent='';$('candidates').textContent='';$('cases').replaceChildren(new Option('Select a case',''));$('status').textContent='Signed out. Stop any active AI call before leaving this computer.';});
$('new-case').onclick=run(async()=>{const state=await api('cases',{storageConsent:$('consent').checked,synthetic:$('synthetic').checked});await cases();$('cases').value=state.id;await current();$('consent').checked=false;$('synthetic').checked=false;});
$('refresh').onclick=run(async()=>{await cases();await current();});$('cases').onchange=run(current);
$('lookup').onclick=run(async()=>{$('candidates').textContent=JSON.stringify(await api('profiles/lookup',{phone:$('phone').value}),null,2);});
$('verify-identity').onclick=run(async()=>{if(!$('identity').checked)throw new Error('Verify the caller independently before recording this action');if(!$('cases').value||!$('profile-id').value)throw new Error('Select a case and the verified profile ID');await api('cases/'+$('cases').value+'/events',{type:'verify_identity',profileId:$('profile-id').value,id:crypto.randomUUID()});$('identity').checked=false;await current();});
$('history').onclick=run(async()=>{if(!$('cases').value)throw new Error('Select a case');$('profile').textContent=JSON.stringify(await api('cases/'+$('cases').value+'/history',{profileId:$('profile-id').value}),null,2);});
$('bind-profile').onclick=run(async()=>{await api('profiles/bind',{caseId:$('cases').value,profileId:$('profile-id').value,id:crypto.randomUUID()});await current();});
$('close-case').onclick=run(async()=>{if(!$('cases').value)throw new Error('Select a case');await api('cases/'+$('cases').value+'/events',{type:'close',resolved:true,id:crypto.randomUUID()});await current();});
$('search').onclick=run(async()=>{$('results').textContent=JSON.stringify(await api('knowledge/search',{query:$('query').value,research:$('research').checked}),null,2);});
$('coverage').onclick=run(async()=>{$('coverage-result').textContent=JSON.stringify(await api('coverage'),null,2);});
let sourceRecords=[];
$('sources').onclick=run(async()=>{sourceRecords=await api('sources');$('source').replaceChildren(...sourceRecords.map(item=>new Option(item.publisher,item.id)));$('source').onchange();});
$('source').onchange=()=>{$('source-status').textContent=JSON.stringify(sourceRecords.find(item=>item.id===$('source').value),null,2);};
$('save-permission').onclick=run(async()=>{await api('sources/permission',{sourceId:$('source').value,status:$('reuse-status').value,basis:$('reuse-basis').value});$('status').textContent='Reuse decision recorded. Agricultural approval remains separate.';});
$('ingest').onclick=run(async()=>{const job=await api('ingestion',{source:$('source').value,mode:$('ingest-mode').value,limit:Number($('ingest-limit').value)});$('job-id').value=job.id;$('job-result').textContent=JSON.stringify(job,null,2);});
$('embed').onclick=run(async()=>{const job=await api('embeddings',{});$('job-id').value=job.id;$('job-result').textContent=JSON.stringify(job,null,2);});
$('job-status').onclick=run(async()=>{$('job-result').textContent=JSON.stringify(await api('jobs/'+$('job-id').value),null,2);});
$('review-queue').onclick=run(async()=>{
  const items=await api('knowledge/pending');$('queue').replaceChildren();
  for(const item of items){const article=document.createElement('article'),heading=document.createElement('strong'),paragraph=document.createElement('p'),select=document.createElement('button');heading.textContent=item.id;paragraph.textContent=item.text;select.textContent='Review this passage';select.onclick=()=>{$('chunk-id').value=item.id;};article.append(heading,paragraph,select);$('queue').append(article);}
  if(!items.length)$('queue').textContent='No pending passages. Collection and source reuse permission are required before review.';
});
$('review').onsubmit=run(async()=>{await api('knowledge/review',{chunkId:$('chunk-id').value,status:$('decision').value,note:$('note').value,crop:$('crop').value,stage:$('stage').value,district:$('district').value,validUntil:$('valid-until').value?new Date($('valid-until').value).toISOString():null});$('status').textContent='Reviewed decision recorded with reviewer identity.';});
$('research-reports').onclick=run(async()=>{$('reports').textContent=JSON.stringify(await api('research'),null,2);});
run(async()=>{if(callbackToken){const accessToken=callbackToken;callbackToken=null;const refreshToken=callbackRefresh;callbackRefresh=null;await api('auth/callback',{accessToken,refreshToken:refreshToken||undefined});$('status').textContent='Signed in as an Agritech operator.';await cases();return;}const config=await api('config');$('status').textContent=!config.configured?'Database configuration is missing. Voice-only testing is still available.':!config.schemaReady?'Database configured; profile-history migration is required before registration. Source and research tools remain available after sign-in.':'Dedicated database configured. Sign in to work with farmer data.';if(config.signedIn){$('status').textContent='Signed in as an Agritech operator.';await cases();}})();
