import test from 'node:test'
import assert from 'node:assert/strict'
import { beginDshExecution, finishDshExecution, dshExecutionRequest } from '../lib/dsh-execution-client.js'
import { executeAgent } from '../lib/client-execution.js'
const cap='a'.repeat(64), runId='fixture-run'
function stub(t, handler) { t.mock.method(globalThis,'fetch',handler) }
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json',...headers}})
const catalog=parents=>json({ok:true,agents:[],parents:parents.map(id=>({id}))},200,{'x-dsh-node-flow-capability':cap})

test('client requires an explicit choice among roots and stores capability only in returned memory context',async t=>{
  const sent=[]
  stub(t,async(url,options)=>{sent.push({url,options});return url.endsWith('agent-library')?catalog(['first','second']):json({runId,parentSessionId:'second',limits:{callsPerRun:4}})})
  const context=await beginDshExecution(new AbortController().signal,ids=>{assert.deepEqual(ids,['first','second']);return 'second'})
  assert.equal(context.capability,cap);assert.equal(context.parentSessionId,'second')
  assert.deepEqual(JSON.parse(sent[1].options.body),{parentSessionId:'second'})
  assert.equal(sent[1].options.headers['x-dsh-node-flow-capability'],cap)
  assert.equal(JSON.parse(sent[1].options.body).capability,undefined)
  assert.throws(()=>dshExecutionRequest(undefined),/运行按钮/)
})
test('no root, cancelled choice, or absent header never creates an execution',async t=>{
  let calls=0
  stub(t,async()=>{calls++;return catalog(['a','b'])})
  await assert.rejects(beginDshExecution(new AbortController().signal),/未选择父会话/)
  assert.equal(calls,1)
  stub(t,async()=>catalog([]))
  await assert.rejects(beginDshExecution(new AbortController().signal),/没有在线/)
  stub(t,async()=>json({ok:true,agents:[],parents:[{id:'a'}],capability:cap}))
  await assert.rejects(beginDshExecution(new AbortController().signal),/执行授权不可用/)
})
test('DSH node forwards the model, role and server run identity without Codex/cwd settings',async t=>{
  const context={runId,capability:cap,parentSessionId:'p',callsPerRun:4}
  stub(t,async(url,options)=>{
    assert.equal(url,'/dsh-node-flow/run-dsh')
    const body=JSON.parse(options.body)
    assert.equal(body.runId,runId);assert.equal(body.model,'provider|model');assert.equal(body.roleId,'engineering-frontend-developer')
    assert.equal(body.cwd,undefined);assert.equal(body.codexModel,undefined)
    assert.equal(options.headers['x-dsh-node-flow-capability'],cap)
    return new Response(JSON.stringify({type:'done',output:'完成'})+'\n',{headers:{'content-type':'application/x-ndjson'}})
  })
  const node={id:'n',type:'workflow',position:{x:0,y:0},data:{kind:'agent',label:'DSH',engine:'dsh',model:'provider|model',roleId:'engineering-frontend-developer',prompt:'实现组件',cwd:'/must-not-send',codexModel:'must-not-send'}}
  assert.equal(await executeAgent(node,'input',()=>{},new AbortController().signal,context),'完成')
})
test('cleanup has a fresh signal and reports acknowledgement instead of silently ignoring failure',async t=>{
  const context={runId,capability:cap,parentSessionId:'p',callsPerRun:4}
  stub(t,async(url,options)=>{assert.equal(url,'/dsh-node-flow/dsh-end');assert.equal(options.signal.aborted,false);assert.deepEqual(JSON.parse(options.body),{runId});return json({ok:true,calls:3})})
  assert.equal(await finishDshExecution(context),3)
  stub(t,async()=>json({error:'后台清理未确认'},503))
  await assert.rejects(finishDshExecution(context),/后台清理未确认/)
})
test('already aborted begin performs no network call',async t=>{
  let calls=0;stub(t,async()=>{calls++;throw new Error('unexpected')})
  const controller=new AbortController();controller.abort()
  await assert.rejects(beginDshExecution(controller.signal))
  assert.equal(calls,0)
})
