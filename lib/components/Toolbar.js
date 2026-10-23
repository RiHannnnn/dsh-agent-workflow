import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Toolbar — add nodes, run/export the workflow.
 *
 * `Run` walks the compiled step list in order and executes each node kind:
 * agent/code nodes hit the host routes; output/condition nodes are evaluated
 * locally. Results flow downstream through a `lastOutput` variable (the most
 * recent agent/code output), available to output (`{{result}}`) and condition
 * nodes.
 *
 * @module components/Toolbar
 */
import { useEffect, useRef, useState } from 'react';
import { useCanvasStore } from '../store/canvas.js';
import { ScheduleBoard } from './ScheduleBoard.js';
import { HelpDoc } from './HelpDoc.js';
import { runDagWorkflow, supportsDag, triggerInput } from '../runner.js';
import { executeAgent, executeCode } from '../client-execution.js';
const now = () => new Date().toLocaleTimeString();
/** Substitute `{{key}}` placeholders in an output template. */
function renderTemplate(template, vars) {
    return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key) => {
        const v = vars[key];
        return v === undefined ? match : typeof v === 'object' ? JSON.stringify(v) : String(v);
    });
}
/** Evaluate an expression against a `result` variable (best-effort). */
function evalExpr(expr, vars) {
    try {
        // eslint-disable-next-line no-new-func
        return new Function('result', `"use strict"; return (${expr});`)(vars.result);
    }
    catch {
        return undefined;
    }
}
/** Evaluate a condition expression to a boolean against a `result` variable. */
function evalCondition(expr, vars) {
    return Boolean(evalExpr(expr, vars));
}
/** Parse a route response as JSON, falling back to a readable text error. */
async function parseResponse(res) {
    try {
        return (await res.json());
    }
    catch {
        const text = await res.text().catch(() => '');
        return { ok: false, error: `HTTP ${res.status} - ${text.slice(0, 200)}` };
    }
}
export function Toolbar({ onExitNodeMode }) {
    const updateNodeData = useCanvasStore((s) => s.updateNodeData);
    const workflowName = useCanvasStore((s) => s.workflowName);
    const setWorkflowName = useCanvasStore((s) => s.setWorkflowName);
    const nameRef = useRef(null);
    const [showBoard, setShowBoard] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    const running = useCanvasStore(s => s.isRunning);
    const setRunning = useCanvasStore(s => s.setRunning);
    const [runStatus, setRunStatus] = useState('');
    const abortRef = useRef(null);
    useEffect(() => () => abortRef.current?.abort(), []);
    const onRunLegacy = async () => {
        const signal = abortRef.current.signal;
        const store = useCanvasStore.getState();
        const nodes = store.nodes;
        const edges = store.edges;
        if (nodes.length === 0) {
            alert('工作流为空');
            return;
        }
        const byId = new Map(nodes.map((n) => [n.id, n]));
        const edgesFrom = (id) => edges.filter((e) => e.source === id);
        // Reset every node to a neutral (gray) border first.
        store.clearActiveEdges();
        for (const n of nodes)
            updateNodeData(n.id, { lastRun: undefined });
        let startIds = nodes
            .filter((n) => n.data.kind === 'trigger' || n.data.kind === 'schedule')
            .map((n) => n.id);
        if (startIds.length === 0)
            startIds = nodes.map((n) => n.id);
        const visited = new Set();
        let ran = false;
        let budget = 0;
        // Run a single loop/while body iteration by walking from `iterateId`. The
        // body walk terminates (returns) the moment control flows back to `loopId`
        // via the `back` edge, so each iteration is a self-contained sub-walk.
        const runLoopBody = async (iterateId, loopId, input) => {
            if (!iterateId)
                return input;
            // Each iteration gets a FRESH clone of the outer visited (which does not
            // include body nodes), so body nodes re-run every time. The clone is what
            // executeNode mutates; the outer `visited` stays clean. executeNode's
            // `stopAt=loopId` ends the sub-walk the moment control flows back to the
            // loop node (the `back` edge), which is the iteration's terminal value.
            const bodyVisited = new Set(visited);
            return await executeNode(iterateId, input, bodyVisited, loopId);
        };
        // Execute ONE node. Returns the value flowing out of it. When `stopAt` is
        // supplied, reaching that id (the loop/while node) ends a body sub-walk.
        const executeNode = async (id, input, ctxVisited, stopAt) => {
            if (signal.aborted)
                throw new Error('运行已停止');
            if (!byId.has(id))
                return input;
            if (id === stopAt)
                return input;
            if (ctxVisited.has(id))
                return input;
            ctxVisited.add(id);
            ran = true;
            budget += 1;
            if (budget > 100_000)
                throw new Error('超过运行步数上限（可能死循环）');
            const n = byId.get(id);
            const d = n.data;
            const t0 = performance.now();
            const dur = () => Math.round(performance.now() - t0);
            const setVal = (patch) => updateNodeData(id, { lastRun: { input, logs: [], ...patch, at: now(), duration: dur() } });
            const fail = (err) => updateNodeData(id, { lastRun: { input, logs: [], error: err instanceof Error ? err.message : String(err), at: now(), duration: dur() } });
            // Non-branch fan-out: follow every outgoing edge; the value that flows
            // back to the loop boundary (stopAt) is what the last executed downstream
            // node produced, so loop/while see the branch's end value, not the first.
            const fanOut = async (value) => {
                let last = value;
                for (const e of edgesFrom(id)) {
                    store.markEdgeActive(e.id);
                    last = await executeNode(e.target, value, ctxVisited, stopAt);
                }
                return last;
            };
            try {
                if (d.kind === 'trigger' || d.kind === 'schedule') {
                    const value = triggerInput(n);
                    setVal({ value });
                    return await fanOut(value);
                }
                else if (d.kind === 'code') {
                    setVal({ running: true });
                    const onError = d.onError === 'continue' ? 'continue' : 'stop';
                    let nodeError;
                    let val = '';
                    try {
                        const res = await fetch('/dsh-node-flow/run', {
                            signal,
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ program: d.code ?? '', language: d.language ?? 'typescript', input, timeout: parseInt(d.timeout ?? '', 10) || 0 }),
                        });
                        const data = await parseResponse(res);
                        if (!res.ok)
                            throw new Error(data.error ?? `HTTP ${res.status}`);
                        const value = data.value;
                        const logs = data.logs ?? [];
                        nodeError = data.failure?.message ?? data.error;
                        updateNodeData(id, { lastRun: { input, logs, value, error: nodeError, at: now(), duration: dur() } });
                        val = value !== undefined ? (typeof value === 'object' ? JSON.stringify(value) : String(value)) : logs.join('\n');
                    }
                    catch (err) {
                        nodeError = err instanceof Error ? err.message : String(err);
                        fail(err);
                    }
                    if (nodeError) {
                        if (onError === 'continue')
                            return await fanOut('');
                        return input;
                    }
                    return await fanOut(val);
                }
                else if (d.kind === 'agent') {
                    const received = input;
                    const prompt = [received, d.prompt ?? ''].map((s) => s.trim()).filter(Boolean).join('\n\n');
                    // Optional per-node model route, stored as "provider|modelId".
                    const modelRoute = d.model ?? '';
                    const sep = modelRoute.indexOf('|');
                    const agentOptions = sep > 0 ? { provider: modelRoute.slice(0, sep), model: modelRoute.slice(sep + 1) } : undefined;
                    setVal({ running: true });
                    const onError = d.onError === 'continue' ? 'continue' : 'stop';
                    let nodeError;
                    let out = '';
                    try {
                        const res = await fetch('/dsh-node-flow/run-agent', {
                            signal,
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ prompt, timeout: parseInt(d.timeout ?? '', 10) || 0, agentOptions }),
                        });
                        const data = await parseResponse(res);
                        if (!res.ok)
                            throw new Error(data.error ?? `HTTP ${res.status}`);
                        out = data.output ?? '';
                        nodeError = data.error;
                        updateNodeData(id, { lastRun: { input: received, logs: [], value: out, error: nodeError, at: now(), duration: dur() } });
                    }
                    catch (err) {
                        nodeError = err instanceof Error ? err.message : String(err);
                        fail(err);
                    }
                    if (nodeError) {
                        if (onError === 'continue')
                            return await fanOut('');
                        return received;
                    }
                    return await fanOut(out);
                }
                else if (d.kind === 'output') {
                    const template = (d.template ?? '').trim() ? d.template : '{{result}}';
                    const rendered = renderTemplate(template, { result: input });
                    updateNodeData(id, { lastRun: { input, logs: [], value: rendered, at: now(), duration: dur() } });
                    return await fanOut(rendered);
                }
                else if (d.kind === 'if') {
                    const ok = evalCondition(d.condition ?? '', { result: input });
                    updateNodeData(id, { lastRun: { input, logs: [], value: String(ok), at: now(), duration: dur() } });
                    const want = ok ? 'true' : 'false';
                    const edge = edgesFrom(id).find((e) => (e.sourceHandle ?? 'true') === want);
                    if (edge) {
                        store.markEdgeActive(edge.id);
                        return await executeNode(edge.target, input, ctxVisited, stopAt);
                    }
                    return input;
                }
                else if (d.kind === 'switch') {
                    const val = evalExpr(d.condition ?? '', { result: input });
                    updateNodeData(id, { lastRun: { input, logs: [], value: String(val), at: now(), duration: dur() } });
                    const cases = (d.cases ?? '').split(',').map((s) => s.trim()).filter(Boolean);
                    const sval = String(val);
                    let edge = edgesFrom(id).find((e) => e.sourceHandle && cases.includes(e.sourceHandle) && e.sourceHandle === sval);
                    if (!edge)
                        edge = edgesFrom(id).find((e) => e.sourceHandle === 'default');
                    if (edge) {
                        store.markEdgeActive(edge.id);
                        return await executeNode(edge.target, input, ctxVisited, stopAt);
                    }
                    return input;
                }
                else if (d.kind === 'loop' || d.kind === 'while') {
                    const value = await runLoopOrWhile(id, d, input);
                    updateNodeData(id, { lastRun: { input, logs: [], value, at: now(), duration: dur() } });
                    const doneEdge = edgesFrom(id).find((e) => e.sourceHandle === 'done' || (!e.sourceHandle && e.sourceHandle !== 'iterate'));
                    if (doneEdge) {
                        store.markEdgeActive(doneEdge.id);
                        return await executeNode(doneEdge.target, value, ctxVisited, stopAt);
                    }
                    return value;
                }
                return input;
            }
            catch (err) {
                fail(err);
                return input;
            }
        };
        // Evaluate the loop/while node itself: run its body across iterations, then
        // produce the `done` value (collected array or the last iteration result).
        const runLoopOrWhile = async (id, d, input) => {
            const loopId = id;
            const iterateEdge = edgesFrom(id).find((e) => e.sourceHandle === 'iterate');
            const maxIters = parseInt(d.maxIters ?? '', 10) || 100;
            const collect = Boolean(d.collect);
            const results = [];
            let count = 0;
            if (d.kind === 'loop') {
                let items = [];
                if ((d.mode ?? 'items') === 'count') {
                    const c = parseInt(d.count ?? '', 10) || 0;
                    items = Array.from({ length: c }, (_, i) => String(i + 1));
                }
                else {
                    const arr = evalExpr(d.itemsExpr ?? '', { result: input });
                    items = Array.isArray(arr) ? arr : [];
                }
                for (const it of items) {
                    if (count >= maxIters)
                        break;
                    count += 1;
                    const item = typeof it === 'string' ? it : JSON.stringify(it);
                    const r = await runLoopBody(iterateEdge?.target ?? '', loopId, item);
                    if (collect)
                        results.push(r);
                }
                return collect ? JSON.stringify(results) : String(results.length ? results[results.length - 1] : input);
            }
            // while: keep going while the condition (against the current value) is true.
            let cond = input;
            while (true) {
                if (count >= maxIters)
                    break;
                const ok = evalCondition(d.condition ?? '', { result: cond });
                if (!ok)
                    break;
                count += 1;
                const r = await runLoopBody(iterateEdge?.target ?? '', loopId, cond);
                cond = r;
                if (collect)
                    results.push(r);
            }
            return collect ? JSON.stringify(results) : String(cond);
        };
        for (const sid of startIds) {
            await executeNode(sid, '', visited);
        }
        if (!ran)
            alert('工作流没有可执行的节点。');
    };
    const onRun = async () => {
        if (abortRef.current || useCanvasStore.getState().isRunning)
            return;
        let doc;
        try {
            doc = useCanvasStore.getState().exportDocument();
        }
        catch (error) {
            setRunStatus(error instanceof Error ? error.message : String(error));
            return;
        }
        const codex = doc.nodes.filter(n => n.data.kind === 'agent' && n.data.engine === 'codex');
        const simple = supportsDag(doc);
        if (!simple && codex.length) {
            setRunStatus('第一版 Codex 运行暂不支持 If/Switch/Loop/While/定时节点，请使用普通连线');
            return;
        }
        if (!simple && doc.nodes.some(n => n.data.handoff === 'paragraph')) {
            setRunStatus('控制节点仅支持完整交接');
            return;
        }
        if (codex.some(n => !n.data.cwd?.startsWith('/'))) {
            setRunStatus('请先为每个 Codex 节点填写绝对工作目录');
            return;
        }
        const workspaces = [...new Set(codex.map(n => n.data.cwd))];
        const codeCount = doc.nodes.filter(n => n.data.kind === 'code').length;
        const incremental = codex.some(n => n.data.handoff === 'paragraph');
        const warnings = [
            codex.length ? `将用本机 Codex 运行 ${codex.length} 个节点（只读文件权限），内容会发送给 Codex 配置的模型服务。\n工作目录：\n${workspaces.join('\n')}` : '',
            incremental ? '逐段模式会在上游完成前触发下游，每段是一次独立调用，单次工作流最多 32 次；不是共享会话。' : '',
            codeCount ? `包含 ${codeCount} 个代码节点（可在宿主执行代码）。请确认你信任其代码和导入的工作流。` : '',
            !simple ? '包含表达式/控制节点，使用原版完整交接模式；请确认你信任表达式。' : '',
        ].filter(Boolean);
        if (warnings.length && !window.confirm(warnings.join('\n\n') + '\n\n确认运行？'))
            return;
        const controller = new AbortController();
        abortRef.current = controller;
        setRunning(true);
        setRunStatus('运行中：实时输出可在节点和右侧面板查看');
        const store = useCanvasStore.getState();
        store.clearActiveEdges();
        for (const node of doc.nodes)
            updateNodeData(node.id, { lastRun: undefined });
        try {
            if (simple)
                await runDagWorkflow(doc, {
                    signal: controller.signal, runAgent: executeAgent, runCode: executeCode,
                    update: (id, patch) => updateNodeData(id, { lastRun: { logs: [], ...patch } }),
                    edge: store.markEdgeActive,
                });
            else
                await onRunLegacy();
            setRunStatus(controller.signal.aborted ? '已停止' : '运行结束；请查看各节点结果');
        }
        catch (error) {
            setRunStatus(controller.signal.aborted ? '已停止' : `运行失败：${error instanceof Error ? error.message : String(error)}`);
        }
        finally {
            abortRef.current = null;
            setRunning(false);
        }
    };
    const saveWorkflow = async () => {
        const doc = useCanvasStore.getState().exportDocument();
        const json = JSON.stringify(doc, null, 2);
        const filename = `${workflowName.replace(/\s+/g, '-').toLowerCase()}.workflow.json`;
        const picker = window.showSaveFilePicker;
        if (picker) {
            try {
                // Always show a fresh "Save as" dialog so the user picks the location.
                const handle = await picker({
                    suggestedName: filename,
                    types: [{ description: 'DSH workflow', accept: { 'application/json': ['.json'] } }],
                });
                const writable = await handle.createWritable();
                await writable.write(json);
                await writable.close();
                return;
            }
            catch (err) {
                if (err?.name === 'AbortError')
                    return;
            }
        }
        // Fallback: download to the user's default location.
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    };
    const onExport = () => {
        void saveWorkflow();
    };
    const onImportFile = (file) => {
        if (!file || running)
            return;
        if (file.size > 4 * 1024 * 1024) {
            alert('工作流文件不能超过 4 MiB');
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const doc = JSON.parse(String(reader.result));
                useCanvasStore.getState().importDocument(doc);
            }
            catch (err) {
                alert('导入失败：' + (err instanceof Error ? err.message : String(err)));
            }
        };
        reader.readAsText(file);
    };
    return (_jsxs("div", { className: "wf-toolbar", children: [_jsxs("div", { className: "wf-toolbar__brand", children: [_jsx("span", { className: "wf-toolbar__mode", children: "\u8282\u70B9\u6A21\u5F0F" }), _jsx("span", { className: "wf-toolbar__divider", "aria-hidden": "true" }), _jsx("input", { ref: nameRef, className: "wf-name", value: workflowName, onChange: (e) => setWorkflowName(e.target.value), "aria-label": "Workflow name" }), _jsx("button", { className: "wf-name__edit", onClick: () => nameRef.current?.focus(), title: "\u91CD\u547D\u540D\u5DE5\u4F5C\u6D41", "aria-label": "\u91CD\u547D\u540D\u5DE5\u4F5C\u6D41", children: _jsx("svg", { viewBox: "0 0 24 24", width: "14", height: "14", fill: "currentColor", "aria-hidden": "true", children: _jsx("path", { d: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" }) }) })] }), _jsxs("div", { className: "wf-toolbar__actions", children: [_jsxs("div", { className: "wf-toolbar__utilities", children: [_jsx("button", { className: "wf-help-btn", onClick: () => setShowHelp(true), title: "\u4F7F\u7528\u6587\u6863", "aria-label": "\u4F7F\u7528\u6587\u6863", children: _jsxs("svg", { viewBox: "0 0 24 24", width: "18", height: "18", fill: "none", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", children: [_jsx("path", { d: "M6 2.5h9L19.5 7v14.5H6z" }), _jsx("path", { d: "M15 2.5V7h4.5" }), _jsx("path", { d: "M9.2 11h6" }), _jsx("path", { d: "M9.2 13.4h4.6" }), _jsx("path", { d: "M9.2 15.8h6" }), _jsx("path", { d: "M9.2 18.2h4.6" })] }) }), _jsx("span", { className: "wf-save", children: "\u4E3B\u9898\u8DDF\u968F DSH" }), _jsxs("label", { className: "wf-btn", children: ["\u5BFC\u5165", _jsx("input", { type: "file", accept: "application/json,.json", style: { display: 'none' }, onChange: (e) => {
                                            onImportFile(e.target.files?.[0]);
                                            e.target.value = '';
                                        } })] }), _jsx("button", { className: "wf-btn", onClick: onExport, children: "\u5BFC\u51FA" }), _jsx("button", { className: "wf-btn", onClick: () => setShowBoard(true), children: "\u5B9A\u65F6\u4EFB\u52A1" })] }), _jsxs("div", { className: "wf-toolbar__primary-actions", children: [_jsx("span", { className: "wf-run-status", role: "status", "aria-live": "polite", children: runStatus }), _jsx("button", { className: "wf-btn wf-btn--primary", disabled: running, onClick: () => void onRun(), children: running ? '运行中…' : '▶ 运行' }), running && _jsx("button", { className: "wf-btn wf-btn--danger", onClick: () => abortRef.current?.abort(), children: "\u505C\u6B62" }), onExitNodeMode && (_jsx("button", { className: "wf-btn wf-btn--exit", onClick: onExitNodeMode, children: "\u9000\u51FA\u8282\u70B9\u6A21\u5F0F" }))] })] }), showBoard && _jsx(ScheduleBoard, { onClose: () => setShowBoard(false) }), showHelp && _jsx(HelpDoc, { onClose: () => setShowHelp(false) })] }));
}
