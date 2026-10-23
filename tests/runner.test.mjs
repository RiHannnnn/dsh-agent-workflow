import test from 'node:test'
import assert from 'node:assert/strict'
import { runDagWorkflow, Paragraphs, triggerInput } from '../lib/runner.js'
const node = (id, kind, extra = {}) => ({ id, type: 'workflow', position: { x: 0, y: 0 }, data: { kind, label: id, ...extra } })
const edge = (source, target) => ({ id: `${source}-${target}`, source, target })
const doc = (nodes, edges) => ({ version: 1, name: 'test', nodes, edges })
function deps(extra = {}) { return { signal: new AbortController().signal, update() {}, edge() {}, runAgent: async (_n, input) => input, runCode: async (_n, input) => ({ value: input, logs: [] }), ...extra } }

test('full DAG joins both branches and evaluates a merge once', async () => {
  const values = new Map(), calls = []
  await runDagWorkflow(doc([node('start', 'trigger', { text: 'hello' }), node('a', 'agent'), node('b', 'agent'), node('merge', 'agent'), node('out', 'output')], [edge('start', 'a'), edge('start', 'b'), edge('a', 'merge'), edge('b', 'merge'), edge('merge', 'out')]), deps({
    runAgent: async (n, input) => { calls.push(n.id); return n.id === 'merge' ? input : `${n.id}:${input}` },
    update: (id, data) => values.set(id, data),
  }))
  assert.equal(calls.filter(id => id === 'merge').length, 1)
  assert.equal(values.get('out').value, 'a:hello\n\nb:hello')
})
test('downstream begins on paragraph before upstream finishes', async () => {
  let release, upstreamDone = false, early = false
  const downstreamStarted = new Promise(resolve => { release = resolve })
  const inputs = []
  await runDagWorkflow(doc([node('a', 'agent', { engine: 'codex', handoff: 'paragraph' }), node('b', 'agent'), node('out', 'output')], [edge('a', 'b'), edge('b', 'out')]), deps({ runAgent: async (n, input, delta) => {
    if (n.id === 'a') { delta('第一段\n\n'); await downstreamStarted; delta('第二段'); upstreamDone = true; return '第一段\n\n第二段' }
    inputs.push(input); if (!upstreamDone) early = true; release(); return `处理:${input}`
  } }))
  assert.equal(early, true)
  assert.deepEqual(inputs, ['第一段', '第二段'])
})
test('reject cycles and incremental joins before running anything', async () => {
  let called = false
  const dependencies = deps({ runAgent: async () => { called = true; return '' } })
  await assert.rejects(runDagWorkflow(doc([node('a', 'agent'), node('b', 'agent')], [edge('a', 'b'), edge('b', 'a')]), dependencies), /不能包含环/)
  await assert.rejects(runDagWorkflow(doc([node('a', 'agent', { engine: 'codex', handoff: 'paragraph' }), node('b', 'agent'), node('c', 'agent')], [edge('a', 'c'), edge('b', 'c')]), dependencies), /逐段输入暂不支持多路汇合/)
  assert.equal(called, false)
})
test('paragraph splitter keeps chunk boundaries and Chinese content', () => {
  const parts = [], splitter = new Paragraphs(value => parts.push(value))
  splitter.add('甲\r'); splitter.add('\n\r\n乙'); splitter.add('\n\n丙'); splitter.finish()
  assert.deepEqual(parts, ['甲', '乙', '丙'])
})
test('attachments flow as data without altering role configuration', () => {
  assert.equal(triggerInput(node('s', 'trigger', { text: '总结', attachments: [{ name: 'a.md', text: '数据' }] })), '总结\n\n--- a.md ---\n数据')
})
test('cancellation drains queued permits and rejects instead of hanging', async () => {
  const abort = new AbortController(); let started = 0
  const run = runDagWorkflow(doc(Array.from({ length: 8 }, (_, i) => node(String(i), 'agent')), []), deps({ signal: abort.signal, runAgent: async (_n, _input, _delta, signal) => {
    started++
    if (started === 2) queueMicrotask(() => abort.abort())
    await new Promise((_, reject) => { if (signal.aborted) reject(new Error('stopped')); else signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }) })
    return ''
  } }))
  await assert.rejects(run)
  assert.equal(started, 2)
})
test('onError continue yields an empty value to downstream', async () => {
  let value
  await runDagWorkflow(doc([node('a', 'agent', { onError: 'continue' }), node('out', 'output')], [edge('a', 'out')]), deps({ runAgent: async () => { throw new Error('expected failure') }, update: (id, data) => { if (id === 'out') value = data.value } }))
  assert.equal(value, '')
})
