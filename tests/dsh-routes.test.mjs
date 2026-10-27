import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { registerDshAgentRoutes, DSH_CAPABILITY_HEADER, DSH_LIMITS } from '../lib/dsh-routes.js'

const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no }); return {promise,resolve,reject} }
class Response extends EventEmitter {
  statusCode=200; headers={}; chunks=[]; writableEnded=false; writableFinished=false; destroyed=false
  first=deferred()
  setHeader(name,value) { this.headers[name.toLowerCase()]=value }
  writeHead(status,headers={}) { this.statusCode=status; for(const [k,v] of Object.entries(headers)) this.setHeader(k,v) }
  write(chunk) { this.chunks.push(String(chunk)); this.first.resolve(); return true }
  end(chunk='') { if(chunk) this.write(chunk); this.writableEnded=true; this.writableFinished=true }
  disconnect() { this.destroyed=true; this.emit('close') }
  json() { return JSON.parse(this.chunks.join('')) }
  frames() { return this.chunks.join('').split('\n').filter(Boolean).map(line=>JSON.parse(line)) }
}
async function fixture(t, overrides={}) {
  const home=await realpath(await mkdtemp(join(tmpdir(),'dsh-native-routes-')))
  await mkdir(join(home,'skills','tester'),{recursive:true})
  await writeFile(join(home,'skills','tester','SKILL.md'),"---\nname: agency-tester\ndescription: Test role\n---\n\nUse evidence, never invent results.")
  const routes=new Map(), parent={id:'parent-a',options:{maxTokens:2048}}, state={roots:[parent],specs:[],disposed:0}
  const agents={roots:()=>state.roots,get:id=>state.roots.find(p=>p.id===id)}
  const subagents={getProvider:()=>({prepareContinuable(){}}),resolveMaxDepth:()=>1,
    startActivation:async spec=>{ state.specs.push(spec); return {result:Promise.resolve({stopReason:'completed',output:[{type:'text',text:'真实格式的模拟结果'}]}),dispose:async()=>{state.disposed++}} },...overrides}
  const unload=registerDshAgentRoutes({webServer:{register:route=>{routes.set(route.path,route.handler);return()=>routes.delete(route.path)}},get:name=>({agents,subagents}[name]),effect:()=>{}},{home})
  t.after(async()=>{ await unload().catch(()=>{}); assert.match(basename(home),/^dsh-native-routes-/); assert.equal(await realpath(home),home); await rm(home,{recursive:true,force:true}) })
  let capability
  const request=(path,body={},headers={})=>{
    const req=Readable.from([Buffer.from(typeof body==='string'?body:JSON.stringify(body))])
    req.method='POST'; req.socket={localPort:43120}; req.headers={host:'127.0.0.1:43120',origin:'http://127.0.0.1:43120','content-type':'application/json',...(capability?{[DSH_CAPABILITY_HEADER]:capability}:{}),...headers}
    const res=new Response(); const done=routes.get(path)(req,res)
    return {req,res,done}
  }
  const call=async(...args)=>{const response=request(...args);await response.done;return response.res}
  const library=await call('/dsh-node-flow/agent-library')
  assert.equal(library.statusCode,200)
  capability=library.headers[DSH_CAPABILITY_HEADER]
  assert.match(capability,/^[a-f0-9]{64}$/)
  const begin=async body=>{const res=await call('/dsh-node-flow/dsh-begin',body);assert.equal(res.statusCode,200,res.chunks.join(''));return res.json().runId}
  return {home,routes,state,parent,subagents,request,call,begin,unload,capability,library}
}

