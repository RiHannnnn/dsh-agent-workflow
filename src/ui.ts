/** Native DSH main-panel contribution; never mutates the host DOM. */
import React from 'react'
import { Overlay } from './components/Overlay.js'
import rfCss from '@xyflow/react/dist/style.css'
import canvasCss from './components/canvas.css'

export const name = 'dsh-node-flow-ui'
export const inject = ['slots', 'layout', 'locale'] as const
const PANEL_ID = 'dsh-node-flow'
const NS = 'dshNodeFlow'
interface ClientContext {
  effect: (factory: () => (() => void)) => unknown
  slots: {
    inject: (name: string, factory: () => (() => void)) => unknown
    register: (options: Record<string, unknown>, component: React.ComponentType) => (() => void)
  }
  layout: { selectPanel: (id: string | null) => void }
  locale: { register: (namespace: string, dictionaries: Record<string, unknown>) => (() => void); bind: (namespace: string) => (key: string) => string }
}
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh: { panel: 'Agent 工作流' }, en: { panel: 'Agent workflows' } }))
  const t = ctx.locale.bind(NS)
  function WorkflowPanel() {
    return React.createElement(React.Fragment, null,
      React.createElement('style', { 'data-dsh-node-flow-styles': true }, `${rfCss}\n${canvasCss}`),
      React.createElement(Overlay, { onClose: () => ctx.layout.selectPanel(null) }),
    )
  }
  function WorkflowIcon() {
    return React.createElement('svg', { viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true },
      React.createElement('rect', { x: 2, y: 8, width: 6, height: 8, rx: 2 }),
      React.createElement('rect', { x: 16, y: 2, width: 6, height: 8, rx: 2 }),
      React.createElement('rect', { x: 16, y: 14, width: 6, height: 8, rx: 2 }),
      React.createElement('path', { d: 'M8 12h4V6h4M12 12v6h4' }))
  }
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, WorkflowPanel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 30, label: () => t('panel'), locale: NS }, WorkflowIcon))
}
