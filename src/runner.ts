import type { WorkflowDocument, WorkflowNode } from './model.js'

export type RunUpdate = { input?: string; value?: string; logs?: string[]; running?: boolean; error?: string; duration?: number; at: string }
export type RunDependencies = {
  signal: AbortSignal
  runAgent: (node: WorkflowNode, input: string, delta: (text: string) => void, signal: AbortSignal) => Promise<string>
  runCode: (node: WorkflowNode, input: string, signal: AbortSignal) => Promise<{ value: string; logs: string[] }>
  update: (id: string, patch: RunUpdate) => void
  edge: (id: string) => void
}
const SIMPLE = new Set(['trigger', 'agent', 'code', 'output', 'note'])
const MAX_TEXT = 2 * 1024 * 1024
export function supportsDag(doc: WorkflowDocument): boolean { return doc.nodes.every(n => SIMPLE.has(n.data.kind)) }
export function triggerInput(node: WorkflowNode): string {
  return [node.data.text ?? '', ...(node.data.attachments ?? []).map(a => `--- ${a.name} ---\n${a.text}`)].filter(Boolean).join('\n\n')
}
export function renderResult(template: string | undefined, input: string): string {
  return (template?.trim() ? template : '{{result}}').replace(/\{\{\s*result\s*\}\}/g, () => input)
}
function check(signal: AbortSignal): void { if (signal.aborted) throw new Error('运行已停止') }
function bounded(text: string): string { if (new TextEncoder().encode(text).byteLength > MAX_TEXT) throw new Error('节点 UTF-8 文本超过 2 MiB 限制'); return text }

/** Single producer, single consumer per edge. Fail instead of unbounded buffering. */
class Channel {
  private queue: string[] = []
  private wake?: () => void
  private closed = false
  private failure?: unknown
  push(value: string): void {
    if (this.closed) return
    if (this.queue.length >= 32) throw new Error('增量队列已满（32 段）；请减少输出段数或使用完整交接')
    this.queue.push(bounded(value)); this.wake?.(); this.wake = undefined
  }
  close(error?: unknown): void { this.closed = true; this.failure = error; this.wake?.(); this.wake = undefined }
  async *read(): AsyncGenerator<string> {
    while (true) {
      if (this.failure) throw this.failure
      if (this.queue.length) { yield this.queue.shift()!; continue }
      if (this.closed) return
      await new Promise<void>(resolve => { this.wake = resolve })
    }
  }
}
class Gate {
  private active = 0
  private waiting: Array<() => void> = []
  async with<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
    if (this.active >= 2) await new Promise<void>((resolve, reject) => {
      const ready = () => { signal.removeEventListener('abort', cancel); resolve() }
      const cancel = () => {
        const index = this.waiting.indexOf(ready)
        if (index >= 0) this.waiting.splice(index, 1)
        signal.removeEventListener('abort', cancel)
        reject(new Error('运行已停止'))
      }
      this.waiting.push(ready)
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted) cancel()
    })
    else this.active++
    try { check(signal); return await action() } finally {
      const next = this.waiting.shift()
      if (next) next()
      else this.active--
    }
  }
}
/** Only blank-line-delimited paragraphs are committed; no half-token handoff. */
export class Paragraphs {
  private pending = ''
  constructor(private emit: (paragraph: string) => void) {}
  add(text: string): void {
    this.pending += text
    let match: RegExpExecArray | null
    while ((match = /\r?\n[\t ]*\r?\n/.exec(this.pending))) {
      const part = this.pending.slice(0, match.index).trim()
      this.pending = this.pending.slice(match.index + match[0].length)
      if (part) this.commit(part)
    }
    this.checkSize(this.pending)
  }
  private checkSize(text: string): void {
    if (new TextEncoder().encode(text).byteLength > 65536) throw new Error('单段 UTF-8 超过 64 KiB；请使用完整交接或让 Agent 分段输出')
  }
  private commit(part: string): void { this.checkSize(part); this.emit(part) }
  finish(): void { const part = this.pending.trim(); this.pending = ''; if (part) this.commit(part) }
}

