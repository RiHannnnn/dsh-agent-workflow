/** Codex 0.163 app-server stdio adapter. No shell, auth/session reads or exec fallback. */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { codexMcpOverride } from './codex-config.js'

export type CodexEvent = { type: 'delta'; text: string } | { type: 'status'; message: string }
  | { type: 'done'; output: string } | { type: 'error'; message: string }
export interface CodexTurnRequest {
  prompt: string
  cwd: string
  codexModel?: string
  developerInstructions?: string
  /** Server names from the fail-closed, runtime-only local MCP policy probe. */
  disabledMcpServers?: string[]
}
export interface CodexProcessOptions {
  executable: string
  signal: AbortSignal
  onEvent: (event: CodexEvent) => void
  /** Test seam: production always uses node:child_process.spawn, with shell:false. */
  spawnProcess?: typeof spawn
}
export const CODEX_LIMITS = Object.freeze({
  bodyBytes: 4 * 1024 * 1024,
  promptBytes: 2 * 1024 * 1024,
  roleBytes: 256 * 1024,
  outputBytes: 2 * 1024 * 1024,
  rpcLineBytes: 4 * 1024 * 1024,
  protocolBytes: 16 * 1024 * 1024,
  responseBufferBytes: 256 * 1024,
  concurrent: 2,
  minTimeout: 1,
  maxTimeout: 600,
  defaultTimeout: 120,
})

/**
 * Verified against generated 0.163.0 ThreadStartParams / TurnStartParams.
 * Global hooks/plugins/apps are disabled before app-server initialization.
 * The route's runtime-only config probe supplies every known local MCP server
 * name, disabled individually before app-server starts (an empty table alone
 * does not remove inherited entries). Unknown configuration sources fail closed.
 * Server-side tool/permission requests are refused, never granted.
 */
export function codexSpawnArgs(disabledMcpServers: string[] = []): string[] {
  return ['app-server', '--stdio',
    '-c', 'approval_policy="never"', '-c', 'sandbox_mode="read-only"',
    '--disable', 'hooks', '--disable', 'plugins', '--disable', 'apps',
    '--disable', 'multi_agent', '--disable', 'multi_agent_v2',
    '-c', codexMcpOverride(disabledMcpServers), '-c', 'web_search="disabled"',
    '-c', 'notify=[]',
    '-c', 'allow_login_shell=false', '-c', 'shell_environment_policy.inherit="none"',
  ]
}

const PERMISSION_NOTICE = 'Codex tool permission was denied. This adapter is read-only, approvalPolicy=never; permissions will not be elevated or bypassed.'
function safeError(value: unknown): string {
  // Do not forward stderr/config diagnostics which can include local credentials.
  if (value && typeof value === 'object' && 'message' in value && typeof value.message === 'string') {
    if (/permission|sandbox|approval|denied|not permitted/i.test(value.message)) return PERMISSION_NOTICE
  }
  return 'Codex app-server rejected the request; check the local Codex installation/login and model. No permission bypass was attempted.'
}

