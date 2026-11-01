export const NOTE_DEPARTMENTS = ['ALL', 'HELI', 'VALGUS', 'VIDEO']
export const EVENT_TIME_ZONE = 'Europe/Tallinn'

export const isSceneChangeItem = item => item?.type === 'scene-change' || item?.type === 'Üleminek' || item?.type === 'Lava vahetus'

export function parseDuration(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value)
  const text = String(value ?? '').trim()
  const mmss = /^(\d{1,3}):([0-5]\d)$/.exec(text)
  if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2])
  const hhmmss = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/.exec(text)
  if (hhmmss) return Number(hhmmss[1]) * 3600 + Number(hhmmss[2]) * 60 + Number(hhmmss[3])
  return null
}

export function isValidQueueDuration(value) {
  const seconds = parseDuration(value)
  return seconds !== null && seconds > 0 && seconds <= 24 * 60 * 60
}

export function dateTimeInZone(date, time, timeZone = EVENT_TIME_ZONE) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''))
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(String(time || ''))
  if (!dateMatch || !timeMatch) return null
  const [, yearText, monthText, dayText] = dateMatch
  const [, hourText, minuteText] = timeMatch
  const parts = [yearText, monthText, dayText, hourText, minuteText].map(Number)
  const [year, month, day, hour, minute] = parts
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null
  const target = Date.UTC(year, month - 1, day, hour, minute)
  const calendarCheck = new Date(target)
  if (calendarCheck.getUTCFullYear() !== year || calendarCheck.getUTCMonth() !== month - 1 || calendarCheck.getUTCDate() !== day) return null

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  })
  let candidate = target
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const values = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map(part => [part.type, part.value]))
    const represented = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second))
    candidate += target - represented
  }
  const final = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map(part => [part.type, part.value]))
  if (Number(final.year) !== year || Number(final.month) !== month || Number(final.day) !== day || Number(final.hour) !== hour || Number(final.minute) !== minute || Number(final.second) !== 0) return null
  return new Date(candidate)
}

export function currentDateInZone(timeZone = EVENT_TIME_ZONE, now = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function formatDuration(value) {
  const total = Math.max(0, Math.floor(Number(value) || 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function formatClock(value) {
  const total = Math.max(0, Math.floor(Number(value) || 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function formatSignedOffset(milliseconds) {
  if (!Number.isFinite(milliseconds)) return ''
  if (Math.abs(milliseconds) < 500) return formatDuration(0)
  const seconds = Math.round(Math.abs(milliseconds) / 1000)
  const sign = milliseconds > 0 ? '+' : '−'
  return `${sign}${formatDuration(seconds)}`
}

export function timestampToMillis(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

export function getSegmentStarts(items = []) {
  let cursor = 0
  return items.map(item => {
    const start = cursor
    const duration = parseDuration(item.duration) ?? 0
    cursor += duration
    return { start, end: cursor, duration }
  })
}

export function getCueWidths(items = [], zoom = 1, pixelsPerSecond = 0.42) {
  const scale = pixelsPerSecond * Math.max(0.01, Number(zoom) || 1)
  return items.map(item => Math.max(1, (parseDuration(item.duration) ?? 60) * scale))
}

export function getPerformanceNumbers(items = []) {
  let number = 0
  return items.map(item => isSceneChangeItem(item) ? null : ++number)
}

export function readTimelineState(event, items = []) {
  const saved = event?.timeline
  if (saved && typeof saved === 'object') {
    return {
      status: ['scheduled', 'playing', 'paused', 'ended'].includes(saved.status) ? saved.status : 'scheduled',
      itemId: typeof saved.itemId === 'string' ? saved.itemId : null,
      positionMs: Math.max(0, Number(saved.positionMs) || 0),
      anchorAt: saved.anchorAt || null,
      firstStartedAt: saved.firstStartedAt || null,
      commandRevision: Math.max(0, Number(saved.commandRevision) || 0),
      updatedBy: saved.updatedBy || null,
    }
  }

  const legacyId = event?.currentItemId || null
  const legacyIndex = items.findIndex(item => item.id === legacyId)
  const starts = getSegmentStarts(items)
  const legacyOffset = legacyIndex >= 0 ? starts[legacyIndex].start : 0
  const cueElapsed = Math.max(0, Number(event?.currentElapsedSeconds) || 0)
  const status = event?.status === 'live' ? 'playing' : event?.status === 'paused' ? 'paused' : 'scheduled'
  const legacyAnchor = event?.currentStartedAt || null
  return {
    status,
    itemId: legacyId,
    positionMs: Math.round((Number.isFinite(Number(event?.timelinePositionSeconds)) ? Number(event.timelinePositionSeconds) : legacyOffset + cueElapsed) * 1000),
    anchorAt: status === 'playing' ? legacyAnchor : null,
    firstStartedAt: status === 'playing' ? legacyAnchor : null,
    commandRevision: 0,
    updatedBy: event?.updatedBy || null,
  }
}

export function deriveTimeline(event, items = [], nowMs = Date.now()) {
  const state = readTimelineState(event, items)
  const index = items.findIndex(item => item.id === state.itemId)
  const starts = getSegmentStarts(items)
  const start = index >= 0 ? starts[index].start : 0
  const end = index >= 0 ? starts[index].end : 0
  const anchorMs = timestampToMillis(state.anchorAt)
  const elapsedMs = state.status === 'playing' && anchorMs !== null ? Math.max(0, nowMs - anchorMs) : 0
  let positionMs = state.positionMs + elapsedMs
  let status = state.status

  if (status === 'playing' && index >= 0 && starts[index].duration > 0 && positionMs >= end * 1000) {
    positionMs = end * 1000
    status = 'paused'
  }
  if (status === 'playing' && index >= 0 && starts[index].duration === 0) {
    positionMs = start * 1000
    status = 'paused'
  }

  return {
    ...state,
    currentIndex: index,
    effectiveStatus: status,
    positionMs: Math.max(0, Math.floor(positionMs)),
    positionSeconds: Math.max(0, positionMs / 1000),
    cueElapsedSeconds: index >= 0 ? Math.max(0, positionMs / 1000 - start) : 0,
    segmentStartSeconds: start,
    segmentEndSeconds: end,
    starts,
  }
}

export function calculateDrift(event, timeline, serverNowMs) {
  const startAt = timestampToMillis(event?.startAt) ?? (() => {
    if (!event?.date || !event?.start) return null
    return dateTimeInZone(event.date, event.start)?.getTime() ?? null
  })()
  if (startAt === null || timestampToMillis(timeline?.firstStartedAt) === null) return null
  return serverNowMs - (startAt + timeline.positionMs)
}

export function normalizeLegacyDepartment(note) {
  if (NOTE_DEPARTMENTS.includes(note?.department)) return note.department
  if (note?.audience === 'sound') return 'HELI'
  if (note?.audience === 'lighting') return 'VALGUS'
  if (note?.audience === 'video') return 'VIDEO'
  if (note?.audience === 'all') return 'ALL'
  return null
}

export function isValidFullName(value) {
  return /^\S+\s+\S+$/u.test(String(value || '').trim())
}

export function isValidColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || ''))
}
