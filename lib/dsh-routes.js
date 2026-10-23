import { dshHome, listDshAgents, readDshAgentBody } from './dsh-agents.js';
const MAX_BODY = 4 * 1024 * 1024;
const json = (response, status, payload) => {
    if (response.destroyed || response.writableEnded)
        return;
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(JSON.stringify(payload));
};
const sameOrigin = (request) => {
    const origin = request.headers.origin, host = request.headers.host;
    if (typeof origin !== 'string' || typeof host !== 'string')
        return false;
    try {
        return new URL(origin).host === host;
    }
    catch {
        return false;
    }
};
async function readJson(request) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        const buf = chunk instanceof Uint8Array ? Buffer.from(chunk) : Buffer.from(String(chunk));
        size += buf.length;
        if (size > MAX_BODY)
            throw new Error('请求体超过 4 MiB');
        chunks.push(buf);
    }
    return chunks.length ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) : undefined;
}
const textOf = (result) => result.output.filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('');
function providerOf(subagents) {
    for (const name of ['spawn', 'fork', 'acp'])
        if (subagents.getProvider(name) !== undefined)
            return name;
    return subagents.list()[0];
}
export function registerDshAgentRoutes(ctx) {
    const removers = [];
    let disposed = false;
    const library = async (request, response) => {
        if (request.method !== 'POST')
            return json(response, 405, { error: '仅支持 POST' });
        if (!sameOrigin(request))
            return json(response, 403, { error: '仅接受同源请求' });
        try {
            await readJson(request);
            const { agents, warnings } = await listDshAgents(dshHome());
            if (!disposed)
                json(response, 200, { ok: true, engine: 'dsh', agents, available: true, warnings });
        }
        catch (error) {
            json(response, 500, { error: error instanceof Error ? error.message : '无法读取 DSH 角色库' });
        }
    };
    const run = async (request, response) => {
        if (request.method !== 'POST')
            return json(response, 405, { error: '仅支持 POST' });
        if (!sameOrigin(request))
            return json(response, 403, { error: '仅接受同源请求' });
        let streamed = false;
        let timer;
        const controller = new AbortController();
        const onClose = () => { if (!response.writableFinished)
            controller.abort(new Error('请求已断开')); };
        response.once('close', onClose);
        const emit = (event) => {
            if (response.destroyed || response.writableEnded)
                return;
            response.write(JSON.stringify(event) + '\n');
        };
        try {
            const body = (await readJson(request));
            const task = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
            if (!task)
                return json(response, 400, { error: 'prompt 不能为空' });
            if (task.length > 2 * 1024 * 1024)
                return json(response, 400, { error: 'prompt 超过 2 MiB' });
            const roleId = typeof body?.roleId === 'string' ? body.roleId : 'codex-default';
            const timeout = Math.min(600, Math.max(1, Number(body?.timeout) || 120));
            const agents = ctx.get('agents');
            const subagents = ctx.get('subagents');
            if (!agents || !subagents)
                return json(response, 503, { error: 'DSH 子 Agent 服务不可用' });
            const parent = agents.roots()[0] ?? agents.list()[0];
            const provider = providerOf(subagents);
            if (!parent)
                return json(response, 400, { error: '没有可用的 DSH 会话作为父级' });
            if (!provider)
                return json(response, 400, { error: '没有注册 DSH 子 Agent 提供方' });
            let instructions = '';
            if (roleId && roleId !== 'default') {
                try {
                    instructions = await readDshAgentBody(dshHome(), roleId);
                }
                catch {
                    throw new Error(`角色不可用：${roleId}`);
                }
            }
            const prompt = [instructions ? `以下是你的角色说明：\n\n${instructions}` : '', task].filter(Boolean).join('\n\n---\n\n');
            response.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store, no-transform', 'x-accel-buffering': 'no' });
            streamed = true;
            emit({ type: 'status', message: 'DSH 子 Agent 已启动' });
            timer = setTimeout(() => controller.abort(new Error(`运行超时（>${timeout}s）`)), timeout * 1000);
            const runHandle = await subagents.start(provider, { label: 'workflow-agent', prompt: [{ type: 'text', text: prompt }], parent, signal: controller.signal });
            const result = await runHandle.result;
            void runHandle.dispose().catch(() => { });
            if (result.stopReason !== 'completed')
                throw new Error(`子 Agent 未正常完成：${result.stopReason}`);
            emit({ type: 'done', output: textOf(result) });
            response.end();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!streamed)
                json(response, 500, { error: message });
            else {
                try {
                    emit({ type: 'error', message });
                }
                catch { /* closing */ }
                response.end();
            }
        }
        finally {
            if (timer)
                clearTimeout(timer);
            response.removeListener('close', onClose);
        }
    };
    removers.push(ctx.webServer.register({ kind: 'exact', path: '/dsh-node-flow/agent-library', handler: library }));
    removers.push(ctx.webServer.register({ kind: 'exact', path: '/dsh-node-flow/run-dsh', handler: run }));
    return () => {
        disposed = true;
        for (const remove of removers.splice(0))
            remove();
    };
}
