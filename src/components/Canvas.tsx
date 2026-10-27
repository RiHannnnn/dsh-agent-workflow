/**
 * Main canvas — React Flow wrapper wiring the store to the renderer.
 *
 * @module components/Canvas
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlow, Background, Controls, MiniMap, BackgroundVariant } from '@xyflow/react'
import { useCanvasStore } from '../store/canvas.js'
import type { WorkflowNodeType } from '../model.js'
import { WorkflowNodeView } from '../nodes/WorkflowNodeView.js'
import { Toolbar } from './Toolbar.js'
import { Inspector } from './Inspector.js'
import { NodePalette } from './NodePalette.js'
import { ExecutionPanel } from './ExecutionPanel.js'

const nodeTypes = { workflow: WorkflowNodeView }

const DEFAULT_LABELS: Record<string, string> = {
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
}

type RFInstance = { screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number } }

export function Canvas({ onExitNodeMode }: { onExitNodeMode?: () => void } = {}) {
  const nodes = useCanvasStore((s) => s.nodes)
  const edges = useCanvasStore((s) => s.edges)
  const activeEdgeIds = useCanvasStore((s) => s.activeEdgeIds)
  const onNodesChange = useCanvasStore((s) => s.onNodesChange)
  const onEdgesChange = useCanvasStore((s) => s.onEdgesChange)
  const onConnect = useCanvasStore((s) => s.onConnect)
  const select = useCanvasStore((s) => s.select)
  const selectEdge = useCanvasStore((s) => s.selectEdge)
  const addNodeAt = useCanvasStore((s) => s.addNodeAt)
  const selectedId = useCanvasStore((s) => s.selectedId)
  const running = useCanvasStore((s) => s.isRunning)
  const [paletteOpen, setPaletteOpen] = useState(true)
  const [mode, setMode] = useState<'editor' | 'executions'>('editor')
  const [inspectionOpen, setInspectionOpen] = useState(false)
  const rfRef = useRef<RFInstance | null>(null)
  useEffect(() => { if (running) setInspectionOpen(true) }, [running])
  const renderedEdges = useMemo(() => {
    const activeIds = new Set(activeEdgeIds)
    return edges.map((edge) => {
      const classes = (edge.className ?? '')
        .split(/\s+/)
        .filter((className) => className && className !== 'wf-edge--active')
      if (activeIds.has(edge.id)) classes.push('wf-edge--active')
      return { ...edge, className: classes.join(' ') || undefined }
    })
  }, [activeEdgeIds, edges])

  // Delete / Backspace removes the selected edge, else the selected node.
  // Guarded so it never fires while typing in an input/textarea/select or a contenteditable.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (mode !== 'editor' || running || (e.key !== 'Delete' && e.key !== 'Backspace')) return
      const t = e.target as HTMLElement | null
      if (t?.closest('.wf-execution')) return
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
        return
      }
      const store = useCanvasStore.getState()
      if (store.selectedEdgeId) {
        e.preventDefault()
        store.removeEdge(store.selectedEdgeId)
      } else if (store.selectedId) {
        e.preventDefault()
        store.removeNode(store.selectedId)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [mode, running])

  const onDragOver = (e: React.DragEvent): void => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    if (mode !== 'editor' || running) return
    const kind = e.dataTransfer.getData('application/reactflow') as WorkflowNodeType
    if (!Object.hasOwn(DEFAULT_LABELS, kind) || !rfRef.current) return
    const pos = rfRef.current.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    const roleData = e.dataTransfer.getData('application/dsh-agent-role')
    if (kind === 'agent' && roleData) {
      try {
        const role = JSON.parse(roleData) as { id?: string; name?: string }
        if (typeof role.id !== 'string' || !role.id || role.id.length > 128 || /[\\/\u0000-\u001f\u007f]/.test(role.id) || role.id === '.' || role.id === '..' || typeof role.name !== 'string') return
        const id = addNodeAt(kind, role.name.slice(0, 200), pos)
        useCanvasStore.getState().updateNodeData(id, { engine: 'dsh', roleId: role.id, handoff: 'complete', timeout: '120' })
      } catch { /* Ignore malformed drops, never execute dropped content. */ }
    } else addNodeAt(kind, DEFAULT_LABELS[kind] ?? kind, pos)
  }

  return (
    <div className={`wf-shell wf-workbench wf-workbench--${mode}`}>
      <Toolbar onExitNodeMode={onExitNodeMode} />
      <div className="wf-workbench__bar">
        <nav className="wf-workbench__modes" aria-label="工作台视图">
          <button type="button" aria-pressed={mode === 'editor'} onClick={() => setMode('editor')}>编辑器</button>
          <button type="button" aria-pressed={mode === 'executions'} onClick={() => { setMode('executions'); setInspectionOpen(true) }}>执行检查</button>
        </nav>
        <span className="wf-workbench__scope">DSH 原生执行 · 阶段一</span>
        <span className="wf-workbench__counts">{nodes.length} 节点 · {edges.length} 连接</span>
        <button type="button" className="wf-workbench__toggle" aria-expanded={paletteOpen} aria-controls="wf-workbench-palette" disabled={mode !== 'editor' || running} onClick={() => setPaletteOpen((open) => !open)}>节点 / Agent</button>
        <button type="button" className="wf-workbench__toggle" aria-expanded={inspectionOpen} aria-controls="wf-workbench-inspection" onClick={() => { if (mode === 'executions') setMode('editor'); setInspectionOpen((open) => !open) }}>执行数据</button>
      </div>
      <div className="wf-main">
        {paletteOpen && mode === 'editor' && !running && <aside id="wf-workbench-palette" className="wf-workbench__palette" aria-label="节点和 Agent 库"><NodePalette /></aside>}
        <div className="wf-workbench__center">
        <div className="wf-canvas">
          <ReactFlow
            nodes={nodes}
            edges={renderedEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={({ nodes: selNodes, edges: selEdges }) => {
              if (selNodes.length > 0) {
                select(selNodes[0].id)
              } else if (selEdges.length > 0) {
                selectEdge(selEdges[0].id)
              } else {
                select(null)
              }
            }}
            onPaneClick={() => select(null)}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onInit={(inst) => {
              rfRef.current = inst as unknown as RFInstance
            }}
            fitView
            nodesDraggable={mode === 'editor' && !running}
            nodesConnectable={mode === 'editor' && !running}
            edgesReconnectable={mode === 'editor' && !running}
            proOptions={{ hideAttribution: true }}
            deleteKeyCode={null}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
            <Controls />
            <MiniMap
              nodeColor={(n) => {
                const kinds: Record<string, string> = {
                  trigger: '#10b981', schedule: '#fb923c', agent: '#8b5cf6',
                  if: '#fbbf24', switch: '#f472b6', code: '#14b8a6', output: '#ef4444',
                }
                return kinds[(n.data as { kind?: string })?.kind ?? ''] ?? '#94a3b8'
              }}
            />
          </ReactFlow>
          {nodes.length === 1 && edges.length === 0 && mode === 'editor' && <div className="wf-workbench__hint">从节点库添加节点，连接端口构建工作流。仅点击「运行」后才会执行。</div>}
        </div>
        {inspectionOpen && <div id="wf-workbench-inspection" className="wf-workbench__inspection">
          <ExecutionPanel nodes={nodes} selectedId={selectedId} running={running} expanded={mode === 'executions'} onSelect={select} onExpand={() => setMode((current) => current === 'editor' ? 'executions' : 'editor')} onClose={() => { setInspectionOpen(false); setMode('editor') }} />
        </div>}
        </div>
        {selectedId && mode === 'editor' && !running && <Inspector />}
      </div>
    </div>
  )
}
