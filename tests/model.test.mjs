import test from 'node:test'
import assert from 'node:assert/strict'
import {
  attachmentBytes, MAX_ATTACHMENT_BYTES, createNode, exportWorkflowDocument,
  validateWorkflowDocument, toStepList, isAbsoluteWorkingDirectory,
  buildWeatherExample, buildNewsExample, buildBasicIfExample, buildQaIfExample,
  buildDailySwitchExample, buildLoopExample, buildWhileExample,
} from '../lib/model.js'

function document() {
  const trigger = createNode('trigger', '输入', { x: 0, y: 0 })
  trigger.data.text = '请总结附件'
  trigger.data.attachments = [{ name: '数据.json', text: '{"城市":"上海"}' }, { name: '说明.md', text: '# 说明\n完整文本' }]
  const agent = createNode('agent', '总结角色', { x: 200, y: 0 })
  Object.assign(agent.data, { engine: 'codex', roleId: 'writer', cwd: '/work/project', codexModel: '', handoff: 'paragraph', onError: 'continue' })
  return { version: 1, name: '测试', nodes: [trigger, agent], edges: [{ id: 'edge', source: trigger.id, target: agent.id }] }
}

test('Codex configuration and embedded attachments round trip without losing role fields', () => {
  const doc = document()
  doc.extension = { version: 2, enabled: true }
  doc.nodes[1].data.extension = { harmless: ['forward compatible'] }
  const exported = exportWorkflowDocument(doc)
  const imported = validateWorkflowDocument(JSON.parse(JSON.stringify(exported)))
  assert.deepEqual(imported, doc)
  assert.notEqual(imported.nodes, doc.nodes)
  assert.notEqual(imported.nodes[0].data.attachments, doc.nodes[0].data.attachments)
  const steps = toStepList(imported)
  assert.deepEqual(steps[0].attachments, doc.nodes[0].data.attachments)
  for (const key of ['engine', 'roleId', 'cwd', 'codexModel', 'handoff', 'onError', 'timeout']) assert.equal(steps[1][key], doc.nodes[1].data[key])
})

test('export removes all lastRun data and leaves in-memory live output untouched', () => {
  const doc = document()
  const lastRun = { input: 'sensitive input', logs: ['sensitive log'], value: 'streaming output', at: 'now', running: true }
  for (const node of doc.nodes) node.data.lastRun = lastRun
  const exported = exportWorkflowDocument(doc)
  assert.ok(exported.nodes.every((node) => !('lastRun' in node.data)))
  assert.equal(doc.nodes[0].data.lastRun, lastRun)
  assert.doesNotMatch(JSON.stringify(exported), /sensitive|streaming output/)
  assert.ok(validateWorkflowDocument(doc).nodes.every((node) => !('lastRun' in node.data)))
})

test('existing examples remain valid with DSH engine implicit', () => {
  for (const build of [buildWeatherExample, buildNewsExample, buildBasicIfExample, buildQaIfExample, buildDailySwitchExample, buildLoopExample, buildWhileExample]) {
    const doc = build()
    assert.equal(validateWorkflowDocument(doc).nodes.length, doc.nodes.length)
  }
})

test('attachment limit uses UTF-8 bytes across the entire document', () => {
  assert.equal(attachmentBytes([{ name: '中文.txt', text: '中' }]), 3)
  const doc = document()
  doc.nodes[0].data.attachments = [{ name: 'exact.txt', text: 'x'.repeat(MAX_ATTACHMENT_BYTES) }]
  assert.doesNotThrow(() => validateWorkflowDocument(doc))
  doc.nodes[1].data.attachments = [{ name: 'extra.txt', text: '中' }]
  assert.throws(() => validateWorkflowDocument(doc), /1 MiB/)
})

test('reject malformed basic documents, nodes, edges and typed data fields', () => {
  const cases = [
    (d) => { d.version = 2 }, (d) => { d.name = 4 }, (d) => { d.nodes = {} }, (d) => { d.edges = null },
    (d) => { d.nodes[0] = null }, (d) => { d.nodes[0].id = '' }, (d) => { d.nodes[1].id = d.nodes[0].id },
    (d) => { d.nodes[0].position.x = '0' }, (d) => { d.nodes[0].position.y = Infinity },
    (d) => { d.nodes[0].type = 'unknown' }, (d) => { d.nodes[0].data.kind = 'data' },
    (d) => { delete d.nodes[0].data.kind }, (d) => { d.nodes[0].data.label = [] },
    (d) => { d.nodes[1].data.engine = 'shell' }, (d) => { d.nodes[1].data.handoff = 'shared-session' },
    (d) => { d.nodes[1].data.roleId = '../secret' }, (d) => { d.nodes[1].data.cwd = '~/secret' },
    (d) => { d.nodes[1].data.codexModel = {} }, (d) => { d.nodes[1].data.timeout = 120 },
    (d) => { d.nodes[1].data.prompt = {} }, (d) => { d.nodes[1].data.collect = 'true' },
    (d) => { d.nodes[0].data.attachments = [{ name: 'x' }] },
    (d) => { d.nodes[0].data.attachments = [{ name: 'x', text: 5 }] },
    (d) => { d.nodes[0].data.attachments = [{ name: 'x', text: 'binary\0data' }] },
    (d) => { d.nodes[1].data.lastRun = { at: 'now', logs: [false] } },
    (d) => { d.edges[0].target = 'missing' }, (d) => { d.edges[0].sourceHandle = {} },
    (d) => { d.edges.push({ ...d.edges[0] }) }, (d) => { d.edges[0].data = { label: {} } },
    (d) => { d.extension = () => 'code' }, (d) => { d.extension = new Date() },
    (d) => { d.extension = JSON.parse('{"__proto__":{"polluted":true}}') },
    (d) => { d.nodes[0].selected = 'yes' }, (d) => { d.nodes[0].style = [] },
  ]
  for (const mutate of cases) {
    const doc = document()
    mutate(doc)
    assert.throws(() => validateWorkflowDocument(doc), /无效工作流字段/, mutate.toString())
  }
  assert.equal({}.polluted, undefined)
})

test('store import is atomic, clears stale selection and run logs; export is detached', async () => {
  const { useCanvasStore } = await import('../lib/store/canvas.js')
  const doc = document()
  const store = useCanvasStore.getState()
  store.importDocument(doc)
  const imported = useCanvasStore.getState()
  const before = imported.nodes
  assert.throws(() => imported.importDocument({ ...doc, edges: [{ id: 'bad', source: 'missing', target: 'missing' }] }))
  assert.equal(useCanvasStore.getState().nodes, before)
  imported.select(before[0].id)
  imported.updateNodeData(before[0].id, { lastRun: { logs: ['secret'], value: 'secret', at: 'now' } })
  const exported = useCanvasStore.getState().exportDocument()
  assert.ok(!('lastRun' in exported.nodes[0].data))
  exported.nodes[0].data.text = 'changed export'
  assert.notEqual(useCanvasStore.getState().nodes[0].data.text, 'changed export')
  useCanvasStore.getState().importDocument(doc)
  assert.equal(useCanvasStore.getState().selectedId, null)
})

test('absolute working directory recognises Unix and Windows without hardcoded defaults', () => {
  for (const value of ['/work/project', 'C:\\work\\project', 'D:/project', '\\\\server\\share']) assert.equal(isAbsoluteWorkingDirectory(value), true, value)
  for (const value of ['', '~', './relative', 'C:relative', '/work\0secret', '/work\nsecret']) assert.equal(isAbsoluteWorkingDirectory(value), false, value)
})
