/** Browser-only client. Capability is held in module memory, never disk/storage. */
export type LibraryAgent = { id: string; name: string; description: string; engine: 'codex' }
export type AgentLibraryResult = {
  ok: boolean
  agents: LibraryAgent[]
  codexAvailable: boolean
  warnings?: string[]
  capability?: string
}

export const CODEX_CAPABILITY_HEADER = 'X-DSH-Node-Flow-Codex-Capability'
let capability: string | undefined

export function getAgentLibraryCapability(): string | undefined {
  return capability
}

export async function fetchAgentLibrary(options: { signal?: AbortSignal } = {}): Promise<AgentLibraryResult> {
  const response = await fetch('/dsh-node-flow/agent-library', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    cache: 'no-store',
    signal: options.signal,
  })
  const data: unknown = await response.json()
  if (!response.ok || !data || typeof data !== 'object') throw new Error('角色库暂不可用，请检查本地 Codex 配置后刷新。')
  const raw = data as Record<string, unknown>
  if (typeof raw.ok !== 'boolean' || typeof raw.codexAvailable !== 'boolean' || !Array.isArray(raw.agents)) throw new Error('角色库返回的数据格式无效。')
  const agents = raw.agents.filter((value): value is LibraryAgent => {
    if (!value || typeof value !== 'object') return false
    const agent = value as Record<string, unknown>
    return agent.engine === 'codex' && typeof agent.id === 'string' && agent.id.length > 0 && !/[\\/\u0000-\u001f]/.test(agent.id) && agent.id !== '.' && agent.id !== '..' && typeof agent.name === 'string' && typeof agent.description === 'string'
  })
  // The server supplies this only via the response header, never in persisted data.
  capability = raw.ok ? response.headers.get(CODEX_CAPABILITY_HEADER) || undefined : undefined
  return {
    ok: raw.ok,
    agents,
    codexAvailable: raw.codexAvailable,
    warnings: Array.isArray(raw.warnings) ? raw.warnings.filter((value): value is string => typeof value === 'string') : undefined,
    capability,
  }
}

export async function ensureAgentLibraryCapability(options: { signal?: AbortSignal } = {}): Promise<string | undefined> {
  if (!capability) await fetchAgentLibrary(options)
  return capability
}
