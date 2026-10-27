import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { createRequire } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// Compile only the pure inspection view-model in memory: no backend build,
// emitted artifacts, fetches, host workflow calls or paid Agent executions.
const source = await readFile(new URL('../src/components/execution-inspection.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
const inspection = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const { inspectionStatus, inspectionText, inspectionPreview } = inspection
const outcome = (patch = {}) => ({ at: '12:34:56', logs: [], ...patch })

test('inspection distinguishes absent, running, failed and completed node records', () => {
  assert.equal(inspectionStatus(), 'unrecorded')
  assert.equal(inspectionStatus(outcome({ running: true })), 'running')
  assert.equal(inspectionStatus(outcome({ error: 'Host stopped' })), 'error')
  assert.equal(inspectionStatus(outcome({ error: '' })), 'error')
  assert.equal(inspectionStatus(outcome({ value: 'real result' })), 'completed')
})

test('input/output preserve falsy and structured recorded values without fabricating metrics', () => {
  assert.equal(inspectionText(undefined, 'output'), undefined)
  assert.equal(inspectionText(outcome(), 'output'), undefined)
  assert.equal(inspectionText(outcome({ input: '' }), 'input'), '')
  assert.equal(inspectionText(outcome({ value: '' }), 'output'), '')
  assert.equal(inspectionText(outcome({ value: false }), 'output'), 'false')
  assert.equal(inspectionText(outcome({ value: 0 }), 'output'), '0')
  assert.equal(inspectionText(outcome({ value: null }), 'output'), 'null')
  assert.equal(inspectionText(outcome({ value: { ok: true } }), 'output'), '{\n  "ok": true\n}')
})

test('logs and errors use only the actual outcome and retain order', () => {
  assert.equal(inspectionText(outcome(), 'logs'), undefined)
  assert.equal(inspectionText(outcome({ logs: ['one', 'two'] }), 'logs'), 'one\ntwo')
  assert.equal(inspectionText(outcome({ error: 'denied' }), 'error'), 'denied')
  assert.equal(inspectionText(outcome(), 'error'), undefined)
})

test('non-serializable output degrades safely and long previews are explicitly truncated', () => {
  const value = {}; value.self = value
  assert.equal(inspectionText(outcome({ value }), 'output'), '[无法序列化的输出]')
  const original = 'x'.repeat(64001)
  assert.deepEqual(inspectionPreview(original), { text: 'x'.repeat(64000), truncated: true })
  assert.deepEqual(inspectionPreview(''), { text: '', truncated: false })
  assert.equal(original.length, 64001)
})

test('execution panel renders real data and keyboard tab semantics without invoking actions', async () => {
  const text = await readFile(new URL('../src/components/ExecutionPanel.tsx', import.meta.url), 'utf8')
  const js = ts.transpileModule(text, {
    fileName: 'ExecutionPanel.tsx',
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const require = createRequire(import.meta.url)
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', js)((name) => name === './execution-inspection.js' ? inspection : require(name), mod, mod.exports)
  const unexpected = () => assert.fail('inspection must not invoke actions while rendering')
  const props = { selectedId: 'node-1', running: true, expanded: true, onSelect: unexpected, onExpand: unexpected, onClose: unexpected }
  const render = (lastRun) => renderToStaticMarkup(createElement(mod.exports.ExecutionPanel, {
    ...props, nodes: [{ id: 'node-1', data: { kind: 'agent', label: 'Research agent', lastRun } }],
  }))
  const recorded = render(outcome({ value: '<actual output>', duration: 120 }))
  assert.match(recorded, /&lt;actual output&gt;/)
  assert.match(recorded, /120 ms/)
  assert.match(recorded, /role="tablist"/)
  assert.match(recorded, /role="tabpanel"/)
  assert.match(recorded, /aria-selected="true"/)
  assert.match(recorded, /不是持久历史/)
  assert.match(render(undefined), /尚无执行记录/)
  assert.match(render(outcome({ running: true })), /此项数据尚未记录/)
})

test('workbench TSX passes focused syntax diagnostics without compiling the changing backend', async () => {
  for (const name of ['Canvas.tsx', 'ExecutionPanel.tsx']) {
    const text = await readFile(new URL(`../src/components/${name}`, import.meta.url), 'utf8')
    const result = ts.transpileModule(text, {
      fileName: name, reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
    })
    assert.deepEqual(result.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error), [], name)
  }
})
