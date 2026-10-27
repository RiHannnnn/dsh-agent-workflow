const HEADER = 'x-dsh-node-flow-capability';
async function resultOf(response) {
    const body = await response.json();
    if (!body || typeof body !== 'object' || Array.isArray(body))
        throw new Error('DSH 执行服务返回无效数据');
    const data = body;
    if (!response.ok)
        throw new Error(typeof data.error === 'string' ? data.error : `DSH HTTP ${response.status}`);
    return data;
}
export async function beginDshExecution(signal, chooseParent) {
    signal.throwIfAborted();
    const response = await fetch('/dsh-node-flow/agent-library', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', cache: 'no-store', signal });
    const library = await resultOf(response), capability = response.headers.get(HEADER);
    if (library.ok !== true || library.available === false || !capability || !/^[a-f0-9]{64}$/.test(capability))
        throw new Error('DSH 执行授权不可用，请刷新或检查插件版本');
    const ids = Array.isArray(library.parents) ? library.parents.flatMap(value => {
        const id = value && typeof value === 'object' ? value.id : undefined;
        return typeof id === 'string' && id.length > 0 && id.length <= 256 && !/[\x00-\x1f\x7f]/.test(id) ? [id] : [];
    }) : [];
    if (!ids.length)
        throw new Error('没有在线 DSH 根会话，请先打开一个工作会话');
    const parentSessionId = ids.length === 1 ? ids[0] : chooseParent?.(ids);
    if (!parentSessionId || !ids.includes(parentSessionId))
        throw new Error('未选择父会话；没有启动任何 Agent');
    signal.throwIfAborted();
    const data = await resultOf(await fetch('/dsh-node-flow/dsh-begin', { method: 'POST', headers: { 'content-type': 'application/json', [HEADER]: capability }, body: JSON.stringify({ parentSessionId }), signal }));
    const limits = data.limits;
    if (typeof data.runId !== 'string' || data.parentSessionId !== parentSessionId || typeof limits?.callsPerRun !== 'number' || !Number.isSafeInteger(limits.callsPerRun) || limits.callsPerRun < 1)
        throw new Error('DSH 执行标识无效');
    return { runId: data.runId, capability, parentSessionId, callsPerRun: limits.callsPerRun };
}
export async function finishDshExecution(execution) {
    // The run's signal is often already aborted. Cleanup must use a fresh deadline.
    const data = await resultOf(await fetch('/dsh-node-flow/dsh-end', { method: 'POST', headers: { 'content-type': 'application/json', [HEADER]: execution.capability }, body: JSON.stringify({ runId: execution.runId }), signal: AbortSignal.timeout(10_000) }));
    if (data.ok !== true || typeof data.calls !== 'number')
        throw new Error('后台清理未确认');
    return data.calls;
}
export function dshExecutionRequest(execution) {
    if (!execution)
        throw new Error('请通过工作流运行按钮开始 DSH 执行');
    return { runId: execution.runId, headers: { 'content-type': 'application/json', [HEADER]: execution.capability } };
}
