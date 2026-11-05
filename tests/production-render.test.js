import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

globalThis.window = { innerHeight: 900, matchMedia: () => ({ matches: false }) }

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
const { CountdownView, ProductionView, SettingsPage } = await vite.ssrLoadModule('/src/ProductionViews.jsx')

const items = [
  { id: 'act-1', title: 'Opening', performer: 'Stage team', duration: '01:00', type: 'performance', color: '#176c68' },
  { id: 'change-1', title: 'Stage change', duration: '00:30', type: 'scene-change' },
  { id: 'act-2', title: 'Next act', performer: 'Guest', duration: '02:00', type: 'performance' },
]

const timeline = {
  currentIndex: 0,
  itemId: 'act-1',
  positionMs: 15_000,
  positionSeconds: 15,
  effectiveStatus: 'playing',
  autoContinue: true,
  starts: [
    { start: 0, end: 60, duration: 60 },
    { start: 60, end: 90, duration: 30 },
    { start: 90, end: 210, duration: 120 },
  ],
}

test('Host production screen renders aligned controls, manual department filters and segment countdown', async () => {
  const markup = renderToStaticMarkup(createElement(ProductionView, {
    mode: 'host', event: { title: 'Test event' }, items, timeline, serverNow: Date.now(),
    selectedId: 'act-2', onSelect: () => {}, notesByItem: {}, noteFilters: ['HELI', 'VALGUS', 'VIDEO', 'MUU'],
    onToggleNoteFilter: () => {}, messages: [], messagesReady: true, directoryMembers: [], eventId: 'test',
    currentName: 'Test Member', onSendMessage: async () => true, chatError: '', onSkipBack: () => {},
    onSkipForward: () => {}, onTogglePlay: () => {}, onToggleAutoContinue: () => {}, onJumpSelected: () => {},
    busy: false, clockWarning: '', networkOnline: true,
  }))
  assert.match(markup, /class="q-play-button is-playing"/)
  assert.match(markup, />AUTOSKIP<\/button>/)
  assert.match(markup, /class="q-end-countdown"[^>]*>-00:45<\/output>/)
  assert.match(markup, /aria-label="Märkmete filter"/)
  assert.doesNotMatch(markup, /KÕIK/)
})

test('Timer and Settings render their new states without throwing', () => {
  const timerMarkup = renderToStaticMarkup(createElement(CountdownView, {
    items, timeline, offline: false, onExit: () => {},
  }))
  assert.match(timerMarkup, /class="q-countdown-screen"/)

  const settingsMarkup = renderToStaticMarkup(createElement(SettingsPage, {
    events: [], selectedEventId: '', member: { uid: 'member-1', fullName: 'Test Member', email: 'test@example.test' },
    directoryMembers: [{ uid: 'member-1', fullName: 'Test Member' }], directoryError: '', networkOnline: true,
    bugReportBusy: false, onSelectEvent: () => {}, onCreateEvent: () => {}, onSignOut: () => {},
    onSaveProfile: async () => true, onSendBugReport: async () => true,
  }))
  assert.match(settingsMarkup, /Viimane aktiivsus teadmata/)
  assert.match(settingsMarkup, /q-bug-report-body/)
})

test.after(async () => {
  await vite.close()
})
