/**
 * Narrow runtime-only MCP safety probe, explicitly authorized by the parent.
 * Only server NAMES are retained. Values, auth and session files are never
 * returned/logged/copied. This does not implement a general config browser.
 * 0.163 root/app-server have no ignore-user-config switch.
 */
import { constants } from 'node:fs'
import { lstat, open, opendir, realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parse } from 'smol-toml'

const MAX_CONFIG_BYTES = 2 * 1024 * 1024
const PROBE_ERROR = 'Cannot safely disable inherited Codex MCP configuration. Use a simple isolated CODEX_HOME with Codex login configured separately; no permissions were bypassed.'
function table(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }

/** Pure parser: errors never include TOML contents or provider credentials. */
export function codexMcpNamesFromToml(text: string): string[] {
  try {
    if (Buffer.byteLength(text) > MAX_CONFIG_BYTES) throw new Error('large')
    const root = parse(text)
    const names = new Set<string>()
    const visit = (layer: Record<string, unknown>, depth: number): void => {
      if (depth > 4) throw new Error('deep')
      // Import/managed/remote configuration cannot be proved safe by this probe.
      for (const key of ['include', 'includes', 'import', 'imports', 'config_file', 'extends', 'cloud', 'cloud_config', 'remote_config', 'managed_config']) {
        if (key in layer) throw new Error('unsupported configuration indirection')
      }
      if (layer.mcp_servers !== undefined) {
        if (!table(layer.mcp_servers)) throw new Error('invalid mcp_servers')
        for (const [name, server] of Object.entries(layer.mcp_servers)) {
          if (!name || name.length > 128 || /[\x00-\x1f\x7f]/u.test(name) || !table(server)) throw new Error('invalid MCP name')
          names.add(name)
          if (names.size > 128) throw new Error('too many servers')
        }
      }
      if (layer.profiles !== undefined) {
        if (!table(layer.profiles)) throw new Error('invalid profiles')
        for (const profile of Object.values(layer.profiles)) {
          if (!table(profile)) throw new Error('invalid profile')
          visit(profile, depth + 1)
        }
      }
    }
    visit(root, 0)
    return [...names].sort()
  } catch { throw new Error(PROBE_ERROR) }
}

async function probeFile(path: string): Promise<string[]> {
  let handle
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.size > MAX_CONFIG_BYTES || await realpath(path) !== path) throw new Error('unsafe file')
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    if (!(await handle.stat()).isFile()) throw new Error('not a regular file')
    const buf = Buffer.alloc(MAX_CONFIG_BYTES + 1)
    let length = 0
    while (length < buf.length) {
      const { bytesRead } = await handle.read(buf, length, buf.length - length, null)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > MAX_CONFIG_BYTES) throw new Error('large')
    return codexMcpNamesFromToml(new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, length)))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new Error(PROBE_ERROR)
  } finally { await handle?.close() }
}

/**
 * Collect all potentially active ordinary local layers, not merely the chosen
 * legacy profile. Managed sources that can override CLI policy fail closed.
 * Does not inspect auth.json, keychain, SQLite or session/rollout content.
 */
export async function probeCodexMcpNames(home: string, cwd: string): Promise<string[]> {
  try {
    if (process.platform === 'win32') throw new Error('Windows managed config probing is unsupported')
    // Managed requirements/config may force enabled hooks/MCP above CLI flags.
    for (const path of ['/etc/codex/managed_config.toml', '/etc/codex/requirements.toml',
      '/Library/Managed Preferences/com.openai.codex.plist']) {
      try { await lstat(path); throw new Error(PROBE_ERROR) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    const homeDirectory = resolve(home)
    const paths = new Set<string>([join(homeDirectory, 'config.toml'), '/etc/codex/config.toml'])
    // Include every standalone profile rather than guessing profile selection.
    let dir
    try {
      dir = await opendir(homeDirectory)
      let entries = 0
      for await (const entry of dir) {
        if (++entries > 1024) throw new Error('too many home entries')
        if (entry.name.endsWith('.config.toml')) {
          if (!entry.isFile()) throw new Error('unsafe profile')
          paths.add(join(homeDirectory, entry.name))
        }
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    finally { try { await dir?.close() } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ERR_DIR_CLOSED') throw error } }
    // Superset of cwd and .codex ancestors ensures trusted project MCP names
    // cannot slip in when thread/start reloads config for the requested cwd.
    paths.add(join(cwd, 'config.toml'))
    let parent = resolve(cwd)
    for (let depth = 0; ; depth++) {
      if (depth > 128) throw new Error('too many ancestors')
      paths.add(join(parent, '.codex', 'config.toml'))
      if (dirname(parent) === parent) break
      parent = dirname(parent)
    }
    if (paths.size > 192) throw new Error('too many config sources')
    const names = new Set<string>()
    for (const path of paths) for (const name of await probeFile(path)) names.add(name)
    if (names.size > 128) throw new Error('too many servers')
    return [...names].sort()
  } catch { throw new Error(PROBE_ERROR) }
}

/** Whole-table TOML avoids Codex's naïve dotted-path split for names with dots. */
export function codexMcpOverride(names: string[]): string {
  return `mcp_servers={${names.map(name => `${JSON.stringify(name)}={enabled=false}`).join(',')}}`
}
