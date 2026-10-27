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

import { useEffect, useRef, useState } from 'react'
import { useCanvasStore } from '../store/canvas.js'
import type { WorkflowDocument, WorkflowNodeData } from '../model.js'
import { ScheduleBoard } from './ScheduleBoard.js'
import { HelpDoc } from './HelpDoc.js'
import { runDagWorkflow, supportsDag, triggerInput } from '../runner.js'
import { executeAgent, executeCode } from '../client-execution.js'
import { beginDshExecution, finishDshExecution, type DshExecution } from '../dsh-execution-client.js'


/** JSON response of the host run routes. */
type RunResponse = {
  ok?: boolean
  error?: string
  value?: unknown
  logs?: string[]
  output?: string
  failure?: { kind?: string; message?: string }
}

const now = (): string => new Date().toLocaleTimeString()

/** Substitute `{{key}}` placeholders in an output template. */
function renderTemplate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key: string) => {
    const v = vars[key]
    return v === undefined ? match : typeof v === 'object' ? JSON.stringify(v) : String(v)
  })
}

/** Evaluate an expression against a `result` variable (best-effort). */
function evalExpr(expr: string, vars: Record<string, unknown>): unknown {
  try {
    // eslint-disable-next-line no-new-func
    return new Function('result', `"use strict"; return (${expr});`)(vars.result)
  } catch {
    return undefined
  }
}

/** Evaluate a condition expression to a boolean against a `result` variable. */
function evalCondition(expr: string, vars: Record<string, unknown>): boolean {
  return Boolean(evalExpr(expr, vars))
}

/** Parse a route response as JSON, falling back to a readable text error. */
async function parseResponse(res: Response): Promise<RunResponse> {
  try {
    return (await res.json()) as RunResponse
  } catch {
    const text = await res.text().catch(() => '')
    return { ok: false, error: `HTTP ${res.status} - ${text.slice(0, 200)}` }
  }
}