/** Starts one ephemeral thread and one turn, returning only after terminal cleanup. */
export async function runCodexTurn(request: CodexTurnRequest, options: CodexProcessOptions): Promise<void> {
  if (options.signal.aborted) throw options.signal.reason ?? new Error('Codex run cancelled')
  const start = options.spawnProcess ?? spawn
  const child = start(options.executable, codexSpawnArgs(request.disabledMcpServers), {
    cwd: request.cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: false,
    // Own process group lets cancellation kill Codex's tools as well as Codex.
    detached: process.platform !== 'win32', windowsHide: true,
    env: { ...process.env, NO_COLOR: '1' },
  }) as ChildProcessWithoutNullStreams
  let closed = false
  let killed = false
  const kill = (): void => {
    if (killed) return
    killed = true
    if (process.platform !== 'win32' && child.pid) {
      try { process.kill(-child.pid, 'SIGKILL') } catch { /* already exited */ }
    }
    try { child.kill('SIGKILL') } catch { /* already exited */ }
    child.stdin.destroy()
    child.stdout.destroy()
    child.stderr.destroy()
  }
  let finished = false
  let counter = 0
  let threadId: string | undefined
  let turnId: string | undefined
  let acceptingTurn = false
  let bytes = 0
  let stderrBytes = 0
  let outputBytes = 0
  let line = ''
  const decoder = new StringDecoder('utf8')
  const pending = new Map<number, { resolve: (value: any) => void; reject: (reason: Error) => void }>()
  const messages = new Map<string, string>()
  const visibleMessages = new Set<string>()
  const hiddenMessages = new Set<string>()
  let resolveTerminal!: () => void
  let rejectTerminal!: (error: Error) => void
  const terminal = new Promise<void>((resolve, reject) => { resolveTerminal = resolve; rejectTerminal = reject })
  // Notifications can fail before the initialize await completes.
  void terminal.catch(() => {})
  const fail = (error: Error): void => {
    if (finished) return
    finished = true
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
    rejectTerminal(error)
  }
  const send = (message: unknown): void => {
    if (finished || child.stdin.destroyed) throw new Error('Codex transport closed')
    const text = JSON.stringify(message) + '\n'
    if (child.stdin.writableLength + Buffer.byteLength(text) > CODEX_LIMITS.rpcLineBytes) throw new Error('Codex input buffer limit exceeded')
    child.stdin.write(text)
  }
  const rpc = (method: string, params: unknown): Promise<any> => new Promise((resolve, reject) => {
    const id = ++counter
    pending.set(id, { resolve, reject })
    try { send({ id, method, params }) } catch (error) { pending.delete(id); reject(error) }
  })
  const emit = (event: CodexEvent): void => { options.onEvent(event) }
  const textDelta = (id: string, delta: string): void => {
    if (!messages.has(id) && messages.size > 0) {
      outputBytes += 2
      emit({ type: 'delta', text: '\n\n' })
    }
    outputBytes += Buffer.byteLength(delta)
    if (outputBytes > CODEX_LIMITS.outputBytes) throw new Error('Codex output size limit exceeded')
    messages.set(id, (messages.get(id) ?? '') + delta)
    emit({ type: 'delta', text: delta })
  }
  const completeMessage = (item: any): void => {
    if (item?.type !== 'agentMessage' || typeof item.id !== 'string' || typeof item.text !== 'string') return
    if (item.phase === 'commentary' || hiddenMessages.has(item.id)) return
    const prior = messages.get(item.id) ?? ''
    if (!item.text.startsWith(prior)) throw new Error('Codex sent inconsistent agent message text')
    const remaining = item.text.slice(prior.length)
    if (remaining) textDelta(item.id, remaining)
  }
  const receive = (message: any): void => {
    if (!message || typeof message !== 'object') return
    if (message.id !== undefined && typeof message.method !== 'string') {
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id)
      if (message.error) entry.reject(new Error(safeError(message.error)))
      else entry.resolve(message.result)
      return
    }
    if (finished || typeof message.method !== 'string') return
    if (message.id !== undefined) {
      // Never grant tool execution, authentication, elicitation or permission requests.
      try { send({ id: message.id, error: { code: -32601, message: PERMISSION_NOTICE } }) } catch { /* shutting down */ }
      throw new Error(PERMISSION_NOTICE)
    }
    const p = message.params
    if (!p || p.threadId !== threadId || !acceptingTurn) return
    if (turnId && p.turnId && p.turnId !== turnId) return
    if (message.method === 'item/started' && p.item?.type === 'agentMessage' && typeof p.item.id === 'string') {
      if (p.item.phase === 'commentary') hiddenMessages.add(p.item.id)
      else visibleMessages.add(p.item.id)
    } else if (message.method === 'item/agentMessage/delta') {
      if (typeof p.itemId !== 'string' || typeof p.delta !== 'string') throw new Error('Malformed Codex agent delta')
      // Unannounced messages are reconciled from item/completed, not guessed
      // into a downstream answer. Commentary must not trigger a workflow node.
      if (visibleMessages.has(p.itemId) && !hiddenMessages.has(p.itemId)) textDelta(p.itemId, p.delta)
    } else if (message.method === 'item/started' && p.item?.type === 'mcpToolCall') {
      throw new Error('Unexpected inherited MCP tool call; stopping without granting permissions. Use an isolated CODEX_HOME.')
    } else if (message.method === 'item/completed') {
      completeMessage(p.item)
      if (p.item?.type === 'mcpToolCall') throw new Error('Inherited MCP tool call detected; Codex run stopped without permission escalation. Disable configured MCP servers before retrying.')
      if ((p.item?.type === 'commandExecution' && p.item.exitCode !== 0 && /permission|sandbox|denied|not permitted/i.test(p.item.aggregatedOutput ?? ''))
        || (p.item?.type === 'fileChange' && p.item.status === 'failed')) emit({ type: 'status', message: PERMISSION_NOTICE })
    } else if (message.method === 'error' && p.willRetry !== true) {
      throw new Error(safeError(p.error))
    } else if (message.method === 'turn/completed') {
      if (turnId && p.turn?.id !== turnId) return
      if (p.turn?.status !== 'completed') throw new Error(p.turn?.status === 'interrupted' ? 'Codex turn was interrupted' : safeError(p.turn?.error))
      if (Array.isArray(p.turn.items)) for (const item of p.turn.items) completeMessage(item)
      emit({ type: 'done', output: [...messages.values()].join('\n\n') })
      finished = true
      resolveTerminal()
    }
  }
  const onData = (chunk: Buffer): void => {
    if (finished && pending.size === 0) return
    try {
      bytes += chunk.byteLength
      if (bytes > CODEX_LIMITS.protocolBytes) throw new Error('Codex protocol size limit exceeded')
      line += decoder.write(chunk)
      let newline: number
      while ((newline = line.indexOf('\n')) !== -1) {
        const one = line.slice(0, newline)
        line = line.slice(newline + 1)
        if (Buffer.byteLength(one) > CODEX_LIMITS.rpcLineBytes) throw new Error('Codex protocol line size limit exceeded')
        if (one.trim()) {
          let parsed: unknown
          try { parsed = JSON.parse(one) } catch { throw new Error('Malformed Codex JSONRPC message') }
          receive(parsed)
        }
      }
      if (Buffer.byteLength(line) > CODEX_LIMITS.rpcLineBytes) throw new Error('Codex protocol buffer limit exceeded')
    } catch (error) { fail(error instanceof Error ? error : new Error('Malformed Codex protocol')) }
  }
  const onStderr = (chunk: Buffer): void => {
    // Drain but never retain or expose potentially sensitive diagnostics.
    stderrBytes += chunk.byteLength
    if (stderrBytes > CODEX_LIMITS.protocolBytes) fail(new Error('Codex stderr size limit exceeded'))
  }
  const onError = (): void => fail(new Error('Unable to start Codex app-server; check the executable installation'))
  const onInputError = (): void => fail(new Error('Codex stdio transport failed'))
  const onClose = (): void => { closed = true; fail(new Error('Codex app-server exited before the turn completed')) }
  const onEnd = (): void => { if (!finished) fail(new Error('Codex app-server closed its protocol stream before completion')) }
  const onAbort = (): void => { fail(options.signal.reason instanceof Error ? options.signal.reason : new Error('Codex run cancelled')); kill() }
  child.on('error', onError)
  child.on('close', onClose)
  child.stdin.on('error', onInputError)
  child.stdout.on('error', onInputError)
  child.stderr.on('error', onInputError)
  child.stdout.on('data', onData)
  child.stdout.on('end', onEnd)
  child.stderr.on('data', onStderr)
  options.signal.addEventListener('abort', onAbort, { once: true })
  if (options.signal.aborted) onAbort()
  try {
    emit({ type: 'status', message: 'Starting Codex app-server (read-only; approvals never; hooks/plugins/apps disabled).' })
    await rpc('initialize', { clientInfo: { name: 'dsh-node-flow', title: 'DSH Node Flow', version: '0.1.0' }, capabilities: { experimentalApi: false, requestAttestation: false, explicitGatewayOauth: true } })
    send({ method: 'initialized', params: {} })
    const result = await rpc('thread/start', {
      cwd: request.cwd, ...(request.codexModel ? { model: request.codexModel } : {}),
      sandbox: 'read-only', approvalPolicy: 'never', approvalsReviewer: 'user', ephemeral: true,
      ...(request.developerInstructions ? { developerInstructions: request.developerInstructions } : {}),
      config: { 'features.hooks': false, 'features.plugins': false, 'features.apps': false, 'features.multi_agent': false, 'features.multi_agent_v2': false, mcp_servers: Object.fromEntries((request.disabledMcpServers ?? []).map(name => [name, { enabled: false }])), web_search: 'disabled', notify: [] },
    })
    if (typeof result?.thread?.id !== 'string') throw new Error('Codex thread/start returned no thread id')
    // Never proceed if the server resolved a more permissive policy.
    if (result.approvalPolicy !== 'never' || result.sandbox?.type !== 'readOnly' || result.sandbox.networkAccess !== false) throw new Error('Codex did not honor read-only/never permissions; refusing to start the turn')
    threadId = result.thread.id
    acceptingTurn = true
    const turn = await rpc('turn/start', {
      threadId, cwd: request.cwd, approvalPolicy: 'never', approvalsReviewer: 'user',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
      input: [{ type: 'text', text: request.prompt, text_elements: [] }],
    })
    if (typeof turn?.turn?.id !== 'string') throw new Error('Codex turn/start returned no turn id')
    turnId = turn.turn.id
    await terminal
  } finally {
    finished = true
    for (const entry of pending.values()) entry.reject(new Error('Codex transport disposed'))
    pending.clear()
    options.signal.removeEventListener('abort', onAbort)
    kill()
    child.removeListener('close', onClose)
    if (closed) child.removeListener('error', onError)
    else child.once('close', () => child.removeListener('error', onError))
    child.stdout.removeListener('data', onData)
    child.stdout.removeListener('end', onEnd)
    child.stderr.removeListener('data', onStderr)
    // Keep error sinks until streams close; destroying a pipe may enqueue EPIPE.
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      if (stream.closed) stream.removeListener('error', onInputError)
      else stream.once('close', () => stream.removeListener('error', onInputError))
    }
    line = ''
    messages.clear(); visibleMessages.clear(); hiddenMessages.clear()
  }
}
