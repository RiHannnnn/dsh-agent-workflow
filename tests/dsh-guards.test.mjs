import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,mkdir,writeFile,realpath,rm,symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join,basename } from 'node:path'
import { readDshAgentBody } from '../lib/dsh-agents.js'
import { apply } from '../lib/index.js'

test('DSH role loading rejects directory and leaf symlinks, not only traversal strings',async t=>{
  const home=await realpath(await mkdtemp(join(tmpdir(),'dsh-role-links-')))
  t.after(async()=>{assert.match(basename(home),/^dsh-role-links-/);assert.equal(await realpath(home),home);await rm(home,{recursive:true,force:true})})
  await mkdir(join(home,'skills','safe'),{recursive:true});await mkdir(join(home,'outside'))
  await writeFile(join(home,'outside','SKILL.md'),'outside role')
  await symlink(join(home,'outside'),join(home,'skills','linked'))
  await symlink(join(home,'outside','SKILL.md'),join(home,'skills','safe','SKILL.md'))
  await assert.rejects(readDshAgentBody(home,'linked'),/符号链接/)
  await assert.rejects(readDshAgentBody(home,'safe'))
})
test('retired agent route cannot bypass native leases or accidentally invoke old service methods',async()=>{
  const routes=new Map(), disposers=[];let accesses=0
  apply({webServer:{register:route=>{routes.set(route.path,route.handler);return()=>routes.delete(route.path)}},effect:factory=>{disposers.push(factory())},get:()=>{accesses++;throw new Error('must not access runtime')}})
  const res={status:0,body:'',writeHead(status){this.status=status},end(body){this.body=body}}
  try {
    await routes.get('/dsh-node-flow/run-agent')({method:'POST',socket:{localPort:43120},headers:{host:'127.0.0.1:43120',origin:'http://127.0.0.1:43120'}},res)
    assert.equal(res.status,410);assert.match(JSON.parse(res.body).error,/调用预算/);assert.equal(accesses,0)
  }finally{for(const dispose of disposers.reverse())await dispose()}
  assert.equal(routes.size,0)
})
