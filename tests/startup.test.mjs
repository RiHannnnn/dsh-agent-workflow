import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { apply } from '../lib/index.js'

test('enabling plugin does not arm or execute stored schedules', async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'dsh-flow-startup-')))
  const previous = process.env.DSH_HOME, setTimeoutOriginal = globalThis.setTimeout
  const disposers = [], routes = new Map()
  try {
    await mkdir(join(home, 'workflow-canvas'))
    await writeFile(join(home, 'workflow-canvas', 'schedules.json'), JSON.stringify([{ id: 'old', name: 'Do not auto-run', cron: '* * * * *', steps: [], doc: { version: 1, name: 'old', nodes: [], edges: [] } }]))
    process.env.DSH_HOME = home
    globalThis.setTimeout = () => { throw new Error('Unexpected startup timer / automatic execution') }
    apply({
      webServer: { register: route => { routes.set(route.path, route.handler); return () => routes.delete(route.path) } },
      effect: callback => { disposers.push(callback()) },
      get: () => { throw new Error('Unexpected model/runtime service access at startup') },
    })
    assert.ok(routes.has('/dsh-node-flow/agent-library'))
    assert.ok(routes.has('/dsh-node-flow/run-codex'))
    assert.ok(routes.has('/dsh-node-flow/schedule'))
  } finally {
    for (const dispose of disposers.reverse()) dispose()
    globalThis.setTimeout = setTimeoutOriginal
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    assert.match(basename(home), /^dsh-flow-startup-/)
    assert.equal(await realpath(home), home)
    await rm(home, { recursive: true, force: true })
  }
  assert.equal(routes.size, 0)
})
