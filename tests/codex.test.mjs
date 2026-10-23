import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { spawn as realSpawn } from 'node:child_process'
import { PassThrough, Writable } from 'node:stream'
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { registerCodexRoutes, loadCodexAgentLibrary, validateCodexRequest, isCodexSameOrigin, CODEX_CAPABILITY_HEADER, CODEX_LIMITS } from '../lib/codex.js'
import { runCodexTurn, codexSpawnArgs } from '../lib/codex-process.js'
import { codexMcpNamesFromToml, codexMcpOverride } from '../lib/codex-config.js'

async function fixture(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'dsh-codex-test-')))
  await mkdir(join(directory, 'agents'))
  t.after(async () => {
    assert.match(basename(directory), /^dsh-codex-test-/)
    assert.equal(await realpath(directory), directory)
    await rm(directory, { recursive: true, force: true })
  })
  return directory
}

function mockSpawn(mode = 'normal') {
  const children = []
  const calls = []
  function spawn(executable, args, options) {
    calls.push({ executable, args, options })
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.killed = false
    child.requests = []
    child.kill = () => { child.killed = true; queueMicrotask(() => child.emit('close', null, 'SIGKILL')); return true }
    const send = (message) => child.stdout.write(JSON.stringify(message) + '\n')
    const notify = (method, params) => send({ method, params: { threadId: 'thread-1', turnId: 'turn-1', ...params } })
    let input = ''
    child.stdin = new Writable({ write(chunk, _encoding, callback) {
      input += chunk.toString()
      let newline
      while ((newline = input.indexOf('\n')) !== -1) {
        const req = JSON.parse(input.slice(0, newline)); input = input.slice(newline + 1)
        child.requests.push(req)
        queueMicrotask(() => {
          if (child.killed) return
          if (mode === 'hang') return
          if (mode === 'malformed') { child.stdout.write('credential-sensitive-invalid-json\n'); return }
          if (mode === 'spawnError') { child.emit('error', new Error('secret stderr')); return }
          if (mode === 'earlyEnd') { child.stdout.end(); return }
          if (mode === 'rpcError') { send({ id: req.id, error: { message: 'permission denied /secret/file' } }); return }
          if (req.method === 'initialize') send({ id: req.id, result: {} })
          if (req.method === 'thread/start') send({ id: req.id, result: { thread: { id: 'thread-1' }, approvalPolicy: mode === 'badPolicy' ? 'on-request' : 'never', sandbox: { type: 'readOnly', networkAccess: false } } })
          if (req.method === 'turn/start') {
            send({ id: req.id, result: { turn: { id: 'turn-1' } } })
            queueMicrotask(() => {
              if (mode === 'commentary') {
                notify('item/started', { item: { type: 'agentMessage', id: 'progress-1', phase: 'commentary', text: '' } })
                notify('item/agentMessage/delta', { itemId: 'progress-1', delta: 'Progress must not reach downstream.\n\n' })
                notify('item/completed', { item: { type: 'agentMessage', id: 'progress-1', phase: 'commentary', text: 'Progress must not reach downstream.\n\n' } })
              }
              if (mode !== 'unannounced') notify('item/started', { item: { type: 'agentMessage', id: 'message-1', phase: 'final_answer', text: '' } })
              if (mode === 'permission') { send({ id: 50, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-1' } }); return }
              if (mode === 'protocolLimit') { child.stdout.write('x'.repeat(CODEX_LIMITS.rpcLineBytes + 1)); return }
              if (mode === 'outputLimit') { notify('item/agentMessage/delta', { itemId: 'message-1', delta: 'x'.repeat(CODEX_LIMITS.outputBytes + 1) }); return }
              if (mode === 'mcp') { notify('item/started', { item: { type: 'mcpToolCall', id: 'tool-1' } }); return }
              if (mode === 'foreign') { notify('item/agentMessage/delta', { threadId: 'foreign-thread', itemId: 'message-1', delta: 'foreign secret' }) }
              if (mode !== 'finalOnly') {
                // UTF-8 split in the middle of a multibyte token tests StringDecoder.
                const raw = Buffer.from(JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', turnId: 'turn-1', itemId: 'message-1', delta: '你好' } }) + '\n')
                const split = raw.indexOf(Buffer.from('你')) + 1
                child.stdout.write(raw.subarray(0, split)); child.stdout.write(raw.subarray(split))
                notify('item/agentMessage/delta', { itemId: 'message-1', delta: ' world' })
              }
              notify('item/completed', { item: { type: 'agentMessage', id: 'message-1', text: '你好 world' } })
              if (mode === 'failedTurn') notify('turn/completed', { turn: { id: 'turn-1', status: 'failed', error: { message: 'sandbox permission denied' } } })
              else notify('turn/completed', { turn: { id: 'turn-1', status: 'completed', items: [] } })
            })
          }
        })
      }
      callback()
    } })
    children.push(child)
    return child
  }
  return { spawn, children, calls }
}

class Response extends EventEmitter {
  statusCode = 200
  headers = {}
  chunks = []
  destroyed = false
  writableEnded = false
  writableFinished = false
  writableLength = 0
  setHeader(key, value) { this.headers[key.toLowerCase()] = value }
  writeHead(status, headers = {}) { this.statusCode = status; for (const [key, value] of Object.entries(headers)) this.setHeader(key, value); return this }
  flushHeaders() {}
  write(chunk) { this.chunks.push(String(chunk)); return true }
  end(chunk) { if (chunk) this.write(chunk); this.writableEnded = this.writableFinished = true; this.emit('finish') }
  destroy() { this.destroyed = true; this.emit('close') }
  json() { return JSON.parse(this.chunks.join('')) }
  events() { return this.chunks.join('').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) }
}
function request({ method = 'POST', origin = 'http://127.0.0.1:43120', host = '127.0.0.1:43120', capability, headers = {} } = {}) {
  const req = new PassThrough()
  req.method = method
  req.headers = { origin, host, 'content-type': 'application/json', ...(capability ? { [CODEX_CAPABILITY_HEADER]: capability } : {}), ...headers }
  req.socket = { localPort: 43120 }
  return req
}
function register(options) {
  const routes = new Map()
  let effectDispose
  const dispose = registerCodexRoutes({
    webServer: { register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path) } },
    effect(callback) { effectDispose = callback() },
  }, options)
  return { routes, dispose, effectDispose }
}
async function invoke(app, path, body = {}, opts = {}) {
  const req = request(opts); const res = new Response()
  const work = app.routes.get(`/dsh-node-flow/${path}`)(req, res)
  req.end(typeof body === 'string' ? body : JSON.stringify(body))
  await work
  return { req, res }
}
async function getCapability(app) {
  const { res } = await invoke(app, 'agent-library')
  assert.equal(res.statusCode, 200)
  assert.match(res.headers[CODEX_CAPABILITY_HEADER], /^[a-f0-9]{64}$/)
  return res.headers[CODEX_CAPABILITY_HEADER]
}

// The only filesystem data read here is synthetic fixture configuration/roles.
// No test starts a real Codex process, HTTP server, daemon, or LLM call.
test('library parses real multiline/escaped TOML and exposes metadata only', async t => {
  const home = await fixture(t)
  await writeFile(join(home, 'agents', 'reviewer.toml'), `name = "Reviewer\\nRole"\ndescription = '''Read-only\nreview'''\ndeveloper_instructions = """\nPrivate system role.\nNever send this to the UI.\n"""\nmodel = "ignored-role-model"\n`)
  const result = await loadCodexAgentLibrary(home)
  assert.deepEqual(result.agents.map(a => a.id), ['codex-default', 'reviewer'])
  assert.equal(result.agents[1].name, 'Reviewer\nRole')
  assert.equal(result.agents[1].engine, 'codex')
  assert.doesNotMatch(JSON.stringify(result), /Private system|developer_instructions|ignored-role-model/)
})
test('library skips symlinks, invalid and oversized roles, and reserved default file', async t => {
  const home = await fixture(t)
  await writeFile(join(home, 'outside.toml'), 'developer_instructions="PRIVATE"')
  await symlink(join(home, 'outside.toml'), join(home, 'agents', 'symlink.toml'))
  await writeFile(join(home, 'agents', 'bad.toml'), 'secret = "SECRET"\ninvalid = [')
  await writeFile(join(home, 'agents', 'large.toml'), 'x'.repeat(CODEX_LIMITS.roleBytes + 1))
  await writeFile(join(home, 'agents', 'codex-default.toml'), 'name="fake default"')
  const result = await loadCodexAgentLibrary(home)
  assert.deepEqual(result.agents.map(a => a.id), ['codex-default'])
  assert.ok(result.warnings.length >= 4)
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|SECRET|fake default/)
})
test('missing or symlink agents directory safely uses default', async t => {
  const home = await fixture(t)
  const nested = join(home, 'nested'); await mkdir(nested)
  assert.equal((await loadCodexAgentLibrary(nested)).agents.length, 1)
  await symlink(join(home, 'agents'), join(nested, 'agents'))
  const result = await loadCodexAgentLibrary(nested)
  assert.equal(result.agents.length, 1); assert.ok(result.warnings.length)
})
test('strict same-origin checks full scheme, loopback authority, exact origin and port', () => {
  assert.ok(isCodexSameOrigin(request()))
  for (const opts of [{ origin: undefined, headers: { origin: undefined } }, { origin: 'null' }, { origin: 'https://127.0.0.1:43120' }, { origin: 'http://127.0.0.1:43120/path' }, { origin: 'http://evil.test:43120', host: 'evil.test:43120' }, { origin: 'http://127.0.0.1:1234', host: '127.0.0.1:1234' }, { headers: { 'sec-fetch-site': 'cross-site' } }]) assert.equal(isCodexSameOrigin(request(opts)), false)
})
test('validate prompt, role traversal, cwd, model and timeout boundaries', async t => {
  const cwd = await fixture(t)
  const base = { prompt: 'hello', cwd }
  assert.equal((await validateCodexRequest(base)).timeout, 120)
  for (const patch of [{ prompt: '' }, { prompt: 'x'.repeat(CODEX_LIMITS.promptBytes + 1) }, { cwd: '.' }, { cwd: join(cwd, 'missing') }, { roleId: '../outside' }, { roleId: '..\\outside' }, { codexModel: '\u0000evil' }, { timeout: 0 }, { timeout: 601 }, { timeout: '5' }, { timeout: NaN }, { timeout: Infinity }]) await assert.rejects(validateCodexRequest({ ...base, ...patch }))
  await writeFile(join(cwd, 'not-dir'), 'x')
  await assert.rejects(validateCodexRequest({ ...base, cwd: join(cwd, 'not-dir') }))
  for (const timeout of [1, 600]) assert.equal((await validateCodexRequest({ ...base, timeout })).timeout, timeout)
})
test('MCP probe extracts only names from root and profiles, never secret values', () => {
  const text = `model="secret-model"\n[mcp_servers.files]\ncommand="secret-executable"\n[profiles.private.mcp_servers."name.with.dot"]\nurl="https://secret.example/token"\n`
  const names = codexMcpNamesFromToml(text)
  assert.deepEqual(names, ['files', 'name.with.dot'])
  assert.equal(codexMcpOverride(names), 'mcp_servers={"files"={enabled=false},"name.with.dot"={enabled=false}}')
  assert.doesNotMatch(JSON.stringify(names), /secret/)
})
test('MCP probe fails closed on malformed TOML, imports, unsupported shapes without leaking values', () => {
  for (const text of ['token="TOPSECRET"\ninvalid=[', 'include="TOPSECRET"', 'mcp_servers="TOPSECRET"', '[profiles.x]\nimports=["TOPSECRET"]', '[cloud]\nsecret="TOPSECRET"']) assert.throws(() => codexMcpNamesFromToml(text), error => !error.message.includes('TOPSECRET') && /isolated CODEX_HOME/.test(error.message))
})
test('spawn args force read-only, never, disabled hooks/plugins/apps and named MCP servers', () => {
  const args = codexSpawnArgs(['files'])
  assert.deepEqual(args.slice(0, 2), ['app-server', '--stdio'])
  assert.ok(args.includes('approval_policy="never"')); assert.ok(args.includes('sandbox_mode="read-only"'))
  for (const feature of ['hooks', 'plugins', 'apps', 'multi_agent']) assert.ok(args.some((arg, i) => arg === '--disable' && args[i + 1] === feature))
  assert.ok(args.includes('mcp_servers={"files"={enabled=false}}'))
  assert.doesNotMatch(args.join(' '), /dangerously|bypass|workspace-write/)
})
test('app-server initialize/thread/turn yields genuine incremental deltas and one done', async t => {
  const cwd = await fixture(t); const mock = mockSpawn(); const events = []
  await runCodexTurn({ prompt: 'user prompt', cwd, developerInstructions: 'PRIVATE ROLE', codexModel: 'requested-model', disabledMcpServers: ['files'] }, { executable: '/mock/codex', signal: new AbortController().signal, spawnProcess: mock.spawn, onEvent: event => events.push(event) })
  assert.deepEqual(events.filter(e => e.type === 'delta').map(e => e.text), ['你好', ' world'])
  assert.deepEqual(events.filter(e => e.type === 'done'), [{ type: 'done', output: '你好 world' }])
  const requests = mock.children[0].requests
  assert.deepEqual(requests.map(r => r.method), ['initialize', 'initialized', 'thread/start', 'turn/start'])
  const thread = requests.find(r => r.method === 'thread/start').params
  assert.equal(thread.developerInstructions, 'PRIVATE ROLE'); assert.equal(thread.model, 'requested-model')
  assert.equal(thread.sandbox, 'read-only'); assert.equal(thread.approvalPolicy, 'never'); assert.equal(thread.ephemeral, true)
  assert.deepEqual(thread.config.mcp_servers, { files: { enabled: false } })
  const turn = requests.find(r => r.method === 'turn/start').params
  assert.equal(turn.input[0].text, 'user prompt'); assert.doesNotMatch(turn.input[0].text, /PRIVATE ROLE/)
  assert.deepEqual(turn.sandboxPolicy, { type: 'readOnly', networkAccess: false })
  assert.equal(mock.calls[0].options.shell, false)
  assert.ok(mock.children[0].killed)
  assert.equal(mock.children[0].stdout.listenerCount('data'), 0)
})
for (const mode of ['finalOnly', 'foreign', 'commentary', 'unannounced']) test(`app-server ${mode} output reconciliation`, async t => {
  const cwd = await fixture(t); const mock = mockSpawn(mode); const events = []
  await runCodexTurn({ prompt: 'test', cwd }, { executable: '/mock/codex', signal: new AbortController().signal, spawnProcess: mock.spawn, onEvent: e => events.push(e) })
  assert.equal(events.at(-1).output, '你好 world'); assert.doesNotMatch(JSON.stringify(events), /foreign secret|Progress must not reach/)
})
for (const mode of ['badPolicy', 'permission', 'rpcError', 'malformed', 'spawnError', 'earlyEnd', 'outputLimit', 'protocolLimit', 'failedTurn', 'mcp']) test(`app-server ${mode} fails with cleanup and no permission bypass`, async t => {
  const cwd = await fixture(t); const mock = mockSpawn(mode); const events = []
  await assert.rejects(runCodexTurn({ prompt: 'test', cwd }, { executable: '/mock/codex', signal: new AbortController().signal, spawnProcess: mock.spawn, onEvent: e => events.push(e) }), error => { assert.doesNotMatch(error.message, /credential-sensitive|secret stderr|\/secret\/file/); return true })
  assert.ok(mock.children[0].killed)
  assert.equal(events.filter(e => e.type === 'done').length, 0)
  if (mode === 'badPolicy') assert.ok(!mock.children[0].requests.some(r => r.method === 'turn/start'))
})
test('app-server cancellation kills the process and removes transport listeners', async t => {
  const cwd = await fixture(t); const mock = mockSpawn('hang'); const controller = new AbortController()
  const work = runCodexTurn({ prompt: 'test', cwd }, { executable: '/mock/codex', signal: controller.signal, spawnProcess: mock.spawn, onEvent() {} })
  controller.abort(new Error('cancel test'))
  await assert.rejects(work, /cancel test/)
  assert.ok(mock.children[0].killed)
  assert.equal(mock.children[0].stdout.listenerCount('data'), 0)
})
test('routes enforce methods/origins and capability without starting a child', async t => {
  const home = await fixture(t); const mock = mockSpawn(); const app = register({ codexHome: home, executable: process.execPath, spawnProcess: mock.spawn }); t.after(app.dispose)
  assert.equal((await invoke(app, 'agent-library', {}, { method: 'GET' })).res.statusCode, 405)
  assert.equal((await invoke(app, 'agent-library', {}, { origin: 'http://evil.test' })).res.statusCode, 403)
  assert.equal((await invoke(app, 'run-codex', { prompt: 'test', cwd: home })).res.statusCode, 403)
  const capability = await getCapability(app)
  assert.equal((await invoke(app, 'run-codex', { prompt: 'test', cwd: home }, { capability: capability.replace(/^./, capability[0] === '0' ? '1' : '0') })).res.statusCode, 403)
  assert.equal(mock.children.length, 0)
  const res = (await invoke(app, 'agent-library')).res
  assert.equal(res.json().codexAvailable, true)
  assert.equal(res.headers['cache-control'], 'no-store')
})
test('routes stream NDJSON, inject a re-read role, disable fixture MCP and clean up', async t => {
  const home = await fixture(t)
  await writeFile(join(home, 'agents', 'review.toml'), 'name="Review"\ndeveloper_instructions="PRIVATE REVIEW"')
  await writeFile(join(home, 'config.toml'), '[mcp_servers.files]\ncommand="NEVER_EXECUTE"')
  const mock = mockSpawn(); const app = register({ codexHome: home, executable: process.execPath, spawnProcess: mock.spawn }); t.after(app.dispose)
  const capability = await getCapability(app)
  const { res, req } = await invoke(app, 'run-codex', { prompt: 'test', roleId: 'review', cwd: home }, { capability })
  assert.equal(res.statusCode, 200)
  assert.match(res.headers['content-type'], /ndjson/)
  assert.equal(res.events().at(-1).type, 'done')
  assert.equal(res.events().at(-1).output, '你好 world')
  assert.doesNotMatch(res.chunks.join(''), /PRIVATE REVIEW|NEVER_EXECUTE/)
  assert.equal(mock.children[0].requests.find(r => r.method === 'thread/start').params.developerInstructions, 'PRIVATE REVIEW')
  assert.ok(mock.calls[0].args.includes('mcp_servers={"files"={enabled=false}}'))
  assert.equal(req.listenerCount('aborted'), 0); assert.equal(res.listenerCount('close'), 0)
})
test('routes revalidate symlink roles at run time and fail closed on bad config', async t => {
  const home = await fixture(t)
  await writeFile(join(home, 'private.toml'), 'developer_instructions="SECRET"')
  await symlink(join(home, 'private.toml'), join(home, 'agents', 'role.toml'))
  const mock = mockSpawn(); const app = register({ codexHome: home, executable: process.execPath, spawnProcess: mock.spawn }); t.after(app.dispose)
  const capability = await getCapability(app)
  assert.equal((await invoke(app, 'run-codex', { prompt: 'test', roleId: 'role', cwd: home }, { capability })).res.statusCode, 400)
  await writeFile(join(home, 'config.toml'), 'secret="SECRET"\nbroken=[')
  const result = await invoke(app, 'run-codex', { prompt: 'test', cwd: home }, { capability })
  assert.equal(result.res.statusCode, 503); assert.doesNotMatch(result.res.chunks.join(''), /SECRET/)
  assert.equal(mock.children.length, 0)
})
test('route body cap, media type, malformed JSON and prompt cap apply before spawn', async t => {
  const home = await fixture(t); const mock = mockSpawn(); const app = register({ codexHome: home, executable: process.execPath, spawnProcess: mock.spawn }); t.after(app.dispose)
  const capability = await getCapability(app)
  assert.equal((await invoke(app, 'run-codex', '{broken', { capability })).res.statusCode, 400)
  assert.equal((await invoke(app, 'run-codex', {}, { capability, headers: { 'content-type': 'text/plain' } })).res.statusCode, 415)
  assert.equal((await invoke(app, 'run-codex', '{}', { capability, headers: { 'content-length': String(CODEX_LIMITS.bodyBytes + 1) } })).res.statusCode, 413)
  assert.equal((await invoke(app, 'run-codex', 'x'.repeat(CODEX_LIMITS.bodyBytes + 1), { capability })).res.statusCode, 413)
  assert.equal((await invoke(app, 'run-codex', { prompt: 'x'.repeat(CODEX_LIMITS.promptBytes + 1), cwd: home }, { capability })).res.statusCode, 400)
  assert.equal(mock.children.length, 0)
})
test('route timeout aborts process and emits exactly one terminal error', async t => {
  const home = await fixture(t); const mock = mockSpawn('hang'); const app = register({ codexHome: home, executable: process.execPath, spawnProcess: mock.spawn }); t.after(app.dispose)
  const capability = await getCapability(app)
  const { res } = await invoke(app, 'run-codex', { prompt: 'test', cwd: home, timeout: 1 }, { capability })
  assert.equal(res.events().filter(e => e.type === 'error').length, 1)
  assert.match(res.events().at(-1).message, /timed out/)
  assert.ok(mock.children[0].killed)
})
test('route disconnect and unload cancel pending work; two-run concurrency cap holds', async t => {
  const home = await fixture(t); const mock = mockSpawn('hang'); const app = register({ codexHome: home, executable: process.execPath, spawnProcess: mock.spawn }); t.after(app.dispose)
  const capability = await getCapability(app)
  const requests = [request({ capability }), request({ capability })]
  const responses = [new Response(), new Response()]
  const handler = app.routes.get('/dsh-node-flow/run-codex')
  const work = requests.map((req, i) => { const result = handler(req, responses[i]); req.end(JSON.stringify({ prompt: 'test', cwd: home })); return result })
  assert.equal((await invoke(app, 'run-codex', { prompt: 'test', cwd: home }, { capability })).res.statusCode, 429)
  // Wait for observable mock transport creation, not a fixed sleep.
  while (mock.children.length < 2) await new Promise(resolve => setImmediate(resolve))
  responses[0].destroy()
  app.dispose(); app.effectDispose()
  await Promise.all(work)
  assert.ok(mock.children.every(child => child.killed))
  assert.equal(app.routes.size, 0)
  assert.equal(responses[1].events().at(-1).type, 'error')
})
test('library reports unavailable executable without exposing filesystem internals', async t => {
  const home = await fixture(t); const app = register({ codexHome: home, executable: '/nonexistent/codex' }); t.after(app.dispose)
  const { res } = await invoke(app, 'agent-library')
  assert.equal(res.json().codexAvailable, false)
  assert.ok(res.json().warnings.length)
  assert.doesNotMatch(res.chunks.join(''), /nonexistent/)
})
