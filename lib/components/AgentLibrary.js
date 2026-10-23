import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { fetchAgentLibrary } from '../agent-library-client.js';
import { localizeRole, roleMatches } from '../agent-locale.js';
import { useCanvasStore } from '../store/canvas.js';
/** Local Codex roles. Drag metadata augments the existing React Flow kind MIME. */
export function AgentLibrary() {
    const [query, setQuery] = useState('');
    const [library, setLibrary] = useState(null);
    const [error, setError] = useState('');
    const [refresh, setRefresh] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        setError('');
        void fetchAgentLibrary({ signal: controller.signal }).then(setLibrary).catch((err) => {
            if (!controller.signal.aborted)
                setError(err instanceof Error ? err.message : '加载角色库失败');
        });
        return () => controller.abort();
    }, [refresh]);
    const agents = (library?.agents ?? []).filter((agent) => roleMatches(agent, query));
    return (_jsxs("section", { className: "wf-palette__group", "aria-label": "DSH \u89D2\u8272\u5E93", children: [_jsx("div", { className: "wf-palette__group-title", children: "Codex \u89D2\u8272\u5E93" }), _jsxs("label", { className: "wf-field", children: [_jsx("span", { children: "\u641C\u7D22\u89D2\u8272" }), _jsx("input", { type: "search", placeholder: "\u540D\u79F0 / \u63CF\u8FF0", value: query, onChange: (event) => setQuery(event.target.value) })] }), _jsx("button", { type: "button", className: "wf-btn", onClick: () => setRefresh((value) => value + 1), children: "\u5237\u65B0\u89D2\u8272\u5E93" }), error && _jsx("p", { role: "alert", children: error }), !library && !error && _jsx("p", { role: "status", children: "\u52A0\u8F7D\u672C\u5730\u89D2\u8272\u2026" }), library && (!library.ok || library.available === false) && _jsx("p", { role: "status", children: "DSH \u89D2\u8272\u5E93\u6682\u4E0D\u53EF\u7528\uFF1B\u8BF7\u5237\u65B0\u91CD\u8BD5\u3002" }), library?.warnings?.map((warning, i) => _jsx("p", { role: "status", children: warning }, i)), library?.ok && agents.map((agent) => {
                const zh = localizeRole(agent);
                return (_jsxs("button", { type: "button", className: "wf-palette__item", style: { width: '100%', color: 'inherit', background: 'transparent', fontFamily: 'inherit' }, title: `${zh.description || agent.id}\n\n英文原名：${agent.name}\n${agent.description}`, draggable: true, onDragStart: (event) => {
                        event.dataTransfer.setData('application/reactflow', 'agent');
                        event.dataTransfer.setData('application/dsh-agent-role', JSON.stringify({ id: agent.id, name: zh.name, engine: 'dsh' }));
                        event.dataTransfer.effectAllowed = 'move';
                    }, onClick: () => {
                        const store = useCanvasStore.getState();
                        const id = store.addNodeAt('agent', zh.name, { x: 160 + Math.random() * 240, y: 120 + Math.random() * 240 });
                        store.updateNodeData(id, { engine: 'dsh', roleId: agent.id, handoff: 'complete', timeout: '120' });
                    }, children: [_jsx("span", { className: "wf-palette__icon", style: { background: '#a78bfa' }, children: "\uD83E\uDD16" }), _jsxs("span", { className: "wf-palette__label", style: { whiteSpace: 'normal', textAlign: 'left' }, children: [zh.name, _jsx("small", { style: { display: 'block', opacity: 0.7 }, children: zh.description || agent.id }), zh.localized && _jsxs("small", { style: { display: 'block', opacity: 0.45 }, children: ["DSH \u00B7 ", agent.name] })] })] }, agent.id));
            }), library?.ok && agents.length === 0 && _jsx("p", { children: "\u6CA1\u6709\u5339\u914D\u7684\u89D2\u8272\u3002" })] }));
}