export function Toolbar({ onExitNodeMode }: { onExitNodeMode?: () => void }) {
  const updateNodeData = useCanvasStore((s) => s.updateNodeData)
  const workflowName = useCanvasStore((s) => s.workflowName)
  const setWorkflowName = useCanvasStore((s) => s.setWorkflowName)
  const nameRef = useRef<HTMLInputElement>(null)
  const [showBoard, setShowBoard] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const running = useCanvasStore(s => s.isRunning)
  const setRunning = useCanvasStore(s => s.setRunning)
  const [runStatus, setRunStatus] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => () => abortRef.current?.abort(), [])

  const onRunLegacy = async (execution?: DshExecution) => {
    const signal = abortRef.current!.signal
    const store = useCanvasStore.getState()
    const nodes = store.nodes
    const edges = store.edges
    if (nodes.length === 0) {
      alert('工作流为空')
      return
    }
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const edgesFrom = (id: string): typeof edges => edges.filter((e) => e.source === id)

    // Reset every node to a neutral (gray) border first.
    store.clearActiveEdges()
    for (const n of nodes) updateNodeData(n.id, { lastRun: undefined })

    let startIds = nodes
      .filter((n) => n.data.kind === 'trigger' || n.data.kind === 'schedule')
      .map((n) => n.id)
    if (startIds.length === 0) startIds = nodes.map((n) => n.id)

    const visited = new Set<string>()
    let ran = false
    let budget = 0

    // Run a single loop/while body iteration by walking from `iterateId`. The
    // body walk terminates (returns) the moment control flows back to `loopId`
    // via the `back` edge, so each iteration is a self-contained sub-walk.
    const runLoopBody = async (iterateId: string, loopId: string, input: string): Promise<string> => {
      if (!iterateId) return input
      // Each iteration gets a FRESH clone of the outer visited (which does not
      // include body nodes), so body nodes re-run every time. The clone is what
      // executeNode mutates; the outer `visited` stays clean. executeNode's
      // `stopAt=loopId` ends the sub-walk the moment control flows back to the
      // loop node (the `back` edge), which is the iteration's terminal value.
      const bodyVisited = new Set(visited)
      return await executeNode(iterateId, input, bodyVisited, loopId)
    }

    // Execute ONE node. Returns the value flowing out of it. When `stopAt` is
    // supplied, reaching that id (the loop/while node) ends a body sub-walk.
    const executeNode = async (id: string, input: string, ctxVisited: Set<string>, stopAt?: string): Promise<string> => {
      if (signal.aborted) throw new Error('运行已停止')
      if (!byId.has(id)) return input
      if (id === stopAt) return input
      if (ctxVisited.has(id)) return input
      ctxVisited.add(id)
      ran = true
      budget += 1
      if (budget > 100_000) throw new Error('超过运行步数上限（可能死循环）')

      const n = byId.get(id)!
      const d = n.data
      const t0 = performance.now()
      const dur = (): number => Math.round(performance.now() - t0)
      const setVal = (patch: Record<string, unknown>): void =>
        updateNodeData(id, { lastRun: { input, logs: [], ...patch, at: now(), duration: dur() } })
      const fail = (err: unknown): void =>
        updateNodeData(id, { lastRun: { input, logs: [], error: err instanceof Error ? err.message : String(err), at: now(), duration: dur() } })

      // Non-branch fan-out: follow every outgoing edge; the value that flows
      // back to the loop boundary (stopAt) is what the last executed downstream
      // node produced, so loop/while see the branch's end value, not the first.
      const fanOut = async (value: string): Promise<string> => {
        let last = value
        for (const e of edgesFrom(id)) {
          store.markEdgeActive(e.id)
          last = await executeNode(e.target, value, ctxVisited, stopAt)
        }
        return last
      }

      try {
        if (d.kind === 'trigger' || d.kind === 'schedule') {
          const value = triggerInput(n)
          setVal({ value })
          return await fanOut(value)
        } else if (d.kind === 'code') {
          setVal({ running: true })
          const onError = d.onError === 'continue' ? 'continue' : 'stop'
          let nodeError: string | undefined
          let val = ''
          try {
            const res = await fetch('/dsh-node-flow/run', {
              signal,
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ program: d.code ?? '', language: d.language ?? 'typescript', input, timeout: parseInt(d.timeout ?? '', 10) || 0 }),
            })
            const data = await parseResponse(res)
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
            const value = data.value
            const logs = data.logs ?? []
            nodeError = data.failure?.message ?? data.error
            updateNodeData(id, { lastRun: { input, logs, value, error: nodeError, at: now(), duration: dur() } })
            val = value !== undefined ? (typeof value === 'object' ? JSON.stringify(value) : String(value)) : logs.join('\n')
          } catch (err) {
            nodeError = err instanceof Error ? err.message : String(err)
            fail(err)
          }
          if (nodeError) {
            if (onError === 'continue') return await fanOut('')
            return input
          }
          return await fanOut(val)
        } else if (d.kind === 'agent') {
          const received = input
          setVal({ running: true })
          const onError = d.onError === 'continue' ? 'continue' : 'stop'
          let nodeError: string | undefined
          let out = ''
          try {
            out = await executeAgent(n, received, () => {}, signal, execution)
            updateNodeData(id, { lastRun: { input: received, logs: [], value: out, error: nodeError, at: now(), duration: dur() } })
          } catch (err) {
            nodeError = err instanceof Error ? err.message : String(err)
            fail(err)
          }
          if (nodeError) {
            if (onError === 'continue') return await fanOut('')
            return received
          }
          return await fanOut(out)
        } else if (d.kind === 'output') {
          const template = (d.template ?? '').trim() ? d.template! : '{{result}}'
          const rendered = renderTemplate(template, { result: input })
          updateNodeData(id, { lastRun: { input, logs: [], value: rendered, at: now(), duration: dur() } })
          return await fanOut(rendered)
        } else if (d.kind === 'if') {
          const ok = evalCondition(d.condition ?? '', { result: input })
          updateNodeData(id, { lastRun: { input, logs: [], value: String(ok), at: now(), duration: dur() } })
          const want = ok ? 'true' : 'false'
          const edge = edgesFrom(id).find((e) => (e.sourceHandle ?? 'true') === want)
          if (edge) {
            store.markEdgeActive(edge.id)
            return await executeNode(edge.target, input, ctxVisited, stopAt)
          }
          return input
        } else if (d.kind === 'switch') {
          const val = evalExpr(d.condition ?? '', { result: input })
          updateNodeData(id, { lastRun: { input, logs: [], value: String(val), at: now(), duration: dur() } })
          const cases = (d.cases ?? '').split(',').map((s) => s.trim()).filter(Boolean)
          const sval = String(val)
          let edge = edgesFrom(id).find((e) => e.sourceHandle && cases.includes(e.sourceHandle) && e.sourceHandle === sval)
          if (!edge) edge = edgesFrom(id).find((e) => e.sourceHandle === 'default')
          if (edge) {
            store.markEdgeActive(edge.id)
            return await executeNode(edge.target, input, ctxVisited, stopAt)
          }
          return input
        } else if (d.kind === 'loop' || d.kind === 'while') {
          const value = await runLoopOrWhile(id, d, input)
          updateNodeData(id, { lastRun: { input, logs: [], value, at: now(), duration: dur() } })
          const doneEdge = edgesFrom(id).find((e) => e.sourceHandle === 'done' || (!e.sourceHandle && e.sourceHandle !== 'iterate'))
          if (doneEdge) {
            store.markEdgeActive(doneEdge.id)
            return await executeNode(doneEdge.target, value, ctxVisited, stopAt)
          }
          return value
        }
        return input
      } catch (err) {
        fail(err)
        return input
      }
    }

    // Evaluate the loop/while node itself: run its body across iterations, then
    // produce the `done` value (collected array or the last iteration result).
    const runLoopOrWhile = async (id: string, d: WorkflowNodeData, input: string): Promise<string> => {
      const loopId = id
      const iterateEdge = edgesFrom(id).find((e) => e.sourceHandle === 'iterate')
      const maxIters = parseInt(d.maxIters ?? '', 10) || 100
      const collect = Boolean(d.collect)
      const results: string[] = []
      let count = 0

      if (d.kind === 'loop') {
        let items: unknown[] = []
        if ((d.mode ?? 'items') === 'count') {
          const c = parseInt(d.count ?? '', 10) || 0
          items = Array.from({ length: c }, (_, i) => String(i + 1))
        } else {
          const arr = evalExpr(d.itemsExpr ?? '', { result: input })
          items = Array.isArray(arr) ? arr : []
        }
        for (const it of items) {
          if (count >= maxIters) break
          count += 1
          const item = typeof it === 'string' ? it : JSON.stringify(it)
          const r = await runLoopBody(iterateEdge?.target ?? '', loopId, item)
          if (collect) results.push(r)
        }
        return collect ? JSON.stringify(results) : String(results.length ? results[results.length - 1] : input)
      }

      // while: keep going while the condition (against the current value) is true.
      let cond = input
      while (true) {
        if (count >= maxIters) break
        const ok = evalCondition(d.condition ?? '', { result: cond })
        if (!ok) break
        count += 1
        const r = await runLoopBody(iterateEdge?.target ?? '', loopId, cond)
        cond = r
        if (collect) results.push(r)
      }
      return collect ? JSON.stringify(results) : String(cond)
    }

    for (const sid of startIds) {
      await executeNode(sid, '', visited)
    }
    if (!ran) alert('工作流没有可执行的节点。')
  }

  const onRun = async (): Promise<void> => {
    if (abortRef.current || useCanvasStore.getState().isRunning) return
    let doc: WorkflowDocument
    try { doc = useCanvasStore.getState().exportDocument() }
    catch (error) { setRunStatus(error instanceof Error ? error.message : String(error)); return }
    const native = doc.nodes.filter(n => n.data.kind === 'agent')
    const simple = supportsDag(doc)
    if (native.some(n => n.data.engine === 'codex')) { setRunStatus('旧 Codex 节点已停用，请在节点设置中改为 DSH 引擎并重新选择角色'); return }
    if (native.some(n => n.data.handoff === 'paragraph')) { setRunStatus('DSH 当前支持完整结果交接，逐段执行尚未实现'); return }
    const codeCount = doc.nodes.filter(n => n.data.kind === 'code').length
    const warnings = [
      native.length ? `将通过 DSH 运行 Agent，继承所选父会话的工作目录、模型和权限（不是只读沙箱）。每轮最多 4 次外层 Agent 调用、并发 2，10 分钟后取消。内容会发送给所选模型服务；这些限制不是金额或总 token 硬预算。` : '',
      codeCount ? `包含 ${codeCount} 个代码节点（可在宿主执行代码）。请确认你信任其代码和导入的工作流。` : '',
      !simple ? '包含表达式/控制节点，使用完整交接模式；请确认你信任表达式。' : '',
    ].filter(Boolean)
    if (warnings.length && !window.confirm(warnings.join('\n\n') + '\n\n确认运行？')) return
    const controller = new AbortController()
    abortRef.current = controller; setRunning(true); setRunStatus('准备执行：校验 DSH 父会话与本轮限制')
    const store = useCanvasStore.getState()
    store.clearActiveEdges()
    for (const node of doc.nodes) updateNodeData(node.id, { lastRun: undefined })
    let execution: DshExecution | undefined, status = ''
    try {
      if (native.length) {
        execution = await beginDshExecution(controller.signal, ids => {
          const answer = window.prompt(`选择此次执行的 DSH 父会话序号（不会猜测工作目录）：\n${ids.map((id, i) => `${i + 1}. ${id}`).join('\n')}`)
          if (answer === null) return undefined
          const index = Number(answer) - 1
          return Number.isInteger(index) && index >= 0 && index < ids.length ? ids[index] : undefined
        })
        if (native.length > execution.callsPerRun) throw new Error(`本轮最多 ${execution.callsPerRun} 个外层 Agent 调用；尚未启动任何节点`)
      }
      controller.signal.throwIfAborted()
      setRunStatus('运行中：DSH 完整结果交接；可在执行检查中查看节点数据')
      if (simple) await runDagWorkflow(doc, {
        signal: controller.signal, runAgent: (node, input, delta, signal) => executeAgent(node, input, delta, signal, execution), runCode: executeCode,
        update: (id, patch) => updateNodeData(id, { lastRun: { logs: [], ...patch } }),
        edge: store.markEdgeActive,
      })
      else await onRunLegacy(execution)
      status = controller.signal.aborted ? '停止请求已发送' : '执行结束；请查看各节点结果'
    } catch (error) {
      status = controller.signal.aborted ? '停止请求已发送' : `运行失败：${error instanceof Error ? error.message : String(error)}`
    } finally {
      if (execution) {
        try {
          const calls = await finishDshExecution(execution)
          status = `${controller.signal.aborted ? '已停止（后台清理已确认）' : status} · Agent 调用 ${calls}/${execution.callsPerRun}`
        } catch { status = '后台清理未确认，请勿重复运行；服务端仍持有执行与取消责任' }
      }
      setRunStatus(status); abortRef.current = null; setRunning(false)
    }
  }

  const saveWorkflow = async (): Promise<void> => {
    const doc = useCanvasStore.getState().exportDocument()
    const json = JSON.stringify(doc, null, 2)
    const filename = `${workflowName.replace(/\s+/g, '-').toLowerCase()}.workflow.json`
    const picker = (window as unknown as {
      showSaveFilePicker?: (opts: unknown) => Promise<{
        createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }>
      }>
    }).showSaveFilePicker

    if (picker) {
      try {
        // Always show a fresh "Save as" dialog so the user picks the location.
        const handle = await picker({
          suggestedName: filename,
          types: [{ description: 'DSH workflow', accept: { 'application/json': ['.json'] } }],
        })
        const writable = await handle.createWritable()
        await writable.write(json)
        await writable.close()
        return
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return
      }
    }

    // Fallback: download to the user's default location.
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const onExport = (): void => {
    void saveWorkflow()
  }

  const onImportFile = (file: File | undefined): void => {
    if (!file || running) return
    if (file.size > 4 * 1024 * 1024) { alert('工作流文件不能超过 4 MiB'); return }
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const doc = JSON.parse(String(reader.result)) as WorkflowDocument
        useCanvasStore.getState().importDocument(doc)
      } catch (err) {
        alert('导入失败：' + (err instanceof Error ? err.message : String(err)))
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className="wf-toolbar">
      <div className="wf-toolbar__brand">
        <span className="wf-toolbar__mode">节点模式</span>
        <span className="wf-toolbar__divider" aria-hidden="true" />
        <input
          ref={nameRef}
          className="wf-name"
          value={workflowName}
          onChange={(e) => setWorkflowName(e.target.value)}
          aria-label="Workflow name"
        />
        <button
          className="wf-name__edit"
          onClick={() => nameRef.current?.focus()}
          title="重命名工作流"
          aria-label="重命名工作流"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
            <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
          </svg>
        </button>
      </div>
      <div className="wf-toolbar__actions">
        <div className="wf-toolbar__utilities">
          <button
            className="wf-help-btn"
            onClick={() => setShowHelp(true)}
            title="使用文档"
            aria-label="使用文档"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 2.5h9L19.5 7v14.5H6z" />
              <path d="M15 2.5V7h4.5" />
              <path d="M9.2 11h6" />
              <path d="M9.2 13.4h4.6" />
              <path d="M9.2 15.8h6" />
              <path d="M9.2 18.2h4.6" />
            </svg>
          </button>
          <span className="wf-save">主题跟随 DSH</span>
          <label className="wf-btn">
            导入
            <input
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={(e) => {
                onImportFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </label>
          <button className="wf-btn" onClick={onExport}>
            导出
          </button>
          <button className="wf-btn" onClick={() => setShowBoard(true)}>
            定时任务
          </button>
        </div>
        <div className="wf-toolbar__primary-actions">
          <span className="wf-run-status" role="status" aria-live="polite">{runStatus}</span>
          <button className="wf-btn wf-btn--primary" disabled={running} onClick={() => void onRun()}>
            {running ? '运行中…' : '▶ 运行'}
          </button>
          {running && <button className="wf-btn wf-btn--danger" onClick={() => abortRef.current?.abort()}>停止</button>}
          {onExitNodeMode && (
            <button className="wf-btn wf-btn--exit" onClick={onExitNodeMode}>
              退出节点模式
            </button>
          )}
        </div>
      </div>
      {showBoard && <ScheduleBoard onClose={() => setShowBoard(false)} />}
      {showHelp && <HelpDoc onClose={() => setShowHelp(false)} />}
    </div>
  )
}
