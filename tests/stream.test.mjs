import test from 'node:test'
import assert from 'node:assert/strict'
import { readAgentStream } from '../lib/client-execution.js'
const signal = () => new AbortController().signal
function body(frames, cut = 7) {
  const bytes = new TextEncoder().encode(frames)
  return new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += cut) controller.enqueue(bytes.slice(i, i + cut)); controller.close() } })
}
test('NDJSON preserves split UTF-8 and requires done', async () => {
  const values = []
  const text = '{"type":"delta","text":"中文"}\n{"type":"done","output":"中文"}\n'
  assert.equal(await readAgentStream(body(text, 1), value => values.push(value), signal()), '中文')
  assert.deepEqual(values, ['中文'])
})
test('interrupted connection is not a successful partial result', async () => {
  await assert.rejects(readAgentStream(body('{"type":"delta","text":"partial"}\n'), () => {}, signal()), /完成前断开/)
})
test('error events and malformed frames reject', async () => {
  await assert.rejects(readAgentStream(body('{"type":"error","message":"bad"}\n'), () => {}, signal()), /bad/)
  await assert.rejects(readAgentStream(body('not json\n'), () => {}, signal()))
})
test('already aborted stream rejects', async () => {
  const abort = new AbortController(); abort.abort()
  await assert.rejects(readAgentStream(body('{"type":"done","output":""}\n'), () => {}, abort.signal), /停止/)
})
