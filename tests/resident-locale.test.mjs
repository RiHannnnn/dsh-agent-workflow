import test from 'node:test'
import assert from 'node:assert/strict'
import { RESIDENT_AGENT_ZH, RESIDENT_SKILL_IDS } from '../lib/resident-agent-zh.js'
import { localizeRole, roleDisplayName, roleMatches } from '../lib/agent-locale.js'

test('all 43 resident roles have static Chinese names and descriptions', () => {
  assert.equal(Object.keys(RESIDENT_AGENT_ZH).length, 43)
  assert.equal(Object.keys(RESIDENT_SKILL_IDS).length, 43)
  for (const [id, [name, description]] of Object.entries(RESIDENT_AGENT_ZH)) {
    assert.match(name, /\p{Script=Han}/u, id)
    assert.match(description, /\p{Script=Han}/u, id)
    const original = Object.freeze({ id, name: 'Original English name', description: 'Original English description' })
    const translated = localizeRole(original)
    assert.equal(translated.localized, true, id)
    assert.equal(translated.name, name)
    assert.equal(translated.description, description)
    assert.equal(roleDisplayName(id), name)
    assert.equal(roleMatches(original, name), true)
    assert.deepEqual(original, { id, name: 'Original English name', description: 'Original English description' })
  }
})
test('DSH registered skill names resolve to the same translations as directory ids', () => {
  for (const [directory, skillName] of Object.entries(RESIDENT_SKILL_IDS)) {
    assert.equal(roleDisplayName(skillName), roleDisplayName(directory))
    assert.equal(localizeRole({ id: skillName, name: skillName, description: '' }).localized, true)
  }
})
test('Spanish-English translation is not incorrectly advertised as Chinese-English', () => {
  const result = localizeRole({ id: 'language-translator', name: 'Language Translator', description: 'Spanish ↔ English' })
  assert.match(result.name, /西班牙语/)
  assert.match(result.description, /不是专门的中英翻译/)
})
