import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { splitFrontmatter, listDshAgents, readDshAgentBody } from '../lib/dsh-agents.js'

test('frontmatter split keeps quoted metadata and body', () => {
  const { meta, body } = splitFrontmatter("---\nname: 'agency-api-tester'\ndescription: 'Expert in API testing'\n---\n\n# API Tester\nBody")
  assert.equal(meta.name, 'agency-api-tester')
  assert.equal(meta.description, 'Expert in API testing')
  assert.match(body.trim(), /^# API Tester/)
})

test('DSH skills become roles and instructions are readable', async (t) => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'dsh-agents-')))
  t.after(async () => { assert.match(basename(home), /^dsh-agents-/); await rm(home, { recursive: true, force: true }) })
  await mkdir(join(home, 'skills', 'testing-api-tester'), { recursive: true })
  await writeFile(join(home, 'skills', 'testing-api-tester', 'SKILL.md'), "---\nname: 'agency-api-tester'\ndescription: 'API 接口测试专家'\n---\n\n# API Tester\nYou are an API tester.")
  await writeFile(join(home, 'skills', 'broken'), 'not a directory')
  const { agents } = await listDshAgents(home)
  assert.equal(agents.length, 1)
  assert.equal(agents[0].id, 'testing-api-tester')
  assert.equal(agents[0].engine, 'dsh')
  assert.match(await readDshAgentBody(home, 'testing-api-tester'), /You are an API tester/)
  await assert.rejects(readDshAgentBody(home, '../etc'), /无效的角色标识/)
})
