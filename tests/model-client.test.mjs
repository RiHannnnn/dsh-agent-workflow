import test from 'node:test'
import assert from 'node:assert/strict'
import { CODEX_CAPABILITY_HEADER, fetchAgentLibrary, getAgentLibraryCapability, ensureAgentLibraryCapability } from '../lib/agent-library-client.js'

test('agent library takes capability only from the response header and keeps it in memory', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  try {
    globalThis.fetch = async (url, init) => {
      requests.push({ url, init })
      return new Response(JSON.stringify({
        ok: true, codexAvailable: true, capability: 'untrusted-body-token',
        agents: [
          { id: 'codex-default', name: '默认', description: '', engine: 'codex' },
          { id: '../escape', name: 'bad', description: '', engine: 'codex' },
        ],
      }), { headers: { [CODEX_CAPABILITY_HEADER]: 'ephemeral-header-token', 'content-type': 'application/json' } })
    }
    const library = await fetchAgentLibrary()
    assert.equal(library.agents.length, 1)
    assert.equal(library.capability, 'ephemeral-header-token')
    assert.equal(getAgentLibraryCapability(), 'ephemeral-header-token')
    assert.equal(await ensureAgentLibraryCapability(), 'ephemeral-header-token')
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, '/dsh-node-flow/agent-library')
    assert.equal(requests[0].init.method, 'POST')
    assert.equal(requests[0].init.body, '{}')
    assert.equal(requests[0].init.cache, 'no-store')
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: true, codexAvailable: true, agents: [], capability: 'body-token-must-not-be-used' }))
    await fetchAgentLibrary()
    assert.equal(getAgentLibraryCapability(), undefined)
  } finally {
    globalThis.fetch = originalFetch
  }
})