test('native library exposes capability only in headers, authenticates run endpoints and strict origin',async t=>{
  const f=await fixture(t)
  assert.equal(f.library.json().capability,undefined)
  assert.equal(f.library.json().agents[0].engine,'dsh')
  for(const headers of [{[DSH_CAPABILITY_HEADER]:''},{origin:'https://127.0.0.1:43120'},{origin:'http://evil.example',host:'evil.example'},{'sec-fetch-site':'cross-site'}]){
    assert.equal((await f.call('/dsh-node-flow/dsh-begin',{},headers)).statusCode,403)
  }
  assert.equal((await f.call('/dsh-node-flow/dsh-begin',{}, {'content-type':'text/plain'})).statusCode,415)
  assert.equal((await f.call('/dsh-node-flow/dsh-begin','null')).statusCode,400)
  assert.equal((await f.call('/dsh-node-flow/dsh-begin','{')).statusCode,400)
  assert.equal(f.state.specs.length,0)
})
test('native startActivation receives caller delivery, exact parent, current role, model and lower inherited output cap',async t=>{
  const f=await fixture(t), runId=await f.begin({})
  const response=await f.call('/dsh-node-flow/run-dsh',{runId,prompt:'Check API',roleId:'tester',model:'provider|model/id'})
  assert.equal(response.statusCode,200)
  assert.equal(response.frames().at(-1).type,'done')
  const spec=f.state.specs[0]
  assert.equal(spec.provider,'spawn');assert.equal(spec.delivery,'caller');assert.equal(spec.request.parent,f.parent)
  assert.deepEqual(spec.request.agentOptions,{provider:'provider',model:'model/id',maxTokens:2048})
  assert.equal(spec.request.maxDepth,1)
  assert.match(spec.request.prompt[0].text,/Use evidence/)
  assert.equal(f.state.disposed,1)
  assert.equal((await f.call('/dsh-node-flow/dsh-end',{runId})).json().calls,1)
  assert.equal((await f.call('/dsh-node-flow/dsh-end',{runId})).statusCode,200)
  assert.equal((await f.call('/dsh-node-flow/run-dsh',{runId,prompt:'again'})).statusCode,409)
})
test('ambiguous or replaced parent is never silently selected',async t=>{
  const f=await fixture(t)
  f.state.roots.push({id:'parent-b'})
  assert.equal((await f.call('/dsh-node-flow/dsh-begin',{})).statusCode,409)
  const runId=await f.begin({parentSessionId:'parent-b'})
  f.state.roots[1]={id:'parent-b'}
  assert.equal((await f.call('/dsh-node-flow/run-dsh',{runId,prompt:'test'})).statusCode,409)
  assert.equal(f.state.specs.length,0)
})
test('four attempts are enforced server-side and malformed requests cannot launch models',async t=>{
  const f=await fixture(t),runId=await f.begin({})
  for(const bad of [{prompt:''},{prompt:'x',roleId:'../escape'},{prompt:'x',roleId:'codex-default'},{prompt:'x',model:'provider-only'},{prompt:'x',timeout:0},{prompt:'中'.repeat(DSH_LIMITS.taskBytes)}]){
    assert.ok((await f.call('/dsh-node-flow/run-dsh',{runId,...bad})).statusCode>=400)
  }
  assert.equal(f.state.specs.length,0)
  for(let i=0;i<4;i++) assert.equal((await f.call('/dsh-node-flow/run-dsh',{runId,prompt:'run'})).frames().at(-1).type,'done')
  assert.equal((await f.call('/dsh-node-flow/run-dsh',{runId,prompt:'fifth'})).statusCode,429)
  assert.equal(f.state.specs.length,4)
})
test('cumulative prompt byte budget rejects before launching another Agent without truncation',async t=>{
  const f=await fixture(t),runId=await f.begin({})
  await writeFile(join(f.home,'skills','tester','SKILL.md'),'---\nname: agency-tester\ndescription: fixture\n---\n'+'R'.repeat(45000))
  for(let i=0;i<2;i++) assert.equal((await f.call('/dsh-node-flow/run-dsh',{runId,prompt:'x'.repeat(60000),roleId:'tester'})).frames().at(-1).type,'done')
  assert.equal((await f.call('/dsh-node-flow/run-dsh',{runId,prompt:'x'.repeat(60000),roleId:'tester'})).statusCode,413)
  assert.equal(f.state.specs.length,2)
  assert.equal((await f.call('/dsh-node-flow/dsh-end',{runId})).json().calls,2)
})
test('oversized final result becomes an error, never a truncated successful output',async t=>{
  let disposed=0
  const f=await fixture(t,{startActivation:async()=>({result:Promise.resolve({stopReason:'completed',output:[{type:'text',text:'x'.repeat(DSH_LIMITS.outputBytes+1)}]}),dispose:async()=>{disposed++}})}),runId=await f.begin({})
  const response=await f.call('/dsh-node-flow/run-dsh',{runId,prompt:'large output'})
  assert.equal(response.frames().at(-1).type,'error');assert.ok(response.frames().every(frame=>frame.type!=='done'));assert.equal(disposed,1)
})
test('native backend never falls back to external providers and respects disabled delegation',async t=>{
  const noSpawn=await fixture(t,{getProvider:()=>undefined})
  assert.equal((await noSpawn.call('/dsh-node-flow/dsh-begin',{})).statusCode,503)
  const disabled=await fixture(t,{resolveMaxDepth:()=>0}),runId=await disabled.begin({})
  assert.equal((await disabled.call('/dsh-node-flow/run-dsh',{runId,prompt:'test'})).statusCode,403)
  assert.equal(disabled.state.specs.length,0)
})
test('disconnect truly disposes the receipt, holding capacity until cleanup settles',async t=>{
  const cleanup=deferred(), results=[], entered=[]
  const f=await fixture(t,{startActivation:async spec=>{
    const result=deferred();results.push(result);entered.push(spec)
    return {result:result.promise,dispose:async()=>{await cleanup.promise;result.resolve({stopReason:'aborted',output:[]})}}
  }}),runId=await f.begin({})
  const one=f.request('/dsh-node-flow/run-dsh',{runId,prompt:'first'}),two=f.request('/dsh-node-flow/run-dsh',{runId,prompt:'second'})
  await Promise.all([one.res.first.promise,two.res.first.promise])
  one.res.disconnect()
  assert.equal((await f.call('/dsh-node-flow/run-dsh',{runId,prompt:'third'})).statusCode,429)
  const ending=f.request('/dsh-node-flow/dsh-end',{runId})
  cleanup.resolve()
  await Promise.all([one.done,two.done,ending.done])
  assert.equal(entered.length,2)
  assert.equal(ending.res.json().calls,2)
  assert.ok(two.res.frames().every(frame=>frame.type!=='done'))
})
test('late receipt after abort is disposed, never reported as successful',async t=>{
  const publication=deferred();let disposed=0
  const f=await fixture(t,{startActivation:()=>publication.promise}),runId=await f.begin({})
  const running=f.request('/dsh-node-flow/run-dsh',{runId,prompt:'late'})
  await running.res.first.promise
  running.res.disconnect()
  publication.resolve({result:Promise.resolve({stopReason:'completed',output:[]}),dispose:async()=>{disposed++}})
  await running.done
  assert.equal(disposed,1)
  assert.ok(running.res.frames().every(frame=>frame.type!=='done'))
})
test('timeout disposes the published activation, and unload removes routes and cancels work',async t=>{
  const results=[];let disposed=0
  const f=await fixture(t,{startActivation:async()=>{const value=deferred();results.push(value);return {result:value.promise,dispose:async()=>{disposed++;value.resolve({stopReason:'aborted',output:[]})}}}})
  t.mock.timers.enable({apis:['setTimeout']})
  const runId=await f.begin({}),running=f.request('/dsh-node-flow/run-dsh',{runId,prompt:'timeout',timeout:1})
  await running.res.first.promise
  t.mock.timers.tick(1001)
  await running.done
  assert.equal(disposed,1)
  assert.ok(running.res.frames().some(frame=>frame.type==='error'))
  const second=f.request('/dsh-node-flow/run-dsh',{runId,prompt:'unload'})
  await second.res.first.promise
  await f.unload();await second.done
  assert.equal(disposed,2);assert.equal(f.routes.size,0)
})
test('run expiry cancels child work even without a browser end request',async t=>{
  let disposed=0
  const f=await fixture(t,{startActivation:async()=>({result:new Promise(()=>{}),dispose:async()=>{disposed++}})})
  t.mock.timers.enable({apis:['setTimeout']})
  const runId=await f.begin({}),running=f.request('/dsh-node-flow/run-dsh',{runId,prompt:'expire',timeout:600})
  await running.res.first.promise;t.mock.timers.tick(DSH_LIMITS.runMs+1);await running.done
  assert.equal(disposed,1)
  assert.equal((await f.call('/dsh-node-flow/dsh-end',{runId})).json().calls,1)
})
test('failed cleanup quarantines starts and cannot be reset by the cleanup endpoint',async t=>{
  const f=await fixture(t,{startActivation:async()=>({result:Promise.resolve({stopReason:'completed',output:[]}),dispose:async()=>{throw new Error('fixture cleanup failure')}})}),runId=await f.begin({})
  const run=await f.call('/dsh-node-flow/run-dsh',{runId,prompt:'x'})
  assert.equal(run.frames().at(-1).type,'error')
  assert.equal((await f.call('/dsh-node-flow/dsh-end',{runId})).statusCode,503)
  assert.equal((await f.call('/dsh-node-flow/dsh-begin',{})).statusCode,503)
  await assert.rejects(f.unload(),/cleanup failed/)
})
