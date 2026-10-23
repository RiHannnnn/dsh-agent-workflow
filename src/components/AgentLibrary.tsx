import { useEffect, useState } from 'react'
import { fetchAgentLibrary, type AgentLibraryResult } from '../agent-library-client.js'
import { localizeRole, roleMatches } from '../agent-locale.js'
import { useCanvasStore } from '../store/canvas.js'

/** Local Codex roles. Drag metadata augments the existing React Flow kind MIME. */
export function AgentLibrary() {
  const [query, setQuery] = useState('')
  const [library, setLibrary] = useState<AgentLibraryResult | null>(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    void fetchAgentLibrary({ signal: controller.signal }).then(setLibrary).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '加载角色库失败')
    })
    return () => controller.abort()
  }, [refresh])
  const agents = (library?.agents ?? []).filter((agent) => roleMatches(agent, query))

  return (
    <section className="wf-palette__group" aria-label="DSH 角色库">
      <div className="wf-palette__group-title">Codex 角色库</div>
      <label className="wf-field">
        <span>搜索角色</span>
        <input type="search" placeholder="名称 / 描述" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <button type="button" className="wf-btn" onClick={() => setRefresh((value) => value + 1)}>刷新角色库</button>
      {error && <p role="alert">{error}</p>}
      {!library && !error && <p role="status">加载本地角色…</p>}
      {library && (!library.ok || library.available === false) && <p role="status">DSH 角色库暂不可用；请刷新重试。</p>}
      {library?.warnings?.map((warning, i) => <p key={i} role="status">{warning}</p>)}
      {library?.ok && agents.map((agent) => {
        const zh = localizeRole(agent)
        return (
        <button
          key={agent.id}
          type="button"
          className="wf-palette__item"
          style={{ width: '100%', color: 'inherit', background: 'transparent', fontFamily: 'inherit' }}
          title={`${zh.description || agent.id}\n\n英文原名：${agent.name}\n${agent.description}`}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData('application/reactflow', 'agent')
            event.dataTransfer.setData('application/dsh-agent-role', JSON.stringify({ id: agent.id, name: zh.name, engine: 'dsh' }))
            event.dataTransfer.effectAllowed = 'move'
          }}
          onClick={() => {
            const store = useCanvasStore.getState()
            const id = store.addNodeAt('agent', zh.name, { x: 160 + Math.random() * 240, y: 120 + Math.random() * 240 })
            store.updateNodeData(id, { engine: 'dsh', roleId: agent.id, handoff: 'complete', timeout: '120' })
          }}
        >
          <span className="wf-palette__icon" style={{ background: '#a78bfa' }}>🤖</span>
          <span className="wf-palette__label" style={{ whiteSpace: 'normal', textAlign: 'left' }}>
            {zh.name}
            <small style={{ display: 'block', opacity: 0.7 }}>{zh.description || agent.id}</small>
            {zh.localized && <small style={{ display: 'block', opacity: 0.45 }}>DSH · {agent.name}</small>}
          </span>
        </button>
        )
      })}
      {library?.ok && agents.length === 0 && <p>没有匹配的角色。</p>}
    </section>
  )
}
