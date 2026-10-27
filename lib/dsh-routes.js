import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { dshHome, listDshAgents, readDshAgentBody } from './dsh-agents.js';
export const DSH_CAPABILITY_HEADER = 'x-dsh-node-flow-capability';
export const DSH_LIMITS = Object.freeze({ concurrent: 2, callsPerRun: 4, openRuns: 16, runMs: 600_000, bodyBytes: 128 * 1024, taskBytes: 64 * 1024, promptBytes: 128 * 1024, runPromptBytes: 256 * 1024, outputBytes: 128 * 1024, outputTokensPerRequest: 4096 });
class HttpError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
function json(response, status, data) {
    if (response.destroyed || response.writableEnded)
        return;
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    response.end(JSON.stringify(data));
}
export function isDshSameOrigin(request) {
    const origin = request.headers.origin, host = request.headers.host;
    if (typeof origin !== 'string' || typeof host !== 'string' || request.headers['sec-fetch-site'] === 'cross-site')
        return false;
    try {
        const scheme = request.socket.encrypted ? 'https:' : 'http:';
        const target = new URL(`${scheme}//${host}`), source = new URL(origin);
        return ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
            && !target.username && !target.password && target.pathname === '/' && !target.search && !target.hash
            && source.origin === origin && source.origin === target.origin && source.protocol === scheme
            && (!request.socket.localPort || Number(target.port || (scheme === 'https:' ? 443 : 80)) === request.socket.localPort);
    }
    catch {
        return false;
    }
}
async function readJson(request, signal) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        const cleanup = () => {
            clearTimeout(timer);
            request.removeListener('data', data);
            request.removeListener('end', end);
            request.removeListener('error', failed);
            request.removeListener('aborted', aborted);
            signal.removeEventListener('abort', aborted);
        };
        const failed = (error) => { cleanup(); reject(error); };
        const aborted = () => failed(new HttpError(499, '请求已取消'));
        const data = (chunk) => {
            size += chunk.length;
            if (size > DSH_LIMITS.bodyBytes) {
                request.pause();
                failed(new HttpError(413, '请求体超过 128 KiB'));
                return;
            }
            chunks.push(chunk);
        };
        const end = () => {
            cleanup();
            try {
                const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
                if (!value || typeof value !== 'object' || Array.isArray(value))
                    throw new Error('object required');
                resolve(value);
            }
            catch {
                reject(new HttpError(400, '请求必须是有效的 JSON 对象'));
            }
        };
        const timer = setTimeout(() => { request.pause(); failed(new HttpError(408, '读取请求超时')); }, 10_000);
        request.on('data', data);
        request.once('end', end);
        request.once('error', failed);
        request.once('aborted', aborted);
        signal.addEventListener('abort', aborted, { once: true });
        if (signal.aborted || request.aborted)
            aborted();
    });
}
function modelOptions(value) {
    if (value === undefined || value === '')
        return {};
    if (typeof value !== 'string' || value.length > 512 || /[\x00-\x1f\x7f]/.test(value))
        throw new HttpError(400, '模型路线无效');
    const parts = value.split('|');
    if (parts.length !== 2 || parts.some(part => !part.trim() || part !== part.trim()))
        throw new HttpError(400, '模型路线应为 provider|model');
    return { provider: parts[0], model: parts[1] };
}
export function registerDshAgentRoutes(ctx, options = {}) {
    const capability = randomBytes(32).toString('hex'), removers = [];
    const executions = new Map(), finished = new Map();
    const requests = new Set();
    let disposed = false, active = 0, cleanupFailed = false;
    const fail = (response, error) => json(response, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : 'DSH 执行失败，请查看宿主诊断；未将部分结果视为成功' });
    const gate = (request, response, requireCapability = true, cleanupOnly = false) => {
        if (disposed || (cleanupFailed && !cleanupOnly)) {
            json(response, 503, { error: '执行服务已停止或后台清理失败，禁止启动新任务' });
            return false;
        }
        if (request.method !== 'POST') {
            json(response, 405, { error: '仅支持 POST' });
            return false;
        }
        if (!isDshSameOrigin(request)) {
            json(response, 403, { error: '仅接受本机严格同源请求' });
            return false;
        }
        if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
            json(response, 415, { error: '需要 application/json' });
            return false;
        }
        const header = request.headers[DSH_CAPABILITY_HEADER];
        if (requireCapability && (typeof header !== 'string' || !/^[a-f0-9]{64}$/.test(header) || !timingSafeEqual(Buffer.from(header), Buffer.from(capability)))) {
            json(response, 403, { error: '执行授权已失效，请刷新 Agent 库' });
            return false;
        }
        return true;
    };
    const runtime = () => {
        const agents = ctx.get('agents'), subagents = ctx.get('subagents');
        if (!agents || !subagents || typeof subagents.startActivation !== 'function' || typeof subagents.resolveMaxDepth !== 'function')
            throw new HttpError(503, 'DSH 原生子 Agent 服务不可用或接口不兼容');
        if (typeof subagents.getProvider('spawn')?.prepareContinuable !== 'function')
            throw new HttpError(503, '需要 DSH 原生 spawn 后端；不会回退到 Codex、外部进程或 fork');
        return { agents, subagents };
    };
    const closeExecution = (execution) => {
        if (execution.closed)
            return execution.closed;
        clearTimeout(execution.timer);
        execution.controller.abort(new Error('工作流已结束或超时'));
        execution.closed = Promise.allSettled([...execution.jobs]).then(() => {
            executions.delete(execution.id);
            finished.set(execution.id, execution.calls);
            while (finished.size > DSH_LIMITS.openRuns)
                finished.delete(finished.keys().next().value);
        });
        return execution.closed;
    };
    const library = async (request, response) => {
        if (!gate(request, response, false))
            return;
        try {
            await readJson(request, AbortSignal.timeout(10_000));
            const { agents, warnings } = await listDshAgents(options.home ?? dshHome());
            const parents = ctx.get('agents')?.roots().map(parent => ({ id: parent.id })) ?? [];
            if (disposed)
                return;
            response.setHeader(DSH_CAPABILITY_HEADER, capability);
            json(response, 200, { ok: true, engine: 'dsh', agents, parents, available: true, warnings, limits: DSH_LIMITS });
        }
        catch (error) {
            fail(response, error);
        }
    };
    const begin = async (request, response) => {
        if (!gate(request, response))
            return;
        try {
            const body = await readJson(request, AbortSignal.timeout(10_000)), { agents } = runtime();
            if (disposed)
                throw new HttpError(503, '插件已卸载');
            if (executions.size >= DSH_LIMITS.openRuns)
                throw new HttpError(429, '未结束的执行过多，请先停止旧任务');
            const roots = agents.roots();
            if (body.parentSessionId !== undefined && typeof body.parentSessionId !== 'string')
                throw new HttpError(400, '父会话标识无效');
            const parent = body.parentSessionId ? roots.find(root => root.id === body.parentSessionId) : roots.length === 1 ? roots[0] : undefined;
            if (!parent || agents.get(parent.id) !== parent)
                throw new HttpError(409, '请明确选择一个在线 DSH 根会话；不会猜测工作目录或父级');
            const execution = { id: randomUUID(), parent, calls: 0, promptBytes: 0, controller: new AbortController(), jobs: new Set(), timer: undefined };
            execution.timer = setTimeout(() => { void closeExecution(execution); }, DSH_LIMITS.runMs);
            execution.timer.unref?.();
            executions.set(execution.id, execution);
            json(response, 200, { runId: execution.id, parentSessionId: parent.id, limits: DSH_LIMITS });
        }
        catch (error) {
            fail(response, error);
        }
    };
    const end = async (request, response) => {
        // Cleanup remains available after a cleanup failure; it may not start any model.
        const admitted = gate(request, response, true, true);
        if (!admitted)
            return;
        try {
            const body = await readJson(request, AbortSignal.timeout(10_000));
            if (typeof body.runId !== 'string')
                throw new HttpError(400, '缺少执行标识');
            const execution = executions.get(body.runId);
            if (execution)
                await closeExecution(execution);
            else if (!finished.has(body.runId))
                throw new HttpError(404, '执行不存在');
            if (cleanupFailed)
                throw new HttpError(503, '后台取消未确认，禁止新执行');
            json(response, 200, { ok: true, calls: finished.get(body.runId) ?? execution?.calls ?? 0 });
        }
        catch (error) {
            fail(response, error);
        }
    };
    const run = async (request, response) => {
        if (!gate(request, response))
            return;
        const controller = new AbortController();
        requests.add(controller);
        let timer, receipt, cleanup;
        let execution, completeJob, job, streamed = false;
        const abort = () => controller.abort(new Error('运行已取消'));
        const onClose = () => { if (!response.writableFinished)
            abort(); };
        const dispose = () => {
            if (!receipt)
                return Promise.resolve();
            return cleanup ??= Promise.resolve().then(() => receipt.dispose()).catch(error => { cleanupFailed = true; throw error; });
        };
        const emit = (event) => { if (!response.destroyed && !response.writableEnded)
            response.write(JSON.stringify(event) + '\n'); };
        response.once('close', onClose);
        request.once('aborted', abort);
        try {
            const body = await readJson(request, controller.signal);
            execution = typeof body.runId === 'string' ? executions.get(body.runId) : undefined;
            if (!execution || execution.controller.signal.aborted)
                throw new HttpError(409, '请先开始一个有效的工作流执行');
            execution.controller.signal.addEventListener('abort', abort, { once: true });
            const task = typeof body.prompt === 'string' ? body.prompt.trim() : '';
            if (!task || Buffer.byteLength(task) > DSH_LIMITS.taskBytes)
                throw new HttpError(400, '任务不能为空且最多 64 KiB；不会静默截断');
            const route = modelOptions(body.model);
            const timeout = body.timeout === undefined ? 120 : body.timeout;
            if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1 || timeout > 600)
                throw new HttpError(400, '超时应为 1–600 秒整数');
            const roleId = body.roleId === undefined ? '' : body.roleId;
            if (typeof roleId !== 'string' || (roleId && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(roleId)) || roleId === 'codex-default')
                throw new HttpError(400, '请选择有效的 DSH 角色，不支持旧 Codex 默认角色');
            let instructions = '';
            if (roleId && roleId !== 'default' && roleId !== 'dsh-default') {
                try {
                    instructions = await readDshAgentBody(options.home ?? dshHome(), roleId);
                }
                catch {
                    throw new HttpError(400, 'DSH 角色不可用，请刷新角色库');
                }
            }
            const prompt = [instructions ? `以下是你的角色说明：\n\n${instructions}` : '', task].filter(Boolean).join('\n\n---\n\n');
            const promptBytes = Buffer.byteLength(prompt), { agents, subagents } = runtime();
            controller.signal.throwIfAborted();
            if (disposed || cleanupFailed || execution.controller.signal.aborted || agents.get(execution.parent.id) !== execution.parent)
                throw new HttpError(409, '执行或父会话已失效');
            if (active >= DSH_LIMITS.concurrent)
                throw new HttpError(429, '最多同时执行 2 个 Agent；后台清理完成后才能继续');
            if (execution.calls >= DSH_LIMITS.callsPerRun)
                throw new HttpError(429, '本次执行最多 4 次 Agent 调用，请缩小工作流后明确重新运行');
            if (promptBytes > DSH_LIMITS.promptBytes || execution.promptBytes + promptBytes > DSH_LIMITS.runPromptBytes)
                throw new HttpError(413, '角色与输入超过本次字节预算；不会静默丢弃上下文');
            const maxDepth = Math.min(1, subagents.resolveMaxDepth());
            if (!Number.isSafeInteger(maxDepth) || maxDepth < 1)
                throw new HttpError(403, 'DSH 已禁止子 Agent 委派');
            execution.calls++;
            execution.promptBytes += promptBytes;
            active++;
            job = new Promise(resolve => { completeJob = resolve; });
            execution.jobs.add(job);
            response.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store, no-transform', 'x-accel-buffering': 'no' });
            streamed = true;
            emit({ type: 'status', message: 'DSH 子 Agent 启动中；当前为完整结果交接' });
            timer = setTimeout(abort, timeout * 1000);
            const inherited = execution.parent.options?.maxTokens;
            const maxTokens = typeof inherited === 'number' && inherited > 0 ? Math.min(inherited, DSH_LIMITS.outputTokensPerRequest) : DSH_LIMITS.outputTokensPerRequest;
            receipt = await subagents.startActivation({ provider: 'spawn', label: 'workflow-agent', delivery: 'caller', signal: controller.signal, request: { parent: execution.parent, prompt: [{ type: 'text', text: prompt }], maxDepth, agentOptions: { ...route, maxTokens } } });
            // Observe rejection even if cancellation won before the late receipt arrived.
            void receipt.result.catch(() => { });
            controller.signal.throwIfAborted();
            let rejectAbort;
            const aborted = new Promise((_, reject) => { rejectAbort = () => reject(new HttpError(499, '执行已取消或超时')); controller.signal.addEventListener('abort', rejectAbort, { once: true }); if (controller.signal.aborted)
                rejectAbort(); });
            let result;
            try {
                result = await Promise.race([receipt.result, aborted]);
            }
            finally {
                controller.signal.removeEventListener('abort', rejectAbort);
            }
            await dispose();
            controller.signal.throwIfAborted();
            if (result.stopReason !== 'completed')
                throw new HttpError(502, 'DSH 子 Agent 未正常完成');
            const output = result.output.filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('');
            if (Buffer.byteLength(output) > DSH_LIMITS.outputBytes)
                throw new HttpError(413, '结果超过 128 KiB 限制；未将截断结果视为成功');
            emit({ type: 'done', output });
        }
        catch (error) {
            if (!streamed)
                fail(response, error);
            else
                emit({ type: 'error', message: controller.signal.aborted ? '执行已取消或超时，正在清理后台' : error instanceof HttpError ? error.message : 'DSH 执行或后台清理失败，未返回成功' });
        }
        finally {
            if (timer)
                clearTimeout(timer);
            try {
                await dispose();
            }
            catch { /* service stays quarantined after an unconfirmed cleanup */ }
            execution?.controller.signal.removeEventListener('abort', abort);
            response.removeListener('close', onClose);
            request.removeListener('aborted', abort);
            requests.delete(controller);
            if (job) {
                execution.jobs.delete(job);
                active--;
                completeJob();
            }
            if (!response.destroyed && !response.writableEnded)
                response.end();
        }
    };
    for (const [path, handler] of [['/dsh-node-flow/agent-library', library], ['/dsh-node-flow/dsh-begin', begin], ['/dsh-node-flow/dsh-end', end], ['/dsh-node-flow/run-dsh', run]])
        removers.push(ctx.webServer.register({ kind: 'exact', path, handler }));
    return async () => {
        disposed = true;
        for (const remove of removers.splice(0))
            remove();
        for (const controller of requests)
            controller.abort(new Error('插件已卸载'));
        await Promise.all([...executions.values()].map(closeExecution));
        if (cleanupFailed)
            throw new Error('DSH workflow cleanup failed; background termination was not confirmed');
    };
}
