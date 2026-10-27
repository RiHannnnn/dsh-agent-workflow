import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useId, useState } from 'react';
import { inspectionPreview, inspectionStatus, inspectionText } from './execution-inspection.js';
const STATUS_LABELS = { unrecorded: '未记录', running: '运行中', error: '失败', completed: '已完成' };
const TABS = [
    { id: 'input', label: '输入' }, { id: 'output', label: '输出' },
    { id: 'error', label: '错误' }, { id: 'logs', label: '日志' },
];
export function ExecutionPanel({ nodes, selectedId, running, expanded, onSelect, onExpand, onClose }) {
    const [tab, setTab] = useState('output');
    const id = useId();
    const selected = nodes.find((node) => node.id === selectedId);
    const run = selected?.data.lastRun;
    const recorded = nodes.filter((node) => node.data.lastRun);
    const failures = recorded.filter((node) => inspectionStatus(node.data.lastRun) === 'error').length;
    const text = inspectionText(run, tab);
    const preview = text === undefined ? undefined : inspectionPreview(text);
    return (_jsxs("section", { className: "wf-execution", "aria-label": "\u5F53\u524D\u6267\u884C\u68C0\u67E5", children: [_jsxs("header", { className: "wf-execution__header", children: [_jsxs("div", { className: "wf-execution__heading", children: [_jsx("strong", { children: "\u6267\u884C\u68C0\u67E5" }), _jsx("span", { className: `wf-workbench__status${running ? ' wf-workbench__status--running' : ''}`, role: "status", children: running ? '工作流运行中' : '工作流空闲' }), _jsxs("span", { className: "wf-execution__summary", children: [recorded.length, "/", nodes.length, " \u8282\u70B9\u6709\u8BB0\u5F55", failures > 0 ? ` · ${failures} 失败` : ''] })] }), _jsxs("div", { className: "wf-execution__actions", children: [_jsx("button", { type: "button", onClick: onExpand, "aria-label": expanded ? '返回编辑器并保留执行检查' : '展开执行检查', children: expanded ? '返回编辑器' : '展开' }), _jsx("button", { type: "button", onClick: onClose, "aria-label": "\u5173\u95ED\u6267\u884C\u68C0\u67E5", children: "\u5173\u95ED" })] })] }), _jsx("p", { className: "wf-execution__notice", children: "\u4EC5\u5C55\u793A\u753B\u5E03\u5404\u8282\u70B9\u6700\u8FD1\u4E00\u6B21 lastRun\uFF0C\u4E0D\u662F\u6301\u4E45\u5386\u53F2\uFF1B\u91CD\u65B0\u8FD0\u884C\u4F1A\u8986\u76D6\uFF0C\u5FAA\u73AF\u4EC5\u4FDD\u7559\u6700\u540E\u4E00\u6B21\u7ED3\u679C\u3002" }), _jsxs("div", { className: "wf-execution__body", children: [_jsxs("nav", { className: "wf-execution__nodes", "aria-label": "\u9009\u62E9\u68C0\u67E5\u8282\u70B9", children: [nodes.length === 0 && _jsx("p", { className: "wf-execution__empty", children: "\u753B\u5E03\u4E2D\u8FD8\u6CA1\u6709\u8282\u70B9\u3002" }), nodes.map((node) => {
                                const status = inspectionStatus(node.data.lastRun);
                                return (_jsxs("button", { type: "button", "aria-pressed": selectedId === node.id, className: "wf-execution__node", onClick: () => onSelect(node.id), children: [_jsx("span", { className: `wf-execution__dot wf-execution__dot--${status}`, "aria-hidden": "true" }), _jsxs("span", { className: "wf-execution__node-label", children: [node.data.label, _jsx("small", { children: node.data.kind })] }), _jsx("span", { className: "wf-execution__node-status", children: STATUS_LABELS[status] })] }, node.id));
                            })] }), _jsxs("div", { className: "wf-execution__detail", children: [_jsxs("div", { className: "wf-execution__meta", children: [_jsx("strong", { children: selected ? selected.data.label : '选择一个节点' }), selected && _jsx("span", { children: STATUS_LABELS[inspectionStatus(run)] }), run?.at && _jsx("span", { title: "\u8BB0\u5F55\u65F6\u95F4", children: run.at }), run?.duration !== undefined && Number.isFinite(run.duration) && _jsxs("span", { children: [run.duration, " ms"] })] }), _jsx("div", { className: "wf-execution__tabs", role: "tablist", "aria-label": "\u8282\u70B9\u6267\u884C\u6570\u636E", children: TABS.map((item, index) => (_jsxs("button", { type: "button", role: "tab", id: `${id}-${item.id}`, "aria-controls": `${id}-content`, "aria-selected": tab === item.id, tabIndex: tab === item.id ? 0 : -1, onClick: () => setTab(item.id), onKeyDown: (event) => {
                                        const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : undefined;
                                        if (next === undefined)
                                            return;
                                        event.preventDefault();
                                        setTab(TABS[next].id);
                                        document.getElementById(`${id}-${TABS[next].id}`)?.focus();
                                    }, children: [item.label, item.id === 'logs' && run ? ` (${run.logs.length})` : ''] }, item.id))) }), _jsx("div", { className: "wf-execution__content", role: "tabpanel", id: `${id}-content`, "aria-labelledby": `${id}-${tab}`, tabIndex: 0, children: preview ? _jsxs(_Fragment, { children: [_jsx("pre", { children: preview.text === '' ? '（空字符串）' : preview.text }), preview.truncated && _jsx("p", { className: "wf-execution__notice", children: "\u5185\u5BB9\u8FC7\u957F\uFF0C\u4EC5\u663E\u793A\u524D 64,000 \u4E2A\u5B57\u7B26\uFF1B\u539F\u59CB\u8282\u70B9\u6570\u636E\u672A\u66F4\u6539\u3002" })] }) : _jsx("p", { className: "wf-execution__empty", children: !selected ? '从左侧列表或画布选择节点，查看真实执行数据。' : !run ? '此节点尚无执行记录。可通过顶部运行按钮主动执行工作流。' : run.running ? '节点正在运行，此项数据尚未记录。' : `本次记录没有${TABS.find((item) => item.id === tab)?.label}数据。` }) })] })] })] }));
}
