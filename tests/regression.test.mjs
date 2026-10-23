import test from 'node:test'
import assert from 'node:assert/strict'
import { runDagWorkflow, Paragraphs } from '../lib/runner.js'
import { validateWorkflowDocument } from '../lib/model.js'
import { executeAgent } from '../lib/client-execution.js'
const n = (id, extra = {}) => ({ id, type: 'workflow', position: { x: 0, y: 0 }, data: { kind: 'agent', label: id, ...extra } })
const doc = () => ({ version: 1, name: 'regression', nodes: [n('a'), n('b')], edges: [{ id: 'ab', source: 'a', target: 'b' }] })
const deps = extra => ({ signal: new AbortController().signal, update() {}, edge() {}, runCode: async (_node, input) => ({ value: input, logs: [] }), ...extra })

test('regression: failing paragraph node continues with one empty downstream input', async () => {
  const d = doc(); Object.assign(d.nodes[0].data, { engine: 'codex', handoff: 'paragraph', onError: 'continue' })
  const inputs = []
  await runDagWorkflow(d, deps({ runAgent: async (node, input) => { if (node.id === 'a') throw new Error('expected'); inputs.push(input); return 'done' } }))
  assert.deepEqual(inputs, [''])
})
test('regression: paragraph size check applies before emitting complete paragraphs and uses UTF-8', () => {
  const values = [], p = new Paragraphs(value => values.push(value))
  assert.throws(() => p.add('x'.repeat(65537) + '\n\n'), /64 KiB/)
  assert.deepEqual(values, [])
  assert.throws(() => new Paragraphs(() => {}).add('中'.repeat(21846)), /64 KiB/)
})
test('regression: imported render props cannot be arbitrary React objects or DOM injection hooks', () => {
  for (const mutate of [d => { d.edges[0].label = { bad: true } }, d => { d.edges[0].style = 'bad' }, d => { d.edges[0].labelStyle = { color: {} } }]) {
    const d = doc(); mutate(d); assert.throws(() => validateWorkflowDocument(d))
  }
  const d = doc(); d.edges[0].domAttributes = { dangerouslySetInnerHTML: { __html: '<b>unsafe</b>' } }; d.nodes[0].domAttributes = { hidden: true }
  const valid = validateWorkflowDocument(d)
  assert.ok(!('domAttributes' in valid.nodes[0]))
  assert.ok(!('domAttributes' in valid.edges[0]))
})
test('regression: store rejects replacing a running graph and preserves the snapshot', async () => {
  const { useCanvasStore } = await import('../lib/store/canvas.js')
  const store = useCanvasStore.getState(); store.importDocument(doc())
  const before = useCanvasStore.getState().nodes
  store.setRunning(true)
  try { assert.throws(() => store.importDocument(doc()), /运行中/); assert.equal(useCanvasStore.getState().nodes, before) }
  finally { store.setRunning(false) }
})
test('regression: cancellation aborts pending capability fetch and queued node execution', async () => {
  const original = globalThis.fetch, controller = new AbortController(); let requests = 0
  globalThis.fetch = (_url, options) => new Promise((_, reject) => {
    requests++; assert.ok(options.signal)
    options.signal.addEventListener('abort', () => reject(new Error('aborted capability')), { once: true })
    if (requests === 2) queueMicrotask(() => controller.abort())
  })
  try {
    const d = { version: 1, name: 'cancel', nodes: ['a', 'b', 'c'].map(id => n(id, { engine: 'codex', cwd: '/tmp', prompt: 'test' })), edges: [] }
    await assert.rejects(runDagWorkflow(d, deps({ signal: controller.signal, runAgent: executeAgent })))
    assert.equal(requests, 2)
  } finally { globalThis.fetch = original }
})
