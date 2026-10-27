import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Main canvas — React Flow wrapper wiring the store to the renderer.
 *
 * @module components/Canvas
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, MiniMap, BackgroundVariant } from '@xyflow/react';
import { useCanvasStore } from '../store/canvas.js';
import { WorkflowNodeView } from '../nodes/WorkflowNodeView.js';
import { Toolbar } from './Toolbar.js';
import { Inspector } from './Inspector.js';
import { NodePalette } from './NodePalette.js';
import { ExecutionPanel } from './ExecutionPanel.js';
const nodeTypes = { workflow: WorkflowNodeView };
const DEFAULT_LABELS = {
    trigger: '触发器',
    schedule: '定时触发',
    agent: 'Agent',
    code: '代码执行',
    output: '输出',
    if: 'If',
    switch: 'Switch',
    loop: 'Loop',
    while: 'While',
    note: '备注',
};
export function Canvas({ onExitNodeMode } = {}) {
    const nodes = useCanvasStore((s) => s.nodes);
    const edges = useCanvasStore((s) => s.edges);
    const activeEdgeIds = useCanvasStore((s) => s.activeEdgeIds);
    const onNodesChange = useCanvasStore((s) => s.onNodesChange);
    const onEdgesChange = useCanvasStore((s) => s.onEdgesChange);
    const onConnect = useCanvasStore((s) => s.onConnect);
    const select = useCanvasStore((s) => s.select);
    const selectEdge = useCanvasStore((s) => s.selectEdge);
    const addNodeAt = useCanvasStore((s) => s.addNodeAt);
    const selectedId = useCanvasStore((s) => s.selectedId);
    const running = useCanvasStore((s) => s.isRunning);
    const [paletteOpen, setPaletteOpen] = useState(true);
    const [mode, setMode] = useState('editor');
    const [inspectionOpen, setInspectionOpen] = useState(false);
    const rfRef = useRef(null);
    useEffect(() => { if (running)
        setInspectionOpen(true); }, [running]);
    const renderedEdges = useMemo(() => {
        const activeIds = new Set(activeEdgeIds);
        return edges.map((edge) => {
            const classes = (edge.className ?? '')
                .split(/\s+/)
                .filter((className) => className && className !== 'wf-edge--active');
            if (activeIds.has(edge.id))
                classes.push('wf-edge--active');
            return { ...edge, className: classes.join(' ') || undefined };
        });
    }, [activeEdgeIds, edges]);
    // Delete / Backspace removes the selected edge, else the selected node.
    // Guarded so it never fires while typing in an input/textarea/select or a contenteditable.
    useEffect(() => {
        const onKeyDown = (e) => {
            if (mode !== 'editor' || running || (e.key !== 'Delete' && e.key !== 'Backspace'))
                return;
            const t = e.target;
            if (t?.closest('.wf-execution'))
                return;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
                return;
            }
            const store = useCanvasStore.getState();
            if (store.selectedEdgeId) {
                e.preventDefault();
                store.removeEdge(store.selectedEdgeId);
            }
            else if (store.selectedId) {
                e.preventDefault();
                store.removeNode(store.selectedId);
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [mode, running]);
    const onDragOver = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };
    const onDrop = (e) => {
        e.preventDefault();
        if (mode !== 'editor' || running)
            return;
        const kind = e.dataTransfer.getData('application/reactflow');
        if (!Object.hasOwn(DEFAULT_LABELS, kind) || !rfRef.current)
            return;
        const pos = rfRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY });
        const roleData = e.dataTransfer.getData('application/dsh-agent-role');
        if (kind === 'agent' && roleData) {
            try {
                const role = JSON.parse(roleData);
                if (typeof role.id !== 'string' || !role.id || role.id.length > 128 || /[\\/\u0000-\u001f\u007f]/.test(role.id) || role.id === '.' || role.id === '..' || typeof role.name !== 'string')
                    return;
                const id = addNodeAt(kind, role.name.slice(0, 200), pos);
                useCanvasStore.getState().updateNodeData(id, { engine: 'dsh', roleId: role.id, handoff: 'complete', timeout: '120' });
            }
            catch { /* Ignore malformed drops, never execute dropped content. */ }
        }
        else
            addNodeAt(kind, DEFAULT_LABELS[kind] ?? kind, pos);
    };
    return (_jsxs("div", { className: `wf-shell wf-workbench wf-workbench--${mode}`, children: [_jsx(Toolbar, { onExitNodeMode: onExitNodeMode }), _jsxs("div", { className: "wf-workbench__bar", children: [_jsxs("nav", { className: "wf-workbench__modes", "aria-label": "\u5DE5\u4F5C\u53F0\u89C6\u56FE", children: [_jsx("button", { type: "button", "aria-pressed": mode === 'editor', onClick: () => setMode('editor'), children: "\u7F16\u8F91\u5668" }), _jsx("button", { type: "button", "aria-pressed": mode === 'executions', onClick: () => { setMode('executions'); setInspectionOpen(true); }, children: "\u6267\u884C\u68C0\u67E5" })] }), _jsx("span", { className: "wf-workbench__scope", children: "DSH \u539F\u751F\u6267\u884C \u00B7 \u9636\u6BB5\u4E00" }), _jsxs("span", { className: "wf-workbench__counts", children: [nodes.length, " \u8282\u70B9 \u00B7 ", edges.length, " \u8FDE\u63A5"] }), _jsx("button", { type: "button", className: "wf-workbench__toggle", "aria-expanded": paletteOpen, "aria-controls": "wf-workbench-palette", disabled: mode !== 'editor' || running, onClick: () => setPaletteOpen((open) => !open), children: "\u8282\u70B9 / Agent" }), _jsx("button", { type: "button", className: "wf-workbench__toggle", "aria-expanded": inspectionOpen, "aria-controls": "wf-workbench-inspection", onClick: () => { if (mode === 'executions')
                            setMode('editor'); setInspectionOpen((open) => !open); }, children: "\u6267\u884C\u6570\u636E" })] }), _jsxs("div", { className: "wf-main", children: [paletteOpen && mode === 'editor' && !running && _jsx("aside", { id: "wf-workbench-palette", className: "wf-workbench__palette", "aria-label": "\u8282\u70B9\u548C Agent \u5E93", children: _jsx(NodePalette, {}) }), _jsxs("div", { className: "wf-workbench__center", children: [_jsxs("div", { className: "wf-canvas", children: [_jsxs(ReactFlow, { nodes: nodes, edges: renderedEdges, nodeTypes: nodeTypes, onNodesChange: onNodesChange, onEdgesChange: onEdgesChange, onConnect: onConnect, onSelectionChange: ({ nodes: selNodes, edges: selEdges }) => {
                                            if (selNodes.length > 0) {
                                                select(selNodes[0].id);
                                            }
                                            else if (selEdges.length > 0) {
                                                selectEdge(selEdges[0].id);
                                            }
                                            else {
                                                select(null);
                                            }
                                        }, onPaneClick: () => select(null), onDragOver: onDragOver, onDrop: onDrop, onInit: (inst) => {
                                            rfRef.current = inst;
                                        }, fitView: true, nodesDraggable: mode === 'editor' && !running, nodesConnectable: mode === 'editor' && !running, edgesReconnectable: mode === 'editor' && !running, proOptions: { hideAttribution: true }, deleteKeyCode: null, children: [_jsx(Background, { variant: BackgroundVariant.Dots, gap: 18, size: 1 }), _jsx(Controls, {}), _jsx(MiniMap, { nodeColor: (n) => {
                                                    const kinds = {
                                                        trigger: '#10b981', schedule: '#fb923c', agent: '#8b5cf6',
                                                        if: '#fbbf24', switch: '#f472b6', code: '#14b8a6', output: '#ef4444',
                                                    };
                                                    return kinds[n.data?.kind ?? ''] ?? '#94a3b8';
                                                } })] }), nodes.length === 1 && edges.length === 0 && mode === 'editor' && _jsx("div", { className: "wf-workbench__hint", children: "\u4ECE\u8282\u70B9\u5E93\u6DFB\u52A0\u8282\u70B9\uFF0C\u8FDE\u63A5\u7AEF\u53E3\u6784\u5EFA\u5DE5\u4F5C\u6D41\u3002\u4EC5\u70B9\u51FB\u300C\u8FD0\u884C\u300D\u540E\u624D\u4F1A\u6267\u884C\u3002" })] }), inspectionOpen && _jsx("div", { id: "wf-workbench-inspection", className: "wf-workbench__inspection", children: _jsx(ExecutionPanel, { nodes: nodes, selectedId: selectedId, running: running, expanded: mode === 'executions', onSelect: select, onExpand: () => setMode((current) => current === 'editor' ? 'executions' : 'editor'), onClose: () => { setInspectionOpen(false); setMode('editor'); } }) })] }), selectedId && mode === 'editor' && !running && _jsx(Inspector, {})] })] }));
}
