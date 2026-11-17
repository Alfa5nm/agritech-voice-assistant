import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

test('TURN credentials are available only to the local tester and environment files are not served',async t=>{
  const reservation=createServer().listen(0,'127.0.0.1');await once(reservation,'listening');
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:String(port),ALAAP_TURN_USERNAME:'test-user',ALAAP_TURN_CREDENTIAL:'test-password'},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{if(child.exitCode===null){const exited=once(child,'exit');child.kill();await exited;}});
  await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw new Error('Server exited before startup');})]);
  const base='http://127.0.0.1:'+port;
  const request=origin=>fetch(base+'/ice-config',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'}});
  assert.equal((await request('https://other.example')).status,403);
  const response=await request(base);
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const {iceServers}=await response.json();assert.equal(iceServers[0].credential,'test-password');
  assert.equal((await fetch(base+'/.env.local')).status,404);
});
