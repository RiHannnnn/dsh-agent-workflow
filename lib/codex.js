import { constants } from 'node:fs';
import { access, lstat, open, opendir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { parse } from 'smol-toml';
import { probeCodexMcpNames } from './codex-config.js';
import { CODEX_LIMITS, runCodexTurn } from './codex-process.js';
export { CODEX_LIMITS } from './codex-process.js';
export const CODEX_CAPABILITY_HEADER = 'x-dsh-node-flow-codex-capability';
export const CODEX_MCP_WARNING = '运行前会探测本地配置中的 MCP 名称并逐一禁用，同时关闭 hooks、plugins 和 apps；遇到托管或无法判断的配置会拒绝运行。请勿在运行时更改 Codex 配置。只读文件沙箱不等于只允许读取所选目录。';
const defaultRole = { agent: { id: 'codex-default', name: 'Codex Default', description: 'Default local Codex role (read-only)', engine: 'codex' } };
class HttpError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
function roleIdValid(id) {
    return id.length > 0 && id.length <= 128 && id !== '.' && id !== '..' && !/[\\/\x00-\x1f\x7f]/u.test(id);
}
function homePath(options) { return resolve(options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), '.codex')); }
async function agentsDirectory(home) {
    const base = await realpath(home);
    const path = join(base, 'agents');
    if (!(await lstat(path)).isDirectory())
        throw new Error('Codex agents directory must be a non-symlink directory');
    if (await realpath(path) !== path)
        throw new Error('Codex agents directory cannot be a symlink');
    return path;
}
async function readRole(directory, id) {
    if (!roleIdValid(id) || id === 'codex-default')
        throw new Error('Invalid Codex role id');
    // Directory is canonical and symlink-free; the basename cannot escape it.
    // O_NOFOLLOW + fstat close the common lstat/open replacement race on the file.
    const path = join(directory, `${id}.toml`);
    if (!(await lstat(path)).isFile())
        throw new Error('Role must be a regular non-symlink file');
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > CODEX_LIMITS.roleBytes)
            throw new Error('Role file exceeds size limit or is not regular');
        const buffer = Buffer.alloc(CODEX_LIMITS.roleBytes + 1);
        let length = 0;
        while (length < buffer.length) {
            const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
            if (bytesRead === 0)
                break;
            length += bytesRead;
        }
        if (length > CODEX_LIMITS.roleBytes)
            throw new Error('Role file exceeds size limit');
        const parsed = parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)));
        const name = parsed.name;
        const description = parsed.description;
        const instructions = parsed.developer_instructions;
        if (name !== undefined && (typeof name !== 'string' || name.length > 256))
            throw new Error('Invalid role name');
        if (description !== undefined && (typeof description !== 'string' || description.length > 4096))
            throw new Error('Invalid role description');
        if (instructions !== undefined && typeof instructions !== 'string')
            throw new Error('Invalid role developer_instructions');
        return { agent: { id, name: name || id, description: description ?? '', engine: 'codex' }, developerInstructions: instructions };
    }
    finally {
        await handle.close();
    }
}
/** Enumerates only agents/*.toml; never opens Codex auth/config/session files. */
export async function loadCodexAgentLibrary(home) {
    const agents = [{ ...defaultRole.agent }];
    const warnings = [];
    let directory;
    try {
        directory = await agentsDirectory(home);
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            warnings.push('Codex agents directory is unavailable or unsafe; using default role only.');
        return { agents, warnings };
    }
    const dir = await opendir(directory);
    let count = 0;
    try {
        for await (const entry of dir) {
            if (++count > 512) {
                warnings.push('Codex agents directory entry limit reached (512).');
                break;
            }
            if (!entry.name.endsWith('.toml'))
                continue;
            const id = entry.name.slice(0, -5);
            if (!roleIdValid(id) || id === 'codex-default' || !entry.isFile()) {
                warnings.push('Skipped an unsafe or reserved Codex role file.');
                continue;
            }
            try {
                agents.push((await readRole(directory, id)).agent);
            }
            catch {
                warnings.push(`Skipped invalid or unsafe Codex role: ${id}`);
            }
        }
    }
    finally {
        // Async iteration normally closes the handle, including early break.
        try {
            await dir.close();
        }
        catch (error) {
            if (error.code !== 'ERR_DIR_CLOSED')
                throw error;
        }
    }
    agents.splice(1, agents.length - 1, ...agents.slice(1).sort((a, b) => a.id.localeCompare(b.id)));
    return { agents, warnings };
}
/** Reject missing/opaque origins, scheme mismatches, DNS rebinding and cross-site fetches. */
export function isCodexSameOrigin(request) {
    const origin = request.headers.origin;
    const host = request.headers.host;
    if (typeof origin !== 'string' || typeof host !== 'string' || request.headers['sec-fetch-site'] === 'cross-site')
        return false;
    try {
        const scheme = request.socket.encrypted ? 'https:' : 'http:';
        const target = new URL(`${scheme}//${host}`);
        const source = new URL(origin);
        if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))
            return false;
        if (target.username || target.password || target.pathname !== '/' || target.search || target.hash)
            return false;
        if (source.origin !== origin || source.origin !== target.origin || source.protocol !== scheme)
            return false;
        if (request.socket.localPort && Number(target.port || (scheme === 'https:' ? 443 : 80)) !== request.socket.localPort)
            return false;
        return true;
    }
    catch {
        return false;
    }
}
function sendJson(response, status, payload) {
    if (response.destroyed || response.writableEnded)
        return;
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...(status === 413 ? { connection: 'close' } : {}) });
    response.end(JSON.stringify(payload));
}
function gate(request, response) {
    if (request.method !== 'POST') {
        response.writeHead(405, { allow: 'POST' });
        response.end();
        return false;
    }
    if (!isCodexSameOrigin(request)) {
        sendJson(response, 403, { error: 'Strict same-origin loopback request required' });
        return false;
    }
    return true;
}
async function readBody(request, signal) {
    if (signal.aborted)
        throw signal.reason;
    if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers['content-type'] ?? ''))
        throw new HttpError(415, 'Content-Type must be application/json');
    if (request.headers['content-encoding'] && request.headers['content-encoding'] !== 'identity')
        throw new HttpError(415, 'Compressed request bodies are not supported');
    const declared = request.headers['content-length'];
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > CODEX_LIMITS.bodyBytes))
        throw new HttpError(413, 'Request body exceeds 4 MiB');
    return new Promise((resolveBody, reject) => {
        let size = 0;
        const chunks = [];
        const cleanup = () => {
            clearTimeout(timer);
            request.removeListener('data', onData);
            request.removeListener('end', onEnd);
            request.removeListener('error', onError);
            request.removeListener('aborted', onAborted);
            signal.removeEventListener('abort', onAborted);
        };
        const fail = (error) => { cleanup(); request.pause(); reject(error); };
        const onData = (chunk) => {
            size += chunk.length;
            if (size > CODEX_LIMITS.bodyBytes) {
                fail(new HttpError(413, 'Request body exceeds 4 MiB'));
                return;
            }
            chunks.push(chunk);
        };
        const onEnd = () => {
            cleanup();
            try {
                resolveBody(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
            }
            catch {
                reject(new HttpError(400, 'Invalid JSON request body'));
            }
        };
        const onError = () => fail(new HttpError(400, 'Request body stream failed'));
        const onAborted = () => fail(new HttpError(499, 'Codex request cancelled'));
        const timer = setTimeout(() => fail(new HttpError(408, 'Request body read timed out')), 10_000);
        request.on('data', onData);
        request.once('end', onEnd);
        request.once('error', onError);
        request.once('aborted', onAborted);
        signal.addEventListener('abort', onAborted, { once: true });
    });
}
export async function validateCodexRequest(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new HttpError(400, 'JSON body must be an object');
    const body = value;
    if (typeof body.prompt !== 'string' || !body.prompt.trim())
        throw new HttpError(400, 'prompt must be a non-empty string');
    if (Buffer.byteLength(body.prompt) > CODEX_LIMITS.promptBytes)
        throw new HttpError(400, 'prompt exceeds 2 MiB');
    if (typeof body.cwd !== 'string' || body.cwd.length > 4096 || body.cwd.includes('\0') || !isAbsolute(body.cwd))
        throw new HttpError(400, 'cwd must be an absolute existing directory');
    let cwd;
    try {
        cwd = await realpath(body.cwd);
        if (!(await stat(cwd)).isDirectory())
            throw new Error('not a directory');
    }
    catch {
        throw new HttpError(400, 'cwd must be an absolute existing directory');
    }
    const roleId = body.roleId ?? 'codex-default';
    if (typeof roleId !== 'string' || !roleIdValid(roleId))
        throw new HttpError(400, 'Invalid roleId');
    if (body.codexModel !== undefined && (typeof body.codexModel !== 'string' || !body.codexModel.trim() || body.codexModel.length > 256 || /[\x00-\x1f\x7f]/u.test(body.codexModel)))
        throw new HttpError(400, 'Invalid codexModel');
    const timeout = body.timeout ?? CODEX_LIMITS.defaultTimeout;
    if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout < CODEX_LIMITS.minTimeout || timeout > CODEX_LIMITS.maxTimeout)
        throw new HttpError(400, 'timeout must be seconds between 1 and 600');
    return { prompt: body.prompt, cwd, roleId, timeout, ...(typeof body.codexModel === 'string' ? { codexModel: body.codexModel } : {}) };
}
async function executablePath(override) {
    const candidates = override ? [override] : (process.env.PATH ?? '').split(delimiter).filter(p => p && isAbsolute(p)).map(p => join(p, process.platform === 'win32' ? 'codex.exe' : 'codex'));
    for (const path of candidates) {
        if (!isAbsolute(path))
            continue;
        try {
            await access(path, constants.X_OK);
            if ((await stat(path)).isFile())
                return path;
        }
        catch { /* unavailable */ }
    }
    return undefined;
}
export function registerCodexRoutes(ctx, options = {}) {
    let dispose = () => { };
    ctx.effect(() => {
        const capability = randomBytes(32);
        const active = new Set();
        const libraryRequests = new Set();
        const removers = [];
        let disposed = false;
        const authorized = (request) => {
            const value = request.headers[CODEX_CAPABILITY_HEADER];
            if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value))
                return false;
            return timingSafeEqual(Buffer.from(value, 'hex'), capability);
        };
        const library = async (request, response) => {
            if (!gate(request, response))
                return;
            if (disposed)
                return sendJson(response, 503, { error: 'Codex routes unloaded' });
            const controller = new AbortController();
            libraryRequests.add(controller);
            const onClose = () => controller.abort(new Error('Codex library request cancelled'));
            response.once('close', onClose);
            try {
                await readBody(request, controller.signal);
                const result = await loadCodexAgentLibrary(homePath(options));
                const executable = await executablePath(options.executable);
                if (disposed || controller.signal.aborted)
                    return;
                response.setHeader(CODEX_CAPABILITY_HEADER, capability.toString('hex'));
                sendJson(response, 200, { ok: true, agents: result.agents, codexAvailable: !!executable, warnings: [...result.warnings, ...(!executable ? ['Codex executable not found on PATH.'] : []), CODEX_MCP_WARNING] });
            }
            catch (error) {
                sendJson(response, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : 'Unable to enumerate local Codex agents' });
            }
            finally {
                libraryRequests.delete(controller);
                response.removeListener('close', onClose);
            }
        };
        const run = async (request, response) => {
            if (!gate(request, response))
                return;
            if (disposed)
                return sendJson(response, 503, { error: 'Codex routes unloaded' });
            if (!authorized(request))
                return sendJson(response, 403, { error: 'Codex capability header required; refresh agent-library first' });
            if (active.size >= CODEX_LIMITS.concurrent)
                return sendJson(response, 429, { error: 'Codex concurrency limit reached (2)' });
            const controller = new AbortController();
            active.add(controller);
            let timer;
            let streaming = false;
            let terminal = false;
            const onClose = () => { if (!response.writableFinished)
                controller.abort(new Error('Codex request disconnected')); };
            const onAborted = () => controller.abort(new Error('Codex request cancelled'));
            const onResponseError = () => controller.abort(new Error('Codex response stream failed'));
            response.once('close', onClose);
            response.once('error', onResponseError);
            request.once('aborted', onAborted);
            const emit = (event) => {
                if (terminal || response.destroyed || response.writableEnded)
                    return;
                const line = JSON.stringify(event) + '\n';
                if (response.writableLength + Buffer.byteLength(line) > CODEX_LIMITS.outputBytes * 2 + CODEX_LIMITS.responseBufferBytes)
                    throw new Error('Codex response buffer size limit exceeded');
                // Stop rather than accumulate unbounded data for a client that is not reading.
                if (response.writableLength > CODEX_LIMITS.responseBufferBytes)
                    throw new Error('Codex response consumer is too slow');
                response.write(line);
                if (event.type === 'done' || event.type === 'error') {
                    terminal = true;
                    response.end();
                }
            };
            try {
                const body = await validateCodexRequest(await readBody(request, controller.signal));
                let role = defaultRole;
                if (body.roleId !== 'codex-default') {
                    try {
                        role = await readRole(await agentsDirectory(homePath(options)), body.roleId);
                    }
                    catch {
                        throw new HttpError(400, 'Unknown, invalid or unsafe Codex role');
                    }
                }
                let disabledMcpServers;
                try {
                    disabledMcpServers = await probeCodexMcpNames(homePath(options), body.cwd);
                }
                catch (error) {
                    throw new HttpError(503, error instanceof Error ? error.message : 'Cannot safely disable inherited Codex MCP servers');
                }
                const executable = await executablePath(options.executable);
                if (!executable)
                    throw new HttpError(503, 'Codex executable not found; install/login with Codex separately');
                if (controller.signal.aborted || disposed)
                    throw new HttpError(499, 'Codex request cancelled');
                timer = setTimeout(() => controller.abort(new Error(`Codex run timed out after ${body.timeout} seconds`)), body.timeout * 1000);
                response.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store, no-transform', 'x-content-type-options': 'nosniff', 'x-accel-buffering': 'no', 'content-encoding': 'identity' });
                response.flushHeaders();
                streaming = true;
                emit({ type: 'status', message: CODEX_MCP_WARNING });
                await runCodexTurn({ ...body, developerInstructions: role.developerInstructions, disabledMcpServers }, { executable, signal: controller.signal, onEvent: emit, spawnProcess: options.spawnProcess });
            }
            catch (error) {
                if (!streaming)
                    sendJson(response, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : 'Codex run could not be started' });
                else {
                    try {
                        emit({ type: 'error', message: error instanceof Error ? error.message : 'Codex run failed' });
                    }
                    catch {
                        response.destroy();
                    }
                }
            }
            finally {
                if (timer)
                    clearTimeout(timer);
                active.delete(controller);
                request.removeListener('aborted', onAborted);
                response.removeListener('close', onClose);
                response.removeListener('error', onResponseError);
                if (streaming && !response.writableEnded && !response.destroyed)
                    response.end();
            }
        };
        dispose = () => {
            if (disposed)
                return;
            disposed = true;
            for (const controller of [...active, ...libraryRequests])
                controller.abort(new Error('Codex plugin unloaded'));
            active.clear();
            libraryRequests.clear();
            for (const remove of removers.splice(0))
                remove();
            capability.fill(0);
        };
        try {
            removers.push(ctx.webServer.register({ kind: 'exact', path: '/dsh-node-flow/agent-library', handler: library }));
            removers.push(ctx.webServer.register({ kind: 'exact', path: '/dsh-node-flow/run-codex', handler: run }));
        }
        catch (error) {
            dispose();
            throw error;
        }
        return dispose;
    });
    return () => dispose();
}
