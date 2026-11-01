import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateDrift, dateTimeInZone, deriveTimeline, formatClock, getCueWidths, getPerformanceNumbers,
  getSegmentStarts, isValidQueueDuration, parseDuration,
} from '../src/timeline.js'

const timestamp = milliseconds => ({ toMillis: () => milliseconds })

test('duration parsing and queue validation reject zero and overlong values', () => {
  assert.equal(parseDuration('03:00'), 180)
  assert.equal(parseDuration('01:02:03'), 3723)
  assert.equal(isValidQueueDuration('00:00'), false)
  assert.equal(isValidQueueDuration('03:00'), true)
  assert.equal(isValidQueueDuration('24:00:00'), true)
  assert.equal(isValidQueueDuration('24:00:01'), false)
  assert.equal(parseDuration('03:60'), null)
})

test('queue segment positions accumulate performances and transitions', () => {
  const starts = getSegmentStarts([
    { id: 'a', duration: '03:00' },
    { id: 'swap', type: 'scene-change', duration: '01:00' },
    { id: 'b', duration: '02:30' },
  ])
  assert.deepEqual(starts.map(({ start, end }) => [start, end]), [[0, 180], [180, 240], [240, 390]])
  assert.equal(formatClock(starts[2].start), '00:04:00')
})

test('paused timeline stays still even when its old anchor is in the past', () => {
  const event = { timeline: { status: 'paused', itemId: 'a', positionMs: 180_000, anchorAt: timestamp(0), commandRevision: 3 } }
  const result = deriveTimeline(event, [{ id: 'a', duration: '03:00' }, { id: 'b', duration: '03:00' }], 3_600_000)
  assert.equal(result.positionMs, 180_000)
  assert.equal(result.effectiveStatus, 'paused')
})

test('playing timeline advances from its anchor and clamps at the cue end', () => {
  const event = { timeline: { status: 'playing', itemId: 'a', positionMs: 0, anchorAt: timestamp(0), commandRevision: 1 } }
  const items = [{ id: 'a', duration: '03:00' }, { id: 'b', duration: '03:00' }]
  assert.equal(deriveTimeline(event, items, 179_000).positionMs, 179_000)
  const endedCue = deriveTimeline(event, items, 180_000)
  assert.equal(endedCue.positionMs, 180_000)
  assert.equal(endedCue.effectiveStatus, 'paused')
})

test('host schedule drift keeps moving with wall time while the timeline is paused', () => {
  const startAtMs = Date.UTC(2026, 10, 1, 16)
  const event = { startAt: timestamp(startAtMs) }
  const pausedTimeline = { positionMs: 6 * 60_000, firstStartedAt: timestamp(startAtMs + 2 * 60_000) }
  assert.equal(calculateDrift(event, pausedTimeline, startAtMs + 8 * 60_000), 2 * 60_000)
  assert.equal(calculateDrift(event, pausedTimeline, startAtMs + 8 * 60_000 + 30_000), 2 * 60_000 + 30_000)
})

test('event wall time always uses the Europe/Tallinn timezone', () => {
  assert.equal(dateTimeInZone('2026-01-15', '17:00')?.toISOString(), '2026-01-15T15:00:00.000Z')
  assert.equal(dateTimeInZone('2026-07-15', '17:00')?.toISOString(), '2026-07-15T14:00:00.000Z')
  assert.equal(dateTimeInZone('2026-03-29', '03:30'), null)
  assert.equal(dateTimeInZone('2026-02-30', '17:00'), null)
})

test('timeline cue widths stay proportional and performance numbering skips scene changes', () => {
  const items = [
    { duration: '01:00' },
    { type: 'scene-change', duration: '01:00' },
    { duration: '10:00' },
  ]
  const widths = getCueWidths(items, 1)
  assert.equal(widths[2] / widths[0], 10)
  assert.deepEqual(getPerformanceNumbers(items), [1, null, 2])
})