/** DAG runner with real fan-out, full-input joins and bounded incremental edges. */
export async function runDagWorkflow(doc: WorkflowDocument, deps: RunDependencies): Promise<void> {
  if (!supportsDag(doc)) throw new Error('增量运行仅支持输入、Agent、代码和输出节点；控制节点请使用完整交接')
  const nodes = doc.nodes.filter(n => n.data.kind !== 'note')
  if (!nodes.length || nodes.length > 64 || doc.edges.length > 128) throw new Error('工作流需要 1–64 个执行节点，最多 128 条连线')
  const byId = new Map(nodes.map(n => [n.id, n]))
  if (byId.size !== nodes.length) throw new Error('节点 ID 重复')
  const edges = doc.edges.filter(e => byId.has(e.source) && byId.has(e.target))
  if (edges.length !== doc.edges.length) throw new Error('连线包含不存在或备注节点')
  if (new Set(edges.map(e => e.id)).size !== edges.length) throw new Error('连线 ID 重复')
  const incoming = (id: string) => edges.filter(e => e.target === id)
  const outgoing = (id: string) => edges.filter(e => e.source === id)
  const incremental = (id: string) => byId.get(id)?.data.kind === 'agent' && byId.get(id)?.data.handoff === 'paragraph'
  // Validate before side effects, including disconnected cycles.
  const seen = new Set<string>(), visiting = new Set<string>()
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error('普通工作流不能包含环；请改用 Loop/While 完整交接')
    if (seen.has(id)) return
    visiting.add(id); for (const e of outgoing(id)) visit(e.target); visiting.delete(id); seen.add(id)
  }
  for (const n of nodes) {
    visit(n.id)
    const parents = incoming(n.id)
    if (parents.some(e => incremental(e.source)) && parents.length !== 1) throw new Error('逐段输入暂不支持多路汇合；请先使用完整交接汇合')
    if (n.data.kind === 'trigger' && parents.length) throw new Error('输入节点不能有上游')
    if (incremental(n.id) && n.data.engine !== 'codex') throw new Error('逐段输出目前只支持 Codex 引擎')
  }
  const abort = new AbortController()
  const channels = new Map(edges.map(e => [e.id, new Channel()]))
  const onAbort = () => {
    abort.abort(deps.signal.reason)
    for (const channel of channels.values()) channel.close(new Error('运行已停止'))
  }
  deps.signal.addEventListener('abort', onAbort, { once: true })
  if (deps.signal.aborted) onAbort()
  const gate = new Gate()
  let calls = 0
  const tasks: Promise<void>[] = []
  try {
    for (const node of nodes) tasks.push((async () => {
      const started = Date.now(), values: string[] = [], logs: string[] = []
      let received = ''
      const update = (patch: Partial<RunUpdate>) => deps.update(node.id, { input: received, value: values.join('\n\n'), logs: [...logs], running: true, at: new Date().toLocaleTimeString(), duration: Date.now() - started, ...patch })
      const publish = (value: string) => { for (const e of outgoing(node.id)) { check(abort.signal); deps.edge(e.id); channels.get(e.id)!.push(value) } }
      const evaluate = async (input: string): Promise<void> => {
        check(abort.signal); received = bounded(input); update({})
        let value = input
        try {
          if (node.data.kind === 'trigger') value = triggerInput(node)
          else if (node.data.kind === 'output') value = renderResult(node.data.template, input)
          else if (node.data.kind === 'code') {
            const result = await gate.with(abort.signal, () => deps.runCode(node, input, abort.signal))
            value = result.value; logs.push(...result.logs)
          } else if (node.data.kind === 'agent') {
            if (++calls > 32) throw new Error('单次工作流最多调用 32 次 Agent；请减少逐段交接')
            let live = ''
            const paragraphs = incremental(node.id) ? new Paragraphs(publish) : undefined
            value = await gate.with(abort.signal, () => deps.runAgent(node, input, delta => {
              check(abort.signal); live = bounded(live + delta)
              update({ value: bounded([...values, live].join('\n\n')) })
              paragraphs?.add(delta)
            }, abort.signal))
            if (paragraphs) { if (!live && value) paragraphs.add(value); paragraphs.finish() }
          }
          bounded(value); values.push(value); bounded(values.join('\n\n')); update({})
        } catch (error) {
          if (!abort.signal.aborted && node.data.onError === 'continue') {
            logs.push(`失败后继续（已交付段不会回滚）：${String(error)}`)
            values.push(''); if (incremental(node.id)) publish('')
            update({}); return
          }
          throw error
        }
      }
      try {
        const parents = incoming(node.id)
        if (parents.length === 1 && incremental(parents[0].source)) {
          for await (const value of channels.get(parents[0].id)!.read()) await evaluate(value)
        } else if (parents.length) {
          const inputs = await Promise.all(parents.map(async e => {
            const all: string[] = []
            for await (const value of channels.get(e.id)!.read()) all.push(value)
            return all.join('\n\n')
          }))
          await evaluate(inputs.join('\n\n'))
        } else await evaluate('')
        const value = bounded(values.join('\n\n'))
        if (!incremental(node.id)) publish(value)
        update({ running: false })
        for (const e of outgoing(node.id)) channels.get(e.id)!.close()
      } catch (error) {
        update({ running: false, error: error instanceof Error ? error.message : String(error) })
        abort.abort(error)
        for (const channel of channels.values()) channel.close(error)
        throw error
      }
    })())
    const result = await Promise.allSettled(tasks)
    const failed = result.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (failed) throw failed.reason
    check(abort.signal)
  } finally { deps.signal.removeEventListener('abort', onAbort) }
}
