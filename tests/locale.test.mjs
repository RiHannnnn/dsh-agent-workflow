import test from 'node:test'
import assert from 'node:assert/strict'
import { localizeRole, roleLabel, roleDisplayName, roleMatches } from '../lib/agent-locale.js'

test('known roles display Chinese name and description, keeping English for reference', () => {
  const role = { id: 'research-synthesist', name: 'Research Synthesist', description: 'Expert in literature review' }
  const zh = localizeRole(role)
  assert.equal(zh.name, '研究综合分析师')
  assert.equal(zh.localized, true)
  assert.match(zh.description, /证据/)
  assert.equal(zh.englishName, 'Research Synthesist')
  assert.equal(roleLabel(role), '研究综合分析师（Research Synthesist）')
})

test('unknown roles fall back to unchanged English metadata', () => {
  const role = { id: 'user-custom-role', name: 'My Role', description: 'Custom work' }
  assert.deepEqual(localizeRole(role), { name: 'My Role', description: 'Custom work', localized: false, englishName: 'My Role' })
  assert.equal(roleLabel(role), 'My Role')
  assert.equal(roleDisplayName('user-custom-role'), 'user-custom-role')
})

test('search matches Chinese and English, and empty query matches all', () => {
  const role = { id: 'testing-api-tester', name: 'API Tester', description: 'API validation' }
  assert.equal(roleMatches(role, ''), true)
  assert.equal(roleMatches(role, '接口'), true)
  assert.equal(roleMatches(role, 'api'), true)
  assert.equal(roleMatches(role, '不存在的角色'), false)
})

test('node cards resolve role ids to Chinese names', () => {
  assert.equal(roleDisplayName('codex-default'), 'Codex 默认角色')
  assert.equal(roleDisplayName('engineering-frontend-developer'), '前端开发工程师')
  assert.equal(roleDisplayName(undefined), 'Codex 默认角色')
})
