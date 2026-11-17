import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {requireValue} from './workflow.js';
import sources from '../../research/sources.json' with {type:'json'};

export function createJobs(){
  const jobs=new Map();
  return {
    start(session,{source=null,mode='catalog',limit=10,kind='ingest'}){
      requireValue(['ingest','embedding'].includes(kind)&&(kind==='embedding'||(sources.some(item=>item.id===source)&&['catalog','collect'].includes(mode)&&Number.isInteger(limit)&&limit>=1&&limit<=100)),'Invalid bounded job request');
      requireValue(![...jobs.values()].some(job=>job.status==='RUNNING'),'Another ingestion job is running');
      const id=randomUUID(),job={id,ownerId:session.userId,status:'RUNNING',kind,source,mode,startedAt:new Date().toISOString()};jobs.set(id,job);
      if(jobs.size>20)jobs.delete(jobs.keys().next().value);
      const root=fileURLToPath(new URL('../../',import.meta.url));
      const executable=kind==='embedding'?process.execPath:process.env.RESEARCH_PYTHON||fileURLToPath(new URL('../../.research-venv/'+(process.platform==='win32'?'Scripts/python.exe':'bin/python'),import.meta.url));
      const args=kind==='embedding'?['alaap-test/scripts/embed.mjs']:['research/ingest.py','--source',source,'--mode',mode,'--limit',String(limit),'--publish'];
      const child=spawn(executable,args,{cwd:root,windowsHide:true,env:{...process.env,AGRITECH_ACCESS_TOKEN:session.token},stdio:['ignore','pipe','pipe']});
      let output='';child.stdout.on('data',data=>{output=(output+data.toString()).slice(-4000);});child.stderr.on('data',()=>{});
      child.on('error',()=>{job.status='FAILED';job.error='Research Python could not start; install the research environment';});
      const deadline=setTimeout(()=>{child.kill();job.status='FAILED';job.error='Bounded ingestion exceeded ten minutes; resume from the source manifest';},600000);
      child.on('close',code=>{clearTimeout(deadline);if(job.status!=='RUNNING')return;job.status=code===0?'COMPLETE':'FAILED';job.finishedAt=new Date().toISOString();try{job.result=JSON.parse(output.trim().split('\n').at(-1));}catch{job.error='Collection failed; inspect the private manifest for source-specific errors';}});
      return {id,status:job.status};
    },
    get(userId,id){const job=jobs.get(id);requireValue(job&&job.ownerId===userId,'Job unavailable');const {ownerId,...safe}=job;return safe;},
    sources,
  };
}
