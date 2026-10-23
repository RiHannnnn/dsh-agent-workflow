import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
const require = createRequire(import.meta.url)

test('built client uses native slots, shared React and side-effect-free lazy registration', () => {
  let loaded
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  runInNewContext(source, { window: { __ModuleLoader__: { load: module => { loaded = module } } }, console, TextEncoder, TextDecoder, setTimeout, clearTimeout })
  assert.equal(loaded.id, 'dsh-node-flow')
  const plugin = loaded.factory(name => {
    assert.ok(['react', 'react-dom', 'react/jsx-runtime'].includes(name), `unexpected external dependency: ${name}`)
    return require(name)
  })
  const registrations = [], disposers = [], panels = []
  plugin.apply({
    effect: callback => { disposers.push(callback()) },
    slots: { inject: (_name, callback) => { disposers.push(callback()) }, register: (options, component) => { const item = { options, component }; registrations.push(item); return () => registrations.splice(registrations.indexOf(item), 1) } },
    locale: { register: () => () => {}, bind: () => () => 'Agent 工作流' },
    layout: { selectPanel: panel => panels.push(panel) },
  })
  assert.equal(registrations.length, 2)
  const main = registrations.find(item => item.options.name === 'main')
  assert.equal(main.options.key, 'dsh-node-flow')
  assert.equal(registrations.find(item => item.options.name === 'sidebar.panellist').options.label(), 'Agent 工作流')
  const html = renderToStaticMarkup(React.createElement(main.component))
  assert.match(html, /wf-shell/)
  assert.match(html, /wf-toolbar/)
  assert.doesNotMatch(html, /<iframe/)
  for (const dispose of disposers.reverse()) dispose()
  assert.equal(registrations.length, 0)
})
