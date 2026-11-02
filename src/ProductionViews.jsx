import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, ArrowLeftRight, CalendarDays, Check, GripVertical,
  LogOut, Mail, MonitorPlay, Pause, Play, Plus, Save, Send,
  Flag, Pencil, Settings2, SkipBack, SkipForward, Trash2, X, ZoomIn, ZoomOut,
} from 'lucide-react'
import {
  EVENT_TIME_ZONE, NOTE_DEPARTMENTS, calculateDrift, currentDateInZone, dateTimeInZone, formatClock, formatSignedOffset, getCueWidths, getPerformanceNumbers, isSceneChangeItem,
  isValidColor, isValidQueueDuration, parseDuration, timestampToMillis,
} from './timeline'

const DEPARTMENT_LABELS = { ALL: 'KÕIK', HELI: 'HELI', VALGUS: 'VALGUS', VIDEO: 'VIDEO' }
const DEFAULT_COLORS = ['#7645ff', '#bd5c41', '#e58f98', '#176c68', '#e000d0', '#4a8d22', '#00a8bd', '#357de0']
const CUE_GAP_PX = 2

export function AuthScreen({ configured, busy, error, notice, onLogin, onReset }) {
  const [email, setEmail] = useState('')
  const [resetBusy, setResetBusy] = useState(false)
  const [resetCooldown, setResetCooldown] = useState(0)
  useEffect(() => {
    if (!resetCooldown) return undefined
    const timer = window.setInterval(() => setResetCooldown(value => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [resetCooldown > 0])
  const requestReset = async () => {
    if (busy || resetBusy || resetCooldown || !email.trim()) return
    setResetBusy(true)
    try {
      if (await onReset(email)) setResetCooldown(60)
    } finally { setResetBusy(false) }
  }
  if (!configured) return <main className="q-auth-screen"><section className="q-auth-card"><QueueMark/><p className="q-eyebrow">FIREBASE</p><h1>Seadista ühendus</h1><p>Lisa Firebase Web Appi seaded faili <code>.env.local</code>, seejärel käivita Queue uuesti.</p><a className="q-link" href="https://console.firebase.google.com/" target="_blank" rel="noreferrer">Ava Firebase Console</a></section></main>
  return <main className="q-auth-screen"><section className="q-auth-card"><QueueMark/><p className="q-eyebrow">SHOW WORKSPACE</p><h1>Logi sisse</h1><p>Kasuta Queue’sse lisatud e-posti aadressi.</p>
    <form className="q-form" onSubmit={onLogin}>
      <label>E-post<input type="email" name="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} placeholder="nimi@kool.ee" required/></label>
      <label>Parool<input type="password" name="password" autoComplete="current-password" placeholder="Parool" required/></label>
      {error && <p className="q-alert" role="alert">{error}</p>}
      {notice && <p className="q-success" role="status">{notice}</p>}
      <button className="q-button q-button--primary" disabled={busy}>{busy ? 'Kontrollin…' : 'Logi sisse'}</button>
    </form>
    <button type="button" className="q-text-button q-reset" disabled={busy || resetBusy || resetCooldown > 0 || !email.trim()} onClick={requestReset}><Mail size={15}/>{resetBusy ? 'Saadan e-kirja…' : resetCooldown ? `Proovi uuesti ${resetCooldown} s pärast` : 'Esimene kord või unustasid parooli?'}</button>
    <p className="q-auth-foot">Ligipääs on lubatud ainult Firebase’i lisatud liikmetele. <a className="q-link" href={`${import.meta.env.BASE_URL}privacy.html`}>Andmekaitse</a></p>
  </section></main>
}

export function AccessScreen({ status, error, onRetry, onSignOut }) {
  const copy = status === 'invalid-name'
    ? ['Profiili nimi vajab parandamist', 'Firebase’is olev nimi peab olema täpselt kujul „Eesnimi Perekonnanimi“.']
    : ['Queue ligipääs puudub', 'See e-posti aadress pole Queue liikmete nimekirjas. Ligipääsu haldab projekti omanik Firebase’is.']
  return <main className="q-auth-screen"><section className="q-auth-card"><QueueMark/><p className="q-eyebrow">QUEUE ACCESS</p><h1>{copy[0]}</h1><p>{error || copy[1]}</p><div className="q-auth-actions"><button className="q-button" onClick={onRetry}>Proovi uuesti</button><button className="q-button q-button--quiet" onClick={onSignOut}><LogOut size={15}/>Logi välja</button></div></section></main>
}

export function AppShell({ mode, setMode, member, onOpenSettings, children }) {
  return <div className="q-app-shell">
    <aside className="q-sidebar"><QueueMark/><div className="q-sidebar-spacer"/><button className="q-user-shortcut" aria-label="Tööruumid ja konto" onClick={onOpenSettings}><span>{initials(member?.fullName)}</span><Settings2 size={15}/></button></aside>
    <main className="q-main">
      <header className="q-topbar">
        <nav className="q-mode-nav" aria-label="Töörežiim">
          <ModeButton active={mode === 'production'} onClick={() => setMode('production')} icon={<MonitorPlay size={16}/>} label="Production"/>
          <ModeButton active={mode === 'host'} onClick={() => setMode('host')} icon={<Activity size={16}/>} label="Host"/>
          <ModeButton active={mode === 'edit'} onClick={() => setMode('edit')} icon={<ArrowLeftRight size={16}/>} label="Edit"/>
        </nav>
        <button className={`q-settings-button ${mode === 'settings' ? 'is-active' : ''}`} onClick={onOpenSettings} aria-label="Tööruumid ja konto" title="Tööruumid ja konto"><Settings2 size={17}/><span>Tööruumid</span></button>
      </header>
      <div className={`q-content ${mode === 'production' || mode === 'host' ? 'q-content--show' : ''}`}>{children}</div>
    </main>
  </div>
}

function ModeButton({ active, onClick, icon, label }) {
  return <button className={`q-mode-button ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}>{icon}<span>{label}</span></button>
}

function QueueMark() {
  return <div className="q-brand"><span className="q-brand-mark">Q</span><strong>QUEUE</strong></div>
}

export function ProductionView({
  mode, event, items, timeline, serverNow, selectedId, onSelect,
  notesByItem, noteFilter, setNoteFilter,
  messages, messagesReady, eventId, currentName, onSendMessage, chatError,
  onSkipBack, onSkipForward, onTogglePlay, onJumpSelected, busy, clockWarning,
}) {
  const isHost = mode === 'host'
  const current = items[timeline.currentIndex] || null
  const currentNotes = current && !isSceneChangeItem(current) ? notesByItem[current.id] || [] : []
  const nextShows = timeline.currentIndex >= 0
    ? items.slice(timeline.currentIndex + 1).filter(item => !isSceneChangeItem(item)).slice(0, 5)
    : items.filter(item => !isSceneChangeItem(item)).slice(0, 5)
  const currentPerformanceNumber = current && !isSceneChangeItem(current)
    ? items.slice(0, timeline.currentIndex + 1).filter(item => !isSceneChangeItem(item)).length
    : null
  const driftValue = calculateDrift(event, timeline, serverNow)
  const drift = driftValue === null ? null : formatSignedOffset(driftValue)
  const [split, setSplit] = useState(66)
  const [resizing, setResizing] = useState(false)
  const workspaceRef = useRef(null)
  const scrollRef = useRef(null)
  const [zoom, setZoom] = useState(1)
  const splitLimits = getSplitLimits(workspaceRef.current?.clientHeight || window.innerHeight)

  useEffect(() => {
    if (!resizing) return
    const move = e => {
      const box = workspaceRef.current?.getBoundingClientRect()
      if (!box?.height) return
      const limits = getSplitLimits(box.height)
      setSplit(Math.max(limits.min, Math.min(limits.max, ((e.clientY - box.top) / box.height) * 100)))
    }
    const stop = () => setResizing(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop) }
  }, [resizing])

  const offsets = useMemo(() => {
    let cursor = 0
    return items.map(item => {
      const start = cursor
      cursor += parseDuration(item.duration) ?? 0
      return start
    })
  }, [items])

  return <div className={`q-show-workspace ${resizing ? 'is-resizing' : ''}`} ref={workspaceRef} style={{ '--q-split': `${split}%` }}>
    <section className="q-production-pane">
      <div className="q-stage-strip">
        <div className={`q-stage-current ${current ? 'has-current' : ''}`} style={current ? { '--cue-color': current.color || '#e54b4b' } : undefined}>
          {current ? <>
            <div className="q-stage-number">{currentPerformanceNumber ? String(currentPerformanceNumber).padStart(2, '0') : <ArrowLeftRight size={17}/>}</div>
            <div className="q-stage-copy"><h1>{current.title}</h1>{current.performer && <p>{current.performer}</p>}
              {currentNotes.map(note => <div className="q-current-note" key={note.id}><b>{DEPARTMENT_LABELS[note.department] || note.department}</b><span>{note.body}</span></div>)}
            </div>
            {isHost && drift !== null && <div className={`q-drift ${drift.startsWith('−') ? 'is-ahead' : drift.startsWith('+') ? 'is-late' : ''}`} aria-label="Graafikust kõrvalekalle">{drift}</div>}
          </> : <div className="q-stage-copy q-stage-copy--empty"><h1>{items.length ? 'Vali esimene esinemine' : 'Lisa esinemised Edit režiimis'}</h1></div>}
        </div>
        {clockWarning && isHost && <div className="q-clock-warning" role="status" title={clockWarning}>Kella sünkroonimine vajab seadistamist</div>}
        {isHost && <div className="q-host-controls">
          <button className="q-transport" title="Eelmine segment" aria-label="Eelmine segment" disabled={!items.length || busy} onClick={onSkipBack}><SkipBack size={18}/></button>
          <button className="q-play-button" title={timeline.effectiveStatus === 'playing' ? 'Paus' : 'Esita'} aria-label={timeline.effectiveStatus === 'playing' ? 'Paus' : 'Esita'} disabled={!items.length || busy} onClick={onTogglePlay}>{timeline.effectiveStatus === 'playing' ? <Pause size={19} fill="currentColor"/> : <Play size={19} fill="currentColor"/>}</button>
          <button className="q-transport" title="Järgmine segment" aria-label="Järgmine segment" disabled={!items.length || busy} onClick={onSkipForward}><SkipForward size={18}/></button>
          <button className="q-jump-button" disabled={!selectedId || !items.some(item => item.id === selectedId) || selectedId === timeline.itemId || busy} onClick={onJumpSelected}>Mine valitud cue juurde</button>
        </div>}
      </div>

      <CueTimeline items={items} offsets={offsets} timeline={timeline} selectedId={selectedId} onSelect={isHost ? onSelect : undefined} zoom={zoom} setZoom={setZoom} viewportRef={scrollRef}/>

      <section className="q-up-next" aria-label="Järgmised esinemised">
        <nav className="q-note-filters" aria-label="Märkmete filter">{NOTE_DEPARTMENTS.map(department => <button key={department} className={noteFilter === department ? 'is-active' : ''} aria-pressed={noteFilter === department} onClick={() => setNoteFilter(department)}>{DEPARTMENT_LABELS[department] || department}</button>)}</nav>
        <div className="q-upcoming-list">{nextShows.map(item => {
          const index = items.findIndex(row => row.id === item.id)
          const number = items.slice(0, index + 1).filter(row => !isSceneChangeItem(row)).length
          const notes = (notesByItem[item.id] || []).filter(note => noteFilter === 'ALL' || note.department === 'ALL' || note.department === noteFilter)
          return <article key={item.id} className={`q-queue-row ${isHost && selectedId === item.id ? 'is-selected' : ''}`} style={{ '--cue-color': item.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length] }}>
            <button className="q-queue-select" onClick={() => isHost && onSelect(item.id)} disabled={!isHost} aria-label={`Vali ${item.title}`} aria-pressed={isHost && selectedId === item.id}>
              <span className="q-queue-number">{String(number).padStart(2, '0')}</span>
              <span className="q-queue-main"><strong>{item.title}</strong>{item.performer && <small>{item.performer}</small>}
                {notes.map(note => <span className="q-note-line" key={note.id}><b>{DEPARTMENT_LABELS[note.department] || DEPARTMENT_LABELS.ALL}</b><span>{note.body}</span></span>)}
              </span>
              <span className="q-queue-time">{formatClock(offsets[index] || 0)}</span>
              <span className="q-queue-duration">{item.duration || '00:00'}</span>
            </button>
          </article>
        })}
        {!nextShows.length && <div className="q-queue-empty">{items.length ? 'Järgmisi esinemisi pole.' : 'Järjekord on tühi.'}</div>}</div>
      </section>
    </section>

    <div className="q-show-splitter" role="separator" aria-label="Muuda vestluse suurust" aria-orientation="horizontal" aria-valuemin={Math.round(splitLimits.min)} aria-valuemax={Math.round(splitLimits.max)} aria-valuenow={Math.round(split)} tabIndex={0} onPointerDown={e => { e.preventDefault(); setResizing(true) }} onKeyDown={e => { if (e.key === 'ArrowUp') setSplit(v => Math.min(splitLimits.max, v + 3)); if (e.key === 'ArrowDown') setSplit(v => Math.max(splitLimits.min, v - 3)) }}><span/></div>
    <section className="q-chat-pane"><ChatPanel eventId={eventId} messages={messages} messagesReady={messagesReady} currentName={currentName} onSend={onSendMessage} error={chatError}/></section>
  </div>
}

function CueTimeline({ items, offsets, timeline, selectedId, onSelect, zoom, setZoom, viewportRef }) {
  const [width, setWidth] = useState(900)
  useEffect(() => {
    const element = viewportRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => setWidth(entries[0]?.contentRect.width || 900))
    observer.observe(element)
    return () => observer.disconnect()
  }, [viewportRef])
  const widths = getCueWidths(items, zoom)
  const actNumbers = getPerformanceNumbers(items)
  const currentStart = timeline.currentIndex >= 0 ? offsets[timeline.currentIndex] || 0 : 0
  const elapsed = Math.max(0, timeline.positionSeconds - currentStart)
  let leftOfMarker = 0
  for (let index = 0; index < Math.max(0, timeline.currentIndex); index += 1) leftOfMarker += widths[index] + CUE_GAP_PX
  if (timeline.currentIndex >= 0) {
    leftOfMarker += Math.min(1, Math.max(0, elapsed / Math.max(timeline.starts[timeline.currentIndex]?.duration || 0, 0.001))) * widths[timeline.currentIndex]
  }
  const translate = width / 2 - leftOfMarker
  return <section className="q-cue-timeline" aria-label="Ajatelg">
    <div className="q-timeline-tools"><button title="Vähenda suumi" aria-label="Vähenda suumi" onClick={() => setZoom(value => Math.max(.55, Number((value - .15).toFixed(2))))}><ZoomOut size={15}/></button><button title="Suurenda suumi" aria-label="Suurenda suumi" onClick={() => setZoom(value => Math.min(2.2, Number((value + .15).toFixed(2))))}><ZoomIn size={15}/></button></div>
    <div className="q-cue-viewport" ref={viewportRef}>
      <div className="q-cue-lane" style={{ gap: `${CUE_GAP_PX}px`, transform: `translateX(${translate}px)` }}>
        {items.map((item, index) => <button key={item.id} className={`q-cue-block ${isSceneChangeItem(item) ? 'is-transition' : ''} ${item.id === timeline.itemId ? 'is-current' : ''} ${item.id === selectedId ? 'is-selected' : ''}`} style={{ width: widths[index], '--cue-color': isSceneChangeItem(item) ? '#606a77' : item.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length] }} title={`${item.title} · ${item.duration || '00:00'}`} onClick={() => onSelect?.(item.id)}><span>{actNumbers[index] || '↔'}</span><strong>{item.title}</strong></button>)}
      </div>
      <div className="q-playhead"><i/></div>
      <div className="q-playhead-time">{formatClock(Math.floor(timeline.positionMs / 1000))}</div>
    </div>
  </section>
}

export function QueueEditor({ event, items, queueRevision, notesByItem = {}, noteBusy, onAddNote, onEditNote, onDeleteNote, onSaveItem, onDeleteItem, onMoveItem, onAddItem, onSaveEvent }) {
  const [drafts, setDrafts] = useState({})
  const [adding, setAdding] = useState(false)
  const [newDraft, setNewDraft] = useState({ title: '', performer: '', duration: '03:00', color: DEFAULT_COLORS[0] })
  const [drag, setDrag] = useState(null)
  const [busy, setBusy] = useState(false)
  const [savingRows, setSavingRows] = useState({})
  const [sceneBusy, setSceneBusy] = useState(null)
  const dragRef = useRef(null)
  const rowElements = useRef(new Map())
  const itemRef = useRef(items)
  const moveRef = useRef(onMoveItem)
  itemRef.current = items
  moveRef.current = onMoveItem

  useEffect(() => { setDrafts({}) }, [event?.id])
  useEffect(() => {
    if (!drag) return
    const move = e => {
      const active = dragRef.current
      if (!active) return
      const rows = itemRef.current.map(item => ({ item, rect: rowElements.current.get(item.id)?.getBoundingClientRect() })).filter(row => row.rect && !isSceneChangeItem(row.item))
      const target = rows.find(row => e.clientY < row.rect.top + row.rect.height / 2) || rows[rows.length - 1]
      if (!target || active.targetId === target.item.id) return
      const next = { ...active, targetId: target.item.id }
      dragRef.current = next
      setDrag(next)
    }
    const finish = () => {
      const active = dragRef.current
      if (!active) return
      dragRef.current = null
      setDrag(null)
      if (active.targetId !== active.id) {
        setBusy(true)
        Promise.resolve(moveRef.current?.(active.id, active.targetId)).finally(() => setBusy(false))
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish) }
  }, [Boolean(drag)])

  const draftFor = item => drafts[item.id] || item
  const eventStart = timestampToMillis(event?.startAt) ?? getStartMillis(event)
  const schedule = useMemo(() => getSegmentSchedule(items, drafts), [items, drafts])
  const actNumbers = getPerformanceNumbers(items)
  const firstPerformanceIndex = items.findIndex(item => !isSceneChangeItem(item))
  const isDirty = (item, draft, index) => {
    const color = isValidColor(item.color) ? item.color : DEFAULT_COLORS[index % DEFAULT_COLORS.length]
    const newColor = isValidColor(draft.color) ? draft.color : color
    return String(draft.title || '').trim() !== String(item.title || '').trim()
      || String(draft.performer || '').trim() !== String(item.performer || '').trim()
      || String(draft.duration || '').trim() !== String(item.duration || '').trim()
      || newColor !== color
  }
  const beginDrag = (e, item) => {
    if (busy || isSceneChangeItem(item) || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.preventDefault()
    const next = { id: item.id, targetId: item.id }
    dragRef.current = next
    setDrag(next)
  }
  const updateDraft = (item, key, value) => setDrafts(current => ({ ...current, [item.id]: { ...draftFor(item), [key]: value } }))

  const addTransitionAt = async index => {
    setSceneBusy(index)
    try {
      await onAddItem({ title: 'Lava vahetus', performer: '', duration: '01:00', color: '#59616c', type: 'scene-change' }, index + 1)
    } finally {
      setSceneBusy(null)
    }
  }

  return <section className="q-editor-page">
    <EventSettingsEditor event={event} onSave={onSaveEvent}/>
    <div className="q-editor-toolbar"><button className="q-button q-button--primary" disabled={!event || busy || items.length >= 400} onClick={() => setAdding(true)}><Plus size={15}/>Lisa esinemine</button><span>{items.filter(item => !isSceneChangeItem(item)).length} esinemist</span></div>
    {!event ? <div className="q-empty">Vali või loo tööruum seadete lehel.</div> : <div className="q-editor-table-wrap"><table className="q-editor-table"><thead><tr><th>#</th><th>Esinemine</th><th>Laval</th><th>Algus</th><th>Lõpp</th><th>Kestus</th><th>Värv</th><th/></tr></thead><tbody>
      {items.map((item, index) => {
        const row = draftFor(item)
        const transition = isSceneChangeItem(item)
        const number = actNumbers[index]
        const dirty = isDirty(item, row, index)
        const canInsertTransition = !transition && index < items.length - 1 && !isSceneChangeItem(items[index + 1])
        const moveByKeyboard = direction => {
          const performances = items.filter(candidate => !isSceneChangeItem(candidate))
          const current = performances.findIndex(candidate => candidate.id === item.id)
          const target = performances[current + direction]
          if (!target || busy) return
          setBusy(true)
          Promise.resolve(onMoveItem?.(item.id, target.id)).finally(() => setBusy(false))
        }
        return <Fragment key={item.id}>
          <tr ref={node => node ? rowElements.current.set(item.id, node) : rowElements.current.delete(item.id)} className={`q-editor-row ${transition ? 'is-transition' : ''} ${drag?.id === item.id ? 'is-dragging' : ''} ${drag?.targetId === item.id ? 'is-drop-target' : ''}`}>
            <td className="q-row-index">{transition ? <ArrowLeftRight size={15}/> : <><span>{String(number).padStart(2, '0')}</span><button className="q-drag-handle" type="button" disabled={busy} aria-label={`Lohista ${item.title}; kasuta nooli järjekorra muutmiseks`} onPointerDown={e => beginDrag(e, item)} onKeyDown={e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); moveByKeyboard(e.key === 'ArrowUp' ? -1 : 1) } }}><GripVertical size={17}/></button></>}</td>
            <td data-label="Esinemine">{transition ? <strong className="q-transition-title">Lava vahetus</strong> : <input aria-label="Esinemise pealkiri" value={row.title || ''} onChange={e => updateDraft(item, 'title', e.target.value)} maxLength={120}/>}</td>
            <td data-label="Laval">{transition ? <span className="q-muted">—</span> : <input aria-label="Kes laval" value={row.performer || ''} onChange={e => updateDraft(item, 'performer', e.target.value)} maxLength={120}/>}</td>
            <td data-label="Algus"><time>{formatScheduledTime(eventStart, schedule[index]?.start ?? 0)}</time></td>
            <td data-label="Lõpp"><time>{formatScheduledTime(eventStart, schedule[index]?.end ?? 0)}</time></td>
            <td data-label="Kestus"><input aria-label={transition ? 'Lava vahetuse kestus' : 'Esinemise kestus'} className={!isValidQueueDuration(row.duration) ? 'is-invalid' : ''} value={row.duration || ''} onChange={e => updateDraft(item, 'duration', e.target.value)} placeholder="03:00" inputMode="numeric"/></td>
            <td data-label="Värv">{transition ? <span className="q-transition-swatch"/> : <input className="q-color-input" type="color" aria-label={`Värv: ${item.title}`} value={isValidColor(row.color) ? row.color : DEFAULT_COLORS[index % DEFAULT_COLORS.length]} onChange={e => updateDraft(item, 'color', e.target.value)}/>}</td>
            <td className="q-row-actions"><button className="q-icon-button" title="Salvesta rida" aria-label="Salvesta rida" disabled={!dirty || Boolean(savingRows[item.id]) || !isValidQueueDuration(row.duration) || (!transition && !String(row.title || '').trim())} onClick={async () => { setSavingRows(current => ({ ...current, [item.id]: true })); try { if (await onSaveItem(item.id, row)) setDrafts(current => { const next = { ...current }; delete next[item.id]; return next }) } finally { setSavingRows(current => { const next = { ...current }; delete next[item.id]; return next }) } }}><Save size={15}/></button><button className="q-icon-button q-icon-button--danger" title={transition ? 'Eemalda lava vahetus' : 'Eemalda esinemine'} aria-label={transition ? 'Eemalda lava vahetus' : 'Eemalda esinemine'} onClick={() => { const question = transition ? 'Eemalda lava vahetus?' : `Eemalda esinemine „${item.title}“?`; if (window.confirm(question)) onDeleteItem(item.id) }}><Trash2 size={15}/></button></td>
          </tr>
          {!transition && <tr className="q-editor-notes-row"><td colSpan={8}><div className="q-editor-notes">
            {(notesByItem[item.id] || []).map(note => <article className="q-editor-note" key={note.id}>
              <b>{DEPARTMENT_LABELS[note.department] || DEPARTMENT_LABELS.ALL}</b><p>{note.body}</p>
              <span className="q-editor-note-actions"><button className="q-icon-button" type="button" title="Muuda märkust" aria-label="Muuda märkust" disabled={noteBusy} onClick={() => onEditNote(item, note)}><Pencil size={14}/></button><button className="q-icon-button q-icon-button--danger" type="button" title="Kustuta märkus" aria-label="Kustuta märkus" disabled={noteBusy} onClick={() => { if (window.confirm('Kustuta see märkus?')) onDeleteNote(item, note) }}><Trash2 size={14}/></button></span>
            </article>)}
            <button className="q-editor-note-add" type="button" disabled={noteBusy || busy} onClick={() => onAddNote(item)}><Plus size={14}/>{notesByItem[item.id]?.length ? 'Lisa märkus' : 'Lisa esimene märkus'}</button>
          </div></td></tr>}
          {canInsertTransition && <tr className="q-gap-row"><td colSpan={8}><button type="button" disabled={sceneBusy === index} onClick={() => addTransitionAt(index)}><Plus size={14}/> {sceneBusy === index ? 'Lisan…' : 'Lisa 1 min lava vahetus'}</button></td></tr>}
          {firstPerformanceIndex === index && index === items.length - 1 && <tr className="q-end-hint"><td colSpan={8}>Uue esinemise lisamisel lisatakse lava vahetus automaatselt.</td></tr>}
        </Fragment>
      })}
      {adding && <tr className="q-new-row"><td>+</td><td data-label="Esinemine"><input aria-label="Esinemise pealkiri" placeholder="Pealkiri" value={newDraft.title} onChange={e => setNewDraft(current => ({ ...current, title: e.target.value }))}/></td><td data-label="Laval"><input aria-label="Kes laval" placeholder="Nimi või rühm" value={newDraft.performer} onChange={e => setNewDraft(current => ({ ...current, performer: e.target.value }))}/></td><td data-label="Algus">—</td><td data-label="Lõpp">—</td><td data-label="Kestus"><input aria-label="Kestus" inputMode="numeric" className={!isValidQueueDuration(newDraft.duration) ? 'is-invalid' : ''} value={newDraft.duration} onChange={e => setNewDraft(current => ({ ...current, duration: e.target.value }))}/></td><td data-label="Värv"><input className="q-color-input" type="color" aria-label="Värv" value={newDraft.color} onChange={e => setNewDraft(current => ({ ...current, color: e.target.value }))}/></td><td className="q-row-actions"><button className="q-icon-button" title="Lisa" disabled={!newDraft.title.trim() || !isValidQueueDuration(newDraft.duration) || busy || items.length >= 400} onClick={async () => { if (await onAddItem({ ...newDraft, type: 'performance' })) { setNewDraft({ title: '', performer: '', duration: '03:00', color: DEFAULT_COLORS[(items.length + 1) % DEFAULT_COLORS.length] }); setAdding(false) } }}><Check size={15}/></button><button className="q-icon-button" title="Tühista" onClick={() => setAdding(false)}><X size={15}/></button></td></tr>}
    </tbody></table>{!items.length && !adding && <div className="q-empty">Järjekord on tühi. Lisa esimene esinemine.</div>}</div>}
  </section>
}

function EventSettingsEditor({ event, onSave }) {
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const current = useMemo(() => ({ title: event?.title || '', venue: event?.venue || '', date: event?.date || '', start: event?.start || '' }), [event?.id, event?.title, event?.venue, event?.date, event?.start])
  useEffect(() => setDraft(current), [current])
  const value = draft || current
  const dirty = value.title !== current.title || value.venue !== current.venue || value.date !== current.date || value.start !== current.start
  return <section className="q-event-settings"><div className="q-settings-fields">
    <label>Ürituse nimi<input value={value.title} onChange={e => setDraft({ ...value, title: e.target.value })} maxLength={100}/></label>
    <label>Koht<input value={value.venue} onChange={e => setDraft({ ...value, venue: e.target.value })} maxLength={120}/></label>
    <label>Kuupäev<input type="date" value={value.date} onChange={e => setDraft({ ...value, date: e.target.value })}/></label>
    <label>Algusaeg<input type="time" value={value.start} onChange={e => setDraft({ ...value, start: e.target.value })}/></label>
  </div><button className="q-button q-button--quiet" disabled={!event || !dirty || saving} onClick={async () => { setSaving(true); try { if (await onSave(value)) setDraft(value) } finally { setSaving(false) } }}><Save size={15}/>{saving ? 'Salvestan…' : 'Salvesta'}</button></section>
}

export function SettingsPage({ events, selectedEventId, member, onSelectEvent, onCreateEvent, onSignOut }) {
  const sorted = [...events].sort((a, b) => (timestampToMillis(a.startAt) ?? getStartMillis(a) ?? 0) - (timestampToMillis(b.startAt) ?? getStartMillis(b) ?? 0))
  return <section className="q-settings-page">
    <div className="q-settings-header"><h1>Tööruumid</h1><button className="q-button q-button--primary" onClick={onCreateEvent}><Plus size={16}/>Loo üritus</button></div>
    <div className="q-workspace-list">{sorted.map(event => <button key={event.id} className={`q-workspace-item ${selectedEventId === event.id ? 'is-selected' : ''}`} onClick={() => onSelectEvent(event.id)}><span className="q-workspace-date"><CalendarDays size={15}/>{formatEventDate(event)}</span><strong>{event.title}</strong><span className="q-workspace-meta">{event.venue || ''}{event.venue ? ' · ' : ''}{formatEventStart(event)}</span></button>)}{!events.length && <p className="q-empty">Üritusi pole. Loo esimene tööruum.</p>}</div>
    <section className="q-account-panel"><div><span className="q-account-avatar">{initials(member?.fullName)}</span><div><strong>{member?.fullName}</strong><small>{member?.email}</small></div></div><a className="q-link" href={`${import.meta.env.BASE_URL}privacy.html`}>Andmekaitse</a><button className="q-button q-button--quiet" onClick={onSignOut}><LogOut size={15}/>Logi välja</button></section>
  </section>
}

export function CreateEventDialog({ onClose, onCreate, busy, error }) {
  const [date, setDate] = useState(() => currentDateInZone())
  const [start, setStart] = useState('18:00')
  return <Modal onClose={onClose} title="Loo üritus"><form className="q-form" onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); onCreate({ title: String(data.get('title')).trim(), venue: String(data.get('venue')).trim(), date, start }) }}>
    <label>Ürituse nimi<input name="title" required maxLength={100} autoFocus/></label><label>Koht<input name="venue" maxLength={120} placeholder="Aula või saal"/></label>
    <div className="q-form-grid"><label>Kuupäev<input type="date" value={date} onChange={e => setDate(e.target.value)} required/></label><label>Algusaeg<input type="time" value={start} onChange={e => setStart(e.target.value)} required/></label></div>
    {error && <p className="q-alert" role="alert">{error}</p>}<div className="q-modal-actions"><button type="button" className="q-button q-button--quiet" onClick={onClose}>Tühista</button><button className="q-button q-button--primary" disabled={busy}><Plus size={15}/>{busy ? 'Loon…' : 'Loo üritus'}</button></div>
  </form></Modal>
}

export function NoteDialog({ item, note, onClose, onSave, busy, error }) {
  const [department, setDepartment] = useState(note?.department || 'ALL')
  const [body, setBody] = useState(note?.body || '')
  return <Modal onClose={onClose} title={note ? 'Muuda märkust' : item?.title || 'Lisa märkus'}><form className="q-form" onSubmit={e => { e.preventDefault(); const value = body.trim(); if (value) onSave({ body: value, department }) }}>
    <label>Märkus<textarea name="body" rows={4} required maxLength={800} autoFocus placeholder="Tehniline info selle esinemise kohta" value={body} onChange={e => setBody(e.target.value)}/></label>
    <label>Osakond<select value={department} onChange={e => setDepartment(e.target.value)}>{NOTE_DEPARTMENTS.map(value => <option key={value} value={value}>{DEPARTMENT_LABELS[value]}</option>)}</select></label>
    {error && <p className="q-alert" role="alert">{error}</p>}<div className="q-modal-actions"><button type="button" className="q-button q-button--quiet" onClick={onClose}>Tühista</button><button className="q-button q-button--primary" disabled={busy || !body.trim()}><Check size={15}/>{busy ? 'Salvestan…' : 'Salvesta märkus'}</button></div>
  </form></Modal>
}

function ChatPanel({ eventId, messages, messagesReady, currentName, onSend, error }) {
  const [text, setText] = useState('')
  const [important, setImportant] = useState(false)
  const [arrivingIds, setArrivingIds] = useState(() => new Set())
  const knownIds = useRef(new Set())
  const initializedRef = useRef(false)
  const activeEventId = useRef(eventId)
  const animationTimer = useRef(null)
  const feedRef = useRef(null)
  useEffect(() => { if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight }, [messages.length])
  useEffect(() => {
    if (activeEventId.current !== eventId) {
      activeEventId.current = eventId
      knownIds.current = new Set()
      initializedRef.current = false
      setArrivingIds(new Set())
      return
    }
    if (!messagesReady) return
    if (!initializedRef.current) {
      messages.forEach(message => knownIds.current.add(message.id))
      initializedRef.current = true
      return
    }
    const arriving = messages.filter(message => !knownIds.current.has(message.id)).map(message => message.id)
    messages.forEach(message => knownIds.current.add(message.id))
    if (!arriving.length) return
    setArrivingIds(current => new Set([...current, ...arriving]))
    window.clearTimeout(animationTimer.current)
    animationTimer.current = window.setTimeout(() => setArrivingIds(new Set()), 260)
  }, [eventId, messages, messagesReady])
  useEffect(() => () => window.clearTimeout(animationTimer.current), [])
  return <div className="q-chat">{error && <p className="q-chat-error" role="alert">{error}</p>}<div className="q-chat-feed" ref={feedRef} aria-live="polite">
    {messages.map(message => <article key={message.id} className={`q-chat-message ${arrivingIds.has(message.id) ? 'is-new' : ''} ${message.important === true ? 'is-important' : ''}`}>
      <div className="q-chat-meta"><strong>{message.author || currentName || 'Queue'}</strong><time>{formatMessageTime(message.createdAt)}</time>{message.important === true && <span className="q-chat-important-label"><Flag size={12} aria-hidden="true"/>TÄHTIS</span>}</div>
      <p>{message.body}</p>
    </article>)}
    {!messages.length && <div className="q-chat-empty">Vestlust pole veel alustatud.</div>}
  </div><form className="q-chat-compose" onSubmit={e => { e.preventDefault(); const body = text.trim(); if (!body) return; onSend(body, important).then(sent => { if (sent) { setText(''); setImportant(false) } }) }}>
    <input value={text} onChange={e => setText(e.target.value)} maxLength={1200} placeholder="Kirjuta sõnum…" aria-label="Sõnum"/>
    <button className={`q-chat-important-toggle ${important ? 'is-active' : ''}`} type="button" aria-pressed={important} onClick={() => setImportant(value => !value)} title={important ? 'Eemalda tähtsuse märge' : 'Märgi tähtsaks'}><Flag size={15}/><span>Tähtis</span></button>
    <button className="q-chat-send" aria-label="Saada sõnum" disabled={!text.trim()}><Send size={17}/></button>
  </form></div>
}

function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return <div className="q-modal-backdrop" onPointerDown={e => e.target === e.currentTarget && onClose()}><section className="q-modal" role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button className="q-icon-button" onClick={onClose} aria-label="Sulge"><X size={18}/></button></header>{children}</section></div>
}

function getSegmentSchedule(items, drafts) {
  let cursor = 0
  return items.map(item => {
    const start = cursor
    cursor += parseDuration(drafts[item.id]?.duration ?? item.duration) ?? 0
    return { start, end: cursor }
  })
}

function getSplitLimits(height) {
  const compact = window.matchMedia('(max-width: 640px)').matches
  const divider = compact ? 12 : 14
  const productionMin = compact ? 260 : 210
  const chatMin = compact ? 160 : 140
  const min = Math.max(compact ? 40 : 48, productionMin / Math.max(1, height) * 100)
  const max = Math.max(0, Math.min(84, (height - chatMin - divider) / Math.max(1, height) * 100))
  const lower = Math.min(min, max)
  return { min: lower, max: Math.max(lower, max) }
}

function getStartMillis(event) {
  if (!event?.date || !event?.start) return null
  return dateTimeInZone(event.date, event.start)?.getTime() ?? null
}

function formatScheduledTime(eventStart, seconds) {
  if (eventStart === null || eventStart === undefined || !Number.isFinite(eventStart)) return '—'
  return new Intl.DateTimeFormat('et-EE', { timeZone: EVENT_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(eventStart + seconds * 1000))
}

function formatEventDate(event) {
  const value = timestampToMillis(event?.startAt) ?? getStartMillis(event)
  if (value === null) return event?.date || '—'
  return new Intl.DateTimeFormat('et-EE', { timeZone: EVENT_TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value))
}

function formatEventStart(event) {
  const value = timestampToMillis(event?.startAt) ?? getStartMillis(event)
  return value === null ? event?.start || '' : new Intl.DateTimeFormat('et-EE', { timeZone: EVENT_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value))
}

function formatMessageTime(value) {
  const time = timestampToMillis(value)
  return time === null ? '' : new Intl.DateTimeFormat('et-EE', { timeZone: EVENT_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(time))
}

function initials(value = '') {
  return String(value).trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase() || 'Q'
}
