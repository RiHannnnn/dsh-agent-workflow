import { useId, useState } from 'react'
import type { WorkflowNode } from '../model.js'
import { inspectionPreview, inspectionStatus, inspectionText, type InspectionTab } from './execution-inspection.js'

const STATUS_LABELS = { unrecorded: '未记录', running: '运行中', error: '失败', completed: '已完成' }
const TABS: Array<{ id: InspectionTab; label: string }> = [
  { id: 'input', label: '输入' }, { id: 'output', label: '输出' },
  { id: 'error', label: '错误' }, { id: 'logs', label: '日志' },
]

export function ExecutionPanel({ nodes, selectedId, running, expanded, onSelect, onExpand, onClose }: {
  nodes: WorkflowNode[]
  selectedId: string | null
  running: boolean
  expanded: boolean
  onSelect: (id: string) => void
  onExpand: () => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<InspectionTab>('output')
  const id = useId()
  const selected = nodes.find((node) => node.id === selectedId)
  const run = selected?.data.lastRun
  const recorded = nodes.filter((node) => node.data.lastRun)
  const failures = recorded.filter((node) => inspectionStatus(node.data.lastRun) === 'error').length
  const text = inspectionText(run, tab)
  const preview = text === undefined ? undefined : inspectionPreview(text)

  return (
    <section className="wf-execution" aria-label="当前执行检查">
      <header className="wf-execution__header">
        <div className="wf-execution__heading">
          <strong>执行检查</strong>
          <span className={`wf-workbench__status${running ? ' wf-workbench__status--running' : ''}`} role="status">
            {running ? '工作流运行中' : '工作流空闲'}
          </span>
          <span className="wf-execution__summary">{recorded.length}/{nodes.length} 节点有记录{failures > 0 ? ` · ${failures} 失败` : ''}</span>
        </div>
        <div className="wf-execution__actions">
          <button type="button" onClick={onExpand} aria-label={expanded ? '返回编辑器并保留执行检查' : '展开执行检查'}>{expanded ? '返回编辑器' : '展开'}</button>
          <button type="button" onClick={onClose} aria-label="关闭执行检查">关闭</button>
        </div>
      </header>
      <p className="wf-execution__notice">仅展示画布各节点最近一次 lastRun，不是持久历史；重新运行会覆盖，循环仅保留最后一次结果。</p>
      <div className="wf-execution__body">
        <nav className="wf-execution__nodes" aria-label="选择检查节点">
          {nodes.length === 0 && <p className="wf-execution__empty">画布中还没有节点。</p>}
          {nodes.map((node) => {
            const status = inspectionStatus(node.data.lastRun)
            return (
              <button type="button" key={node.id} aria-pressed={selectedId === node.id} className="wf-execution__node" onClick={() => onSelect(node.id)}>
                <span className={`wf-execution__dot wf-execution__dot--${status}`} aria-hidden="true" />
                <span className="wf-execution__node-label">{node.data.label}<small>{node.data.kind}</small></span>
                <span className="wf-execution__node-status">{STATUS_LABELS[status]}</span>
              </button>
            )
          })}
        </nav>
        <div className="wf-execution__detail">
          <div className="wf-execution__meta">
            <strong>{selected ? selected.data.label : '选择一个节点'}</strong>
            {selected && <span>{STATUS_LABELS[inspectionStatus(run)]}</span>}
            {run?.at && <span title="记录时间">{run.at}</span>}
            {run?.duration !== undefined && Number.isFinite(run.duration) && <span>{run.duration} ms</span>}
          </div>
          <div className="wf-execution__tabs" role="tablist" aria-label="节点执行数据">
            {TABS.map((item, index) => (
              <button type="button" key={item.id} role="tab" id={`${id}-${item.id}`} aria-controls={`${id}-content`} aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} onClick={() => setTab(item.id)} onKeyDown={(event) => {
                const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : undefined
                if (next === undefined) return
                event.preventDefault()
                setTab(TABS[next].id)
                document.getElementById(`${id}-${TABS[next].id}`)?.focus()
              }}>{item.label}{item.id === 'logs' && run ? ` (${run.logs.length})` : ''}</button>
            ))}
          </div>
          <div className="wf-execution__content" role="tabpanel" id={`${id}-content`} aria-labelledby={`${id}-${tab}`} tabIndex={0}>
            {preview ? <><pre>{preview.text === '' ? '（空字符串）' : preview.text}</pre>{preview.truncated && <p className="wf-execution__notice">内容过长，仅显示前 64,000 个字符；原始节点数据未更改。</p>}</> : <p className="wf-execution__empty">{!selected ? '从左侧列表或画布选择节点，查看真实执行数据。' : !run ? '此节点尚无执行记录。可通过顶部运行按钮主动执行工作流。' : run.running ? '节点正在运行，此项数据尚未记录。' : `本次记录没有${TABS.find((item) => item.id === tab)?.label}数据。`}</p>}
          </div>
        </div>
      </div>
    </section>
  )
}
