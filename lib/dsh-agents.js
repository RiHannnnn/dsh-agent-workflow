/**
 * DSH-native agent roles.
 *
 * Roles come from the profile's skill library (`$DSH_HOME/skills/<dir>/SKILL.md`).
 * Only the YAML frontmatter is read for the library listing; the role body is
 * read at execution time and injected as instructions for a DSH subagent.
 * Nothing outside the skills directory is read, and files are never modified.
 */
import { open, opendir, lstat, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
export const AGENT_LIMITS = Object.freeze({ dirs: 400, metaBytes: 64 * 1024, bodyBytes: 256 * 1024 });
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** Read at most `limit` bytes of a regular, non-symlink file. */
async function readBounded(path, limit) {
    const info = await lstat(path);
    if (!info.isFile())
        throw new Error('not a regular file');
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        if (!(await handle.stat()).isFile())
            throw new Error('not a regular file');
        const buffer = Buffer.alloc(limit + 1);
        let length = 0;
        while (length < buffer.length) {
            const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
            if (!bytesRead)
                break;
            length += bytesRead;
        }
        if (length > limit)
            throw new Error('file too large');
        return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
    }
    finally {
        await handle.close();
    }
}
/** Split YAML frontmatter from the Markdown body. */
export function splitFrontmatter(text) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
    if (!match)
        return { meta: {}, body: text };
    const meta = {};
    for (const line of match[1].split(/\r?\n/)) {
        const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
        if (!kv)
            continue;
        let value = kv[2].trim();
        if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"')))
            value = value.slice(1, -1);
        meta[kv[1]] = value;
    }
    return { meta, body: text.slice(match[0].length) };
}
/** Prefer the role's own H1 title; the frontmatter name is a slug. */
export function displayName(meta, body, fallback) {
    const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
    const raw = heading || meta.name || fallback;
    return raw.replace(/^agency-/i, '').replace(/\s+(Agent\s+)?Personality$/i, '').replace(/\s+Agent$/i, '').trim() || fallback;
}
function skillsDir(home) { return join(home, 'skills'); }
/** Enumerate DSH skill roles; unreadable entries are skipped, not fatal. */
export async function listDshAgents(home) {
    const agents = [];
    const warnings = [];
    const root = skillsDir(home);
    let directory;
    try {
        directory = await realpath(root);
        if (!(await lstat(directory)).isDirectory())
            throw new Error('not a directory');
    }
    catch {
        return { agents, warnings: ['未找到 DSH 技能目录；请先在 DSH 中安装技能角色。'] };
    }
    const dir = await opendir(directory);
    let count = 0;
    try {
        for await (const entry of dir) {
            if (++count > AGENT_LIMITS.dirs) {
                warnings.push('技能数量超过上限，仅显示前 400 个。');
                break;
            }
            if (!entry.isDirectory() || !idPattern.test(entry.name))
                continue;
            try {
                const text = await readBounded(join(directory, entry.name, 'SKILL.md'), AGENT_LIMITS.metaBytes);
                const { meta, body } = splitFrontmatter(text);
                agents.push({ id: entry.name, name: displayName(meta, body, entry.name), description: meta.description ?? '', engine: 'dsh' });
            }
            catch {
                warnings.push(`跳过无法读取的技能：${entry.name}`);
            }
        }
    }
    finally {
        try {
            await dir.close();
        }
        catch { /* already closed */ }
    }
    agents.sort((a, b) => a.id.localeCompare(b.id));
    return { agents, warnings };
}
/** Read one role's instruction body (frontmatter stripped), guarded against traversal. */
export async function readDshAgentBody(home, id) {
    if (!idPattern.test(id))
        throw new Error('无效的角色标识');
    const directory = await realpath(skillsDir(home));
    const text = await readBounded(join(directory, id, 'SKILL.md'), AGENT_LIMITS.bodyBytes);
    const { body } = splitFrontmatter(text);
    if (!body.trim())
        throw new Error('角色说明为空');
    return body.trim();
}
export function dshHome() { return process.env.DSH_HOME || join(homedir(), '.dsh'); }
