import type { CodeRunOutcome } from '../model.js'

export type InspectionTab = 'input' | 'output' | 'error' | 'logs'
export type InspectionStatus = 'unrecorded' | 'running' | 'error' | 'completed'

/** Only recorded node outcomes establish a state; workflow activity is not node success. */
export function inspectionStatus(run?: CodeRunOutcome): InspectionStatus {
  if (!run) return 'unrecorded'
  if (run.running) return 'running'
  if (run.error !== undefined) return 'error'
  return 'completed'
}

export function inspectionText(run: CodeRunOutcome | undefined, tab: InspectionTab): string | undefined {
  if (!run) return undefined
  if (tab === 'input') return run.input
  if (tab === 'error') return run.error
  if (tab === 'logs') return run.logs.length ? run.logs.join('\n') : undefined
  if (run.value === undefined) return undefined
  if (typeof run.value === 'string') return run.value
  try { return JSON.stringify(run.value, null, 2) ?? String(run.value) }
  catch { return '[无法序列化的输出]' }
}

/** Bound rendering work without modifying the source outcome or inventing data. */
export function inspectionPreview(text: string, limit = 64_000): { text: string; truncated: boolean } {
  return { text: text.slice(0, limit), truncated: text.length > limit }
}
