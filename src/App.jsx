import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Settings2 } from 'lucide-react'
import { onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import {
  Timestamp, addDoc, collection, deleteDoc, doc, getDocs, limit, onSnapshot,
  orderBy, query, runTransaction, serverTimestamp, updateDoc, where, writeBatch,
} from 'firebase/firestore'
import { onValue, ref } from 'firebase/database'
import { auth, db, isFirebaseConfigured, isServerClockConfigured, realtimeDb } from './firebase'
import {
  NOTE_DEPARTMENTS, deriveTimeline, getSegmentStarts,
  dateTimeInZone, isSceneChangeItem, isValidColor, isValidFullName, isValidQueueDuration, normalizeLegacyDepartment,
  readTimelineState, timestampToMillis,
} from './timeline'
import {
  AccessScreen, AppShell, AuthScreen, CreateEventDialog, MemberSetupScreen, NoteDialog,
  ProductionView, QueueEditor, SettingsPage,
} from './ProductionViews'

const NOTE_QUERY_DEPARTMENTS = ['ALL', 'HELI', 'VALGUS', 'VIDEO']
const LEGACY_NOTE_AUDIENCES = ['all', 'sound', 'lighting', 'video']
const DEFAULT_COLORS = ['#7645ff', '#bd5c41', '#e58f98', '#176c68', '#e000d0', '#4a8d22', '#00a8bd', '#357de0']
const MAX_QUEUE_ITEMS = 400

function initialMode() {
  try {
    const saved = localStorage.getItem('queue-mode')
    return ['production', 'host', 'edit', 'settings'].includes(saved) ? saved : 'production'
  } catch { return 'production' }
}

function initialEventId() {
  try { return localStorage.getItem('queue-event-id') || '' } catch { return '' }
}

function orderEvents(values) {
  return [...values].sort((a, b) => (timestampToMillis(a.startAt) ?? getEventStartMs(a) ?? 0) - (timestampToMillis(b.startAt) ?? getEventStartMs(b) ?? 0))
}

function getEventStartMs(event) {
  if (!event?.date || !event?.start) return null
  return dateTimeInZone(event.date, event.start)?.getTime() ?? null
}

function getMemberError(error) {
  if (error?.code === 'permission-denied') return 'Firebase Rules keelas liikmeinfo laadimise. Kontrolli Firestore Rules reegleid ja seda, kas UID on kirjas memberRevocations/{UID} loendis.'
  if (error?.code === 'unavailable') return 'Firebase pole hetkel kättesaadav. Kontrolli internetiühendust ja proovi uuesti.'
  return 'Liikmeinfo laadimine ebaõnnestus.'
}

function memberProvisionError(error) {
  if (error?.code === 'permission-denied') return 'Profiili ei saanud luua. Kontrolli Firestore Rules reegleid ja seda, et selle UID jaoks poleks Firebase’is ligipääsu peatamise kirjet.'
  if (error?.code === 'unavailable') return 'Firebase pole hetkel kättesaadav. Kontrolli internetiühendust ja proovi uuesti.'
  return 'Profiili loomine ebaõnnestus. Proovi uuesti.'
}

async function createOwnMemberProfile(database, account, fullName) {
  const memberRef = doc(database, 'members', account.uid)
  const email = String(account.email || '').trim().toLowerCase()
  return runTransaction(database, async transaction => {
    const current = await transaction.get(memberRef)
    if (current.exists()) return false
    transaction.set(memberRef, { email, fullName: fullName.trim(), enabled: true })
    return true
  })
}

function authErrorMessage(error) {
  const errors = {
    'auth/invalid-credential': 'E-post või parool on vale.',
    'auth/invalid-email': 'Sisesta korrektne e-posti aadress.',
    'auth/user-disabled': 'See konto on Firebase’is peatatud.',
    'auth/too-many-requests': 'Liiga palju katseid. Proovi mõne aja pärast uuesti.',
    'auth/network-request-failed': 'Ühendus Firebase’iga katkes. Proovi uuesti.',
    'auth/operation-not-allowed': 'Firebase Authenticationis pole e-posti ja parooliga sisselogimine lubatud.',
    'auth/unauthorized-domain': 'Lisa selle saidi domeen Firebase Authenticationi lubatud domeenide hulka.',
  }
  return errors[error?.code] || 'Toiming ebaõnnestus. Kontrolli andmeid ja proovi uuesti.'
}

function getQueueGroups(items) {
  const groups = []
  for (const item of items) {
    if (isSceneChangeItem(item) && groups.length && !groups[groups.length - 1].transition) {
      groups[groups.length - 1].transition = item
    } else if (isSceneChangeItem(item)) {
      groups.push({ performance: null, transition: item })
    } else {
      groups.push({ performance: item, transition: null })
    }
  }
  return groups
}

function getObservedNoteItems(items, event, mode) {
  if (mode === 'edit') return items.filter(item => !isSceneChangeItem(item))
  if (mode !== 'production' && mode !== 'host') return []
  const currentIndex = items.findIndex(item => item.id === event?.timeline?.itemId)
  const visible = currentIndex >= 0 && !isSceneChangeItem(items[currentIndex]) ? [items[currentIndex]] : []
  const upcoming = items.slice(currentIndex + 1).filter(item => !isSceneChangeItem(item)).slice(0, 5)
  const next = currentIndex < 0 ? items.filter(item => !isSceneChangeItem(item)).slice(0, 5) : upcoming
  return [...visible, ...next]
}

function flattenGroups(groups) {
  return groups.flatMap(group => [group.performance, group.transition].filter(Boolean))
}

function rebaseTimelineAfterQueueEdit(eventData, oldItems, newItems, nowMs, uid) {
  const before = deriveTimeline(eventData, oldItems, nowMs)
  if (!before.itemId) return eventData.timeline || null
  const nextIndex = newItems.findIndex(item => item.id === before.itemId)
  if (nextIndex < 0) return eventData.timeline || null
  const nextStart = getSegmentStarts(newItems)[nextIndex]
  const elapsed = Math.max(0, before.cueElapsedSeconds)
  const reachedEnd = nextStart.duration > 0 && elapsed >= nextStart.duration
  const shouldPlay = before.effectiveStatus === 'playing' && !reachedEnd
  const clampedElapsed = nextStart.duration > 0 ? Math.min(elapsed, nextStart.duration) : 0
  return {
    ...readTimelineState(eventData, oldItems),
    status: shouldPlay ? 'playing' : 'paused',
    itemId: before.itemId,
    positionMs: Math.round((nextStart.start + clampedElapsed) * 1000),
    anchorAt: shouldPlay ? serverTimestamp() : null,
    firstStartedAt: before.firstStartedAt || null,
    commandRevision: before.commandRevision + 1,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  }
}

function validateQueueRows(items) {
  if (items.length > MAX_QUEUE_ITEMS) throw new Error(`Järjekorras saab olla kuni ${MAX_QUEUE_ITEMS} rida.`)
  for (const item of items) {
    if (!isSceneChangeItem(item) && !String(item.title || '').trim()) throw new Error('Esinemise pealkiri on kohustuslik.')
    if (!isValidQueueDuration(item.duration)) throw new Error('Kestus peab olema üle 00:00 ja mitte pikem kui 24 tundi.')
    if (!isSceneChangeItem(item) && item.color && !isValidColor(item.color)) throw new Error('Esinemise värv ei sobi.')
  }
}

function App() {
  const [user, setUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [member, setMember] = useState(null)
  const [membership, setMembership] = useState('loading')
  const [membershipRetry, setMembershipRetry] = useState(0)
  const [memberError, setMemberError] = useState('')
  const [profileError, setProfileError] = useState('')
  const [events, setEvents] = useState([])
  const [eventsReady, setEventsReady] = useState(false)
  const [eventsError, setEventsError] = useState('')
  const [eventId, setEventId] = useState(initialEventId)
  const [eventDoc, setEventDoc] = useState(null)
  const [items, setItems] = useState([])
  const [itemsReady, setItemsReady] = useState(false)
  const [itemsError, setItemsError] = useState('')
  const [notes, setNotes] = useState([])
  const [messages, setMessages] = useState([])
  const [messagesReady, setMessagesReady] = useState(false)
  const [mode, setModeState] = useState(initialMode)
  const [selectedId, setSelectedId] = useState('')
  const [noteFilter, setNoteFilter] = useState('ALL')
  const [noteItem, setNoteItem] = useState(null)
  const [showCreateEvent, setShowCreateEvent] = useState(false)
  const [eventDialogError, setEventDialogError] = useState('')
  const [toast, setToast] = useState('')
  const [authError, setAuthError] = useState('')
  const [authNotice, setAuthNotice] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [operationBusy, setOperationBusy] = useState(false)
  const [noteBusy, setNoteBusy] = useState(false)
  const [clockNow, setClockNow] = useState(Date.now())
  const [clockOffset, setClockOffset] = useState(null)
  const [clockError, setClockError] = useState('')
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const [chatPaneError, setChatPaneError] = useState('')
  const [notesError, setNotesError] = useState('')
  const toastTimer = useRef(null)
  const queueRevisionRef = useRef({ eventId: '', revision: 0 })
  const operationBusyRef = useRef(false)

  const beginOperation = useCallback(() => {
    if (operationBusyRef.current) return false
    operationBusyRef.current = true
    setOperationBusy(true)
    return true
  }, [])

  const finishOperation = useCallback(() => {
    operationBusyRef.current = false
    setOperationBusy(false)
  }, [])

  const setMode = useCallback(next => {
    setModeState(next)
    try { localStorage.setItem('queue-mode', next) } catch { /* Storage is optional. */ }
  }, [])

  const showToast = useCallback(message => {
    setToast(message)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 2800)
  }, [])

  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current) }, [])

  useEffect(() => {
    if (!auth) { setAuthReady(true); return undefined }
    const stop = onAuthStateChanged(auth, next => {
      setUser(next)
      setAuthReady(true)
      setMember(null)
      setMembership(next ? 'loading' : 'signed-out')
      setMemberError('')
    }, error => {
      setAuthReady(true)
      setMemberError(getMemberError(error))
      setMembership('error')
    })
    return stop
  }, [])

  useEffect(() => {
    if (!db || !user) { setMember(null); setMembership('signed-out'); return undefined }
    setMembership('loading')
    let profileCreationStarted = false
    const stop = onSnapshot(doc(db, 'members', user.uid), snapshot => {
      if (!snapshot.exists()) {
        setMember(null)
        if (isValidFullName(user.displayName)) {
          setMembership('provisioning')
          if (!profileCreationStarted && user.email) {
            profileCreationStarted = true
            createOwnMemberProfile(db, user, user.displayName.trim()).then(created => {
              if (!created) setMembershipRetry(value => value + 1)
            }).catch(error => {
              setMemberError(memberProvisionError(error))
              setMembership('error')
            })
          }
        } else {
          setMembership('profile-setup')
        }
        return
      }
      const data = snapshot.data()
      const emailMatches = String(data.email || '').trim().toLowerCase() === String(user.email || '').trim().toLowerCase()
      if (data.enabled !== true || !emailMatches) {
        setMember(null)
        setMembership('not-allowed')
      } else if (!isValidFullName(data.fullName)) {
        setMember(data)
        setMembership('invalid-name')
      } else {
        setMember({ ...data, uid: user.uid })
        setMembership('allowed')
        setMemberError('')
      }
    }, error => {
      setMember(null)
      setMemberError(getMemberError(error))
      setMembership('error')
    })
    return stop
  }, [user?.uid, user?.email, membershipRetry])

  async function handleCreateMemberProfile(fullName) {
    const cleanName = String(fullName || '').trim()
    if (!db || !user?.email || !isValidFullName(cleanName)) {
      setProfileError('Sisesta ees- ja perekonnanimi kahe sõnana.')
      return false
    }
    setProfileError('')
    setMembership('provisioning')
    try {
      const created = await createOwnMemberProfile(db, user, cleanName)
      if (created) {
        const nextMember = { email: user.email.trim().toLowerCase(), fullName: cleanName, enabled: true, uid: user.uid }
        setMember(nextMember)
        setMembership('allowed')
      } else {
        setMembershipRetry(value => value + 1)
      }
      return true
    } catch (error) {
      setProfileError(memberProvisionError(error))
      setMembership('profile-setup')
      return false
    }
  }

  useEffect(() => {
    if (!realtimeDb) { setClockOffset(null); return undefined }
    const stop = onValue(ref(realtimeDb, '.info/serverTimeOffset'), snapshot => {
      const value = snapshot.val()
      if (typeof value === 'number' && Number.isFinite(value)) {
        setClockOffset(value)
        setClockError('')
      } else {
        setClockError('Firebase server clock offset is unavailable.')
      }
    }, error => {
      setClockOffset(null)
      setClockError(error?.message || 'Firebase server clock offset is unavailable.')
    })
    return stop
  }, [])

  useEffect(() => {
    const updateNetwork = () => setOnline(navigator.onLine)
    window.addEventListener('online', updateNetwork)
    window.addEventListener('offline', updateNetwork)
    return () => { window.removeEventListener('online', updateNetwork); window.removeEventListener('offline', updateNetwork) }
  }, [])

  const event = events.find(item => item.id === eventId) || null

  useEffect(() => {
    const activeView = mode === 'production' || mode === 'host'
    if (!activeView || membership !== 'allowed' || !user) return undefined
    const timerState = eventDoc || event
    const playing = deriveTimeline(timerState, items, Date.now() + (clockOffset ?? 0)).effectiveStatus === 'playing'
    // Host deviation follows wall-clock time even while the show timeline is paused.
    if (mode !== 'host' && !playing) return undefined
    const timer = window.setInterval(() => {
      const now = Date.now()
      setClockNow(now)
      if (mode !== 'host' && deriveTimeline(timerState, items, now + (clockOffset ?? 0)).effectiveStatus !== 'playing') window.clearInterval(timer)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [mode, membership, user?.uid, eventId, eventDoc?.timeline, eventDoc?.status, event, items, clockOffset])

  useEffect(() => {
    if (!db || membership !== 'allowed' || !user) {
      setEvents([])
      setEventsReady(false)
      return undefined
    }
    setEventsReady(false)
    const stop = onSnapshot(query(collection(db, 'events'), orderBy('startAt', 'asc'), limit(100)), snapshot => {
      const list = orderEvents(snapshot.docs.map(item => ({ id: item.id, ...item.data() })))
      setEvents(list)
      setEventsReady(true)
      setEventsError('')
    }, error => {
      setEventsReady(true)
      setEventsError(error.code === 'permission-denied'
        ? 'Firebase ei lubanud üritusi laadida. Kontrolli Firestore Rules ja members/{UID} ligipääsu.'
        : `Ürituste laadimine ebaõnnestus (${error.code || 'võrguviga'}).`)
    })
    return stop
  }, [membership, user?.uid])

  useEffect(() => {
    try { localStorage.setItem('queue-event-id', eventId) } catch { /* Storage is optional. */ }
  }, [eventId])

  useEffect(() => {
    if (!eventsReady) return
    if (!events.length) { if (eventId) setEventId(''); return }
    if (!eventId || !events.some(item => item.id === eventId)) setEventId(events[0].id)
  }, [events, eventId, eventsReady])

  useEffect(() => {
    if (!db || membership !== 'allowed' || !eventId) {
      setEventDoc(null); setItems([]); setItemsReady(false); setNotes([]); setMessages([]); setMessagesReady(false)
      return undefined
    }
    setEventDoc(null); setItems([]); setItemsReady(false); setItemsError(''); setNotes([]); setMessages([]); setMessagesReady(false)
    setChatPaneError(''); setNotesError('')
    const stopEvent = onSnapshot(doc(db, 'events', eventId), snapshot => {
      setEventDoc(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null)
    }, error => setEventsError(error.code === 'permission-denied' ? 'Firebase Rules ei luba seda tööruumi avada.' : 'Tööruumi laadimine ebaõnnestus.'))
    const stopItems = onSnapshot(query(collection(db, 'events', eventId, 'items'), orderBy('order', 'asc')), snapshot => {
      const next = snapshot.docs.map(item => ({ id: item.id, ...item.data() }))
      setItems(next)
      setItemsReady(true)
      setItemsError('')
    }, error => {
      setItemsReady(true)
      setItemsError(error.code === 'permission-denied' ? 'Firebase Rules ei luba järjekorda laadida.' : 'Järjekorra laadimine ebaõnnestus.')
    })
    const stopMessages = onSnapshot(query(collection(db, 'events', eventId, 'messages'), where('audience', '==', 'all'), orderBy('createdAt', 'desc'), limit(100)), snapshot => {
      setMessages(snapshot.docs.map(item => ({ id: item.id, ...item.data() })).reverse())
      setMessagesReady(true)
      setChatPaneError('')
    }, error => setChatPaneError(error.code === 'permission-denied' ? 'Firebase Rules ei luba vestlust laadida.' : 'Vestluse laadimine ebaõnnestus.'))
    return () => { stopEvent(); stopItems(); stopMessages() }
  }, [membership, user?.uid, eventId])

  const itemKey = items.map(item => item.id).join('|')
  const observedNoteItems = getObservedNoteItems(items, eventDoc || event, mode)
  const observedNoteKey = observedNoteItems.map(item => item.id).join('|')
  useEffect(() => {
    if (!db || membership !== 'allowed' || !eventId || !observedNoteItems.length) { setNotes([]); return undefined }
    const stops = []
    const sources = new Map()
    const publish = () => {
      const all = [...sources.values()].flat()
      const unique = [...new Map(all.map(note => [note.id, note])).values()]
      const activeIds = new Set(observedNoteItems.map(item => item.id))
      const uniqueIds = new Set(unique.map(note => note.id))
      setNotes(current => [...current.filter(note => activeIds.has(note.itemId) && !uniqueIds.has(note.id)), ...unique])
    }
    observedNoteItems.forEach(item => {
      const base = collection(db, 'events', eventId, 'items', item.id, 'notes')
      const subscribe = (key, sourceQuery) => {
        stops.push(onSnapshot(sourceQuery, snapshot => {
          sources.set(`${item.id}:${key}`, snapshot.docs.map(note => ({ id: note.id, itemId: item.id, ...note.data() })))
          publish()
          setNotesError('')
        }, error => {
          if (error.code !== 'permission-denied') setNotesError('Märkmete laadimine ebaõnnestus.')
          else setNotesError('Firebase Rules ei luba märkmeid laadida.')
        }))
      }
      subscribe('departments', query(base, where('department', 'in', NOTE_QUERY_DEPARTMENTS), orderBy('updatedAt', 'desc')))
      subscribe('legacy', query(base, where('audience', 'in', LEGACY_NOTE_AUDIENCES), orderBy('updatedAt', 'desc')))
    })
    return () => stops.forEach(stop => stop())
  }, [membership, user?.uid, eventId, itemKey, mode, eventDoc?.timeline?.itemId, observedNoteKey])

  useEffect(() => {
    const current = eventId === queueRevisionRef.current.eventId ? queueRevisionRef.current.revision : null
    const revision = Number(event?.queueRevision) || 0
    if (current === null || revision >= current) queueRevisionRef.current = { eventId, revision }
  }, [eventId, event?.queueRevision])

  useEffect(() => {
    if (!items.length) { setSelectedId(''); return }
    setSelectedId(current => items.some(item => item.id === current)
      ? current
      : items.find(item => item.id === eventDoc?.timeline?.itemId)?.id || items.find(item => !isSceneChangeItem(item))?.id || items[0].id)
  }, [itemKey, eventDoc?.timeline?.itemId])

  const serverNow = clockNow + (clockOffset ?? 0)
  const timeline = useMemo(() => deriveTimeline(eventDoc || event, items, serverNow), [eventDoc, event, items, serverNow])
  const currentName = member?.fullName || ''
  const notesByItem = useMemo(() => {
    const output = {}
    for (const note of notes) {
      const department = normalizeLegacyDepartment(note)
      if (!department || note.audience === 'private') continue
      const visible = noteFilter === 'ALL' || department === 'ALL' || department === noteFilter
      if (!visible) continue
      if (!output[note.itemId]) output[note.itemId] = []
      output[note.itemId].push({ ...note, department })
    }
    for (const value of Object.values(output)) value.sort((a, b) => (timestampToMillis(b.updatedAt) || 0) - (timestampToMillis(a.updatedAt) || 0))
    return output
  }, [notes, noteFilter])
  const allNotesByItem = useMemo(() => {
    const output = {}
    for (const note of notes) {
      const department = normalizeLegacyDepartment(note)
      if (!department || note.audience === 'private') continue
      if (!output[note.itemId]) output[note.itemId] = []
      output[note.itemId].push({ ...note, department })
    }
    for (const value of Object.values(output)) value.sort((a, b) => (timestampToMillis(b.updatedAt) || 0) - (timestampToMillis(a.updatedAt) || 0))
    return output
  }, [notes])

  async function handleLogin(e) {
    e.preventDefault(); setAuthError(''); setAuthNotice(''); setAuthBusy(true)
    const data = new FormData(e.currentTarget)
    try {
      if (!auth || !isFirebaseConfigured) throw new Error('Firebase Web Appi seaded puuduvad.')
      await signInWithEmailAndPassword(auth, String(data.get('email') || '').trim().toLowerCase(), String(data.get('password') || ''))
    } catch (error) { setAuthError(error.code ? authErrorMessage(error) : error.message || 'Sisselogimine ebaõnnestus.') }
    finally { setAuthBusy(false) }
  }

  async function handlePasswordReset(email) {
    setAuthError(''); setAuthNotice('')
    const address = String(email || '').trim()
    if (!address) { setAuthError('Sisesta kõigepealt e-posti aadress.'); return false }
    try {
      await sendPasswordResetEmail(auth, address)
      setAuthNotice('Kui selle aadressiga konto on olemas, saatsime parooli seadistamise lingi postkasti.')
      return true
    } catch (error) { setAuthError(authErrorMessage(error)); return false }
  }

  async function logout() {
    try { await signOut(auth) } catch { showToast('Väljalogimine ebaõnnestus. Proovi uuesti.') }
  }

  async function commitTimelineAction(action, targetId = null) {
    if (!db || !user || !event || !items.length || !online || !beginOperation()) return
    const eventRef = doc(db, 'events', eventId)
    const revision = eventId === queueRevisionRef.current.eventId ? queueRevisionRef.current.revision : Number(event.queueRevision) || 0
    const localStarts = getSegmentStarts(items)
    try {
      await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(eventRef)
        if (!snapshot.exists()) throw new Error('Tööruum kustutati või muudeti Firebase’is.')
        const remote = snapshot.data()
        if ((Number(remote.queueRevision) || 0) !== revision) throw new Error('Järjekord muutus teises seadmes. Oota sünkroonimist ja proovi uuesti.')
        const state = deriveTimeline(remote, items, Date.now() + (clockOffset ?? 0))
        let next = readTimelineState(remote, items)
        const commitAt = serverTimestamp()
        const starts = localStarts
        const firstPerformanceIndex = items.findIndex(item => !isSceneChangeItem(item))
        const firstPerformance = firstPerformanceIndex >= 0 ? items[firstPerformanceIndex] : items[0]
        const firstPosition = firstPerformanceIndex >= 0 ? starts[firstPerformanceIndex].start * 1000 : 0

        if (action === 'toggle') {
          if (state.effectiveStatus === 'playing' && state.status === 'playing') {
            next = { ...next, status: 'paused', positionMs: state.positionMs, anchorAt: null }
          } else if (state.currentIndex >= 0 && state.positionSeconds >= state.segmentEndSeconds - 0.05) {
            const nextIndex = state.currentIndex + 1
            if (nextIndex < items.length) {
              next = { ...next, status: 'playing', itemId: items[nextIndex].id, positionMs: starts[nextIndex].start * 1000, anchorAt: commitAt, firstStartedAt: next.firstStartedAt || commitAt }
            } else {
              next = { ...next, status: 'paused', itemId: firstPerformance.id, positionMs: firstPosition, anchorAt: null }
            }
          } else if (state.status === 'ended') {
            next = { ...next, status: 'paused', itemId: firstPerformance.id, positionMs: firstPosition, anchorAt: null }
          } else {
            const itemId = state.itemId || firstPerformance.id
            const itemIndex = items.findIndex(item => item.id === itemId)
            const positionMs = state.itemId ? state.positionMs : (starts[itemIndex]?.start || 0) * 1000
            next = { ...next, status: 'playing', itemId, positionMs, anchorAt: commitAt, firstStartedAt: next.firstStartedAt || commitAt }
          }
        } else {
          const targetIndex = action === 'back' ? state.currentIndex - 1 : action === 'forward' ? state.currentIndex + 1 : items.findIndex(item => item.id === targetId)
          if (action === 'back' && state.currentIndex <= 0) {
            next = { ...next, status: 'paused', itemId: firstPerformance.id, positionMs: firstPosition, anchorAt: null }
          } else if (targetIndex < 0 || targetIndex >= items.length) {
            throw new Error('Valitud cue ei kuulu enam selle järjekorra juurde.')
          } else {
            const continuePlaying = state.effectiveStatus === 'playing'
            next = {
              ...next,
              status: continuePlaying ? 'playing' : 'paused',
              itemId: items[targetIndex].id,
              positionMs: starts[targetIndex].start * 1000,
              anchorAt: continuePlaying ? commitAt : null,
              firstStartedAt: next.firstStartedAt || null,
            }
          }
        }
        next.commandRevision = (Number(state.commandRevision) || 0) + 1
        next.updatedAt = commitAt
        next.updatedBy = user.uid
        transaction.update(eventRef, { timeline: next, updatedAt: commitAt, updatedBy: user.uid })
      })
    } catch (error) { showToast(error.message?.replace(/^Firebase:\s*/, '') || 'Ajatelje käsk ebaõnnestus.') }
    finally { finishOperation() }
  }

  async function saveEvent(values) {
    if (!db || !user || !event) return false
    const title = String(values.title || '').trim()
    if (!title || !values.date || !values.start) { showToast('Nimi, kuupäev ja algusaeg on kohustuslikud.'); return false }
    const startDate = dateTimeInZone(values.date, values.start)
    if (!startDate) { showToast('Algusaeg ei sobi või seda kohalikku aega ei eksisteeri.'); return false }
    if (!beginOperation()) return false
    try {
      await runTransaction(db, async transaction => {
        const snapshot = await transaction.get(doc(db, 'events', eventId))
        if (!snapshot.exists()) throw new Error('Üritust ei leitud.')
        transaction.update(doc(db, 'events', eventId), {
          title,
          venue: String(values.venue || '').trim(),
          date: values.date,
          start: values.start,
          startAt: Timestamp.fromDate(startDate),
          updatedAt: serverTimestamp(),
          updatedBy: user.uid,
        })
      })
      showToast('Ürituse seaded salvestatud')
      return true
    } catch (error) { showToast(error.message?.replace(/^Firebase:\s*/, '') || 'Ürituse seadete salvestamine ebaõnnestus.'); return false }
    finally { finishOperation() }
  }

  async function createEvent(values) {
    if (!db || !user) return false
    const title = String(values.title || '').trim()
    const date = String(values.date || '')
    const start = String(values.start || '')
    const startAtDate = dateTimeInZone(date, start)
    if (!title || !date || !start || !startAtDate) {
      setEventDialogError('Sisesta ürituse nimi, kuupäev ja algusaeg.')
      return false
    }
    setEventDialogError('')
    if (!beginOperation()) return false
    try {
      const eventRef = doc(collection(db, 'events'))
      const batch = writeBatch(db)
      batch.set(eventRef, {
        title,
        venue: String(values.venue || '').trim(),
        date,
        start,
        startAt: Timestamp.fromDate(startAtDate),
        queueRevision: 0,
        timeline: { status: 'scheduled', itemId: null, positionMs: 0, anchorAt: null, firstStartedAt: null, commandRevision: 0, updatedAt: serverTimestamp(), updatedBy: user.uid },
        createdAt: serverTimestamp(),
        createdBy: user.uid,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
      })
      await batch.commit()
      setEventId(eventRef.id)
      setMode('edit')
      setShowCreateEvent(false)
      setEventDialogError('')
      setItems([])
      showToast('Tööruum loodud')
      return true
    } catch (error) {
      const message = error.code === 'permission-denied'
        ? 'Firebase Rules ei luba üritust luua. Kontrolli, et sinu UID on members nimekirjas.'
        : 'Ürituse loomine ebaõnnestus.'
      setEventDialogError(message)
      return false
    } finally { finishOperation() }
  }

  async function saveNote(item, note, values) {
    if (!db || !user || !item || !NOTE_DEPARTMENTS.includes(values.department)) return false
    const body = String(values.body || '').trim()
    if (!body) return false
    setNoteBusy(true)
    try {
      if (note) {
        await updateDoc(doc(db, 'events', eventId, 'items', item.id, 'notes', note.id), { body, department: values.department, updatedAt: serverTimestamp() })
      } else {
        await addDoc(collection(db, 'events', eventId, 'items', item.id, 'notes'), {
          body, department: values.department, authorId: user.uid, author: member.fullName, updatedAt: serverTimestamp(),
        })
      }
      setNoteItem(null)
      showToast(note ? 'Märkus uuendatud' : 'Märkus salvestatud')
      return true
    } catch (error) {
      showToast(error.code === 'permission-denied' ? 'Firebase Rules keelas märkuse salvestamise.' : 'Märkuse salvestamine ebaõnnestus.')
      return false
    } finally { setNoteBusy(false) }
  }

  async function deleteNote(item, note) {
    if (!db || !user || !item || !note) return false
    setNoteBusy(true)
    try {
      await deleteDoc(doc(db, 'events', eventId, 'items', item.id, 'notes', note.id))
      showToast('Märkus kustutatud')
      return true
    } catch (error) {
      showToast(error.code === 'permission-denied' ? 'Firebase Rules keelas märkuse kustutamise.' : 'Märkuse kustutamine ebaõnnestus.')
      return false
    } finally { setNoteBusy(false) }
  }

  async function sendMessage(body, important = false) {
    if (!db || !user || !body.trim() || !online) return false
    try {
      await addDoc(collection(db, 'events', eventId, 'messages'), {
        body: body.trim(), audience: 'all', author: member.fullName, authorId: user.uid,
        ...(important === true ? { important: true } : {}), createdAt: serverTimestamp(),
      })
      return true
    } catch (error) {
      showToast(error.code === 'permission-denied' ? 'Firebase Rules keelas sõnumi saatmise.' : 'Sõnumi saatmine ebaõnnestus.')
      return false
    }
  }

  async function saveItem(itemId, values) {
    if (!db || !user) return false
    const title = String(values.title || '').trim()
    const duration = String(values.duration || '').trim()
    if (!isSceneChangeItem(items.find(item => item.id === itemId)) && !title) { showToast('Esinemise pealkiri on kohustuslik.'); return false }
    if (!isValidQueueDuration(duration)) { showToast('Kestus peab olema üle 00:00 ja mitte pikem kui 24 tundi.'); return false }
    const itemRef = doc(db, 'events', eventId, 'items', itemId)
    const eventRef = doc(db, 'events', eventId)
    const itemRefs = items.map(item => doc(db, 'events', eventId, 'items', item.id))
    const revision = eventId === queueRevisionRef.current.eventId ? queueRevisionRef.current.revision : Number(event?.queueRevision) || 0
    if (!beginOperation()) return false
    try {
      await runTransaction(db, async transaction => {
        const eventSnapshot = await transaction.get(eventRef)
        if (!eventSnapshot.exists()) throw new Error('Üritust ei leitud.')
        const remote = eventSnapshot.data()
        if ((Number(remote.queueRevision) || 0) !== revision) throw new Error('Järjekord muutus teises seadmes. Oota sünkroonimist ja proovi uuesti.')
        const snapshots = []
        for (const itemDocRef of itemRefs) snapshots.push(await transaction.get(itemDocRef))
        const rows = snapshots.filter(snapshot => snapshot.exists()).map(snapshot => ({ id: snapshot.id, ...snapshot.data() })).sort((a, b) => a.order - b.order)
        if (rows.length !== items.length || !rows.some(row => row.id === itemId)) throw new Error('Järjekord muutus salvestamise ajal. Laadi see uuesti.')
        const rowIndex = rows.findIndex(row => row.id === itemId)
        const row = rows[rowIndex]
        const nextRow = isSceneChangeItem(row)
          ? { duration }
          : { title, performer: String(values.performer || '').trim(), duration, color: isValidColor(values.color) ? values.color : row.color || DEFAULT_COLORS[rowIndex % DEFAULT_COLORS.length] }
        const nextRows = rows.map(candidate => candidate.id === itemId ? { ...candidate, ...nextRow } : candidate)
        validateQueueRows(nextRows)
        transaction.update(itemRef, nextRow)
        const nextRevision = revision + 1
        const nextTimeline = rebaseTimelineAfterQueueEdit(remote, rows, nextRows, Date.now() + (clockOffset ?? 0), user.uid)
        transaction.update(eventRef, {
          queueRevision: nextRevision,
          ...(nextTimeline ? { timeline: nextTimeline } : {}),
          updatedAt: serverTimestamp(), updatedBy: user.uid,
        })
      })
      queueRevisionRef.current = { eventId, revision: revision + 1 }
      setEvents(current => current.map(item => item.id === eventId ? { ...item, queueRevision: revision + 1 } : item))
      showToast('Rida salvestatud')
      return true
    } catch (error) { showToast(error.message?.replace(/^Firebase:\s*/, '') || 'Rea salvestamine ebaõnnestus.'); return false }
    finally { finishOperation() }
  }

  async function addQueueItem(values, requestedIndex = items.length) {
    if (!db || !user) return false
    const isTransition = values.type === 'scene-change'
    const newItem = {
      title: isTransition ? 'Lava vahetus' : String(values.title || '').trim(),
      performer: isTransition ? '' : String(values.performer || '').trim(),
      description: '',
      duration: String(values.duration || '').trim() || (isTransition ? '01:00' : '03:00'),
      type: isTransition ? 'scene-change' : 'performance',
      order: 0,
      color: isTransition ? '#59616c' : (isValidColor(values.color) ? values.color : DEFAULT_COLORS[items.length % DEFAULT_COLORS.length]),
      createdAt: serverTimestamp(),
    }
    if (!isTransition && !newItem.title) return false
    if (!isValidQueueDuration(newItem.duration)) { showToast('Kestus peab olema üle 00:00 ja mitte pikem kui 24 tundi.'); return false }
    if (items.length >= MAX_QUEUE_ITEMS) { showToast(`Järjekorras saab olla kuni ${MAX_QUEUE_ITEMS} rida.`); return false }
    let insertAt = Math.max(0, Math.min(items.length, Number.isInteger(requestedIndex) ? requestedIndex : items.length))
    const entries = []
    if (!isTransition && insertAt === items.length && items.some(item => !isSceneChangeItem(item)) && !isSceneChangeItem(items[items.length - 1])) {
      entries.push({ title: 'Lava vahetus', performer: '', description: '', duration: '01:00', type: 'scene-change', order: 0, color: '#59616c', createdAt: serverTimestamp() })
    }
    entries.push(newItem)
    const references = items.map(item => doc(db, 'events', eventId, 'items', item.id))
    const newReferences = entries.map(() => doc(collection(db, 'events', eventId, 'items')))
    const eventRef = doc(db, 'events', eventId)
    const revision = eventId === queueRevisionRef.current.eventId ? queueRevisionRef.current.revision : Number(event?.queueRevision) || 0
    if (!beginOperation()) return false
    try {
      await runTransaction(db, async transaction => {
        const eventSnapshot = await transaction.get(eventRef)
        if (!eventSnapshot.exists()) throw new Error('Üritust ei leitud.')
        const remote = eventSnapshot.data()
        if ((Number(remote.queueRevision) || 0) !== revision) throw new Error('Järjekord muutus teises seadmes. Oota sünkroonimist ja proovi uuesti.')
        const snapshots = []
        for (const itemDocRef of references) snapshots.push(await transaction.get(itemDocRef))
        const rows = snapshots.filter(snapshot => snapshot.exists()).map(snapshot => ({ id: snapshot.id, ...snapshot.data() })).sort((a, b) => a.order - b.order)
        if (rows.length !== items.length) throw new Error('Järjekord muutus lisamise ajal. Proovi uuesti.')
        if (insertAt > rows.length) insertAt = rows.length
        const nextRows = [...rows]
        const createdRows = entries.map((entry, index) => ({ ...entry, id: newReferences[index].id }))
        nextRows.splice(insertAt, 0, ...createdRows)
        validateQueueRows(nextRows)
        rows.forEach((row, index) => {
          const nextOrder = index < insertAt ? index : index + createdRows.length
          if (row.order !== nextOrder) transaction.update(references.find(refDoc => refDoc.id === row.id), { order: nextOrder })
        })
        entries.forEach((entry, index) => transaction.set(newReferences[index], { ...entry, order: insertAt + index }))
        const nextTimeline = rebaseTimelineAfterQueueEdit(remote, rows, nextRows, Date.now() + (clockOffset ?? 0), user.uid)
        transaction.update(eventRef, {
          queueRevision: revision + 1,
          ...(nextTimeline ? { timeline: nextTimeline } : {}),
          updatedAt: serverTimestamp(), updatedBy: user.uid,
        })
      })
      queueRevisionRef.current = { eventId, revision: revision + 1 }
      setEvents(current => current.map(item => item.id === eventId ? { ...item, queueRevision: revision + 1 } : item))
      showToast(isTransition ? 'Lava vahetus lisatud' : 'Esinemine lisatud')
      return true
    } catch (error) { showToast(error.message?.replace(/^Firebase:\s*/, '') || 'Järjekorda ei saanud muuta.'); return false }
    finally { finishOperation() }
  }

  async function deleteItem(itemId) {
    if (!db || !user) return false
    const rowIndex = items.findIndex(item => item.id === itemId)
    if (rowIndex < 0) return false
    const state = deriveTimeline(eventDoc || event, items, serverNow)
    if (state.itemId === itemId) { showToast('Laval olevat segmenti ei saa eemaldada.'); return false }
    const deleteIds = [itemId]
    if (!isSceneChangeItem(items[rowIndex])) {
      if (isSceneChangeItem(items[rowIndex + 1])) deleteIds.push(items[rowIndex + 1].id)
      else if (rowIndex === items.length - 1 && isSceneChangeItem(items[rowIndex - 1])) deleteIds.push(items[rowIndex - 1].id)
    }
    if (!beginOperation()) return false
    const revision = eventId === queueRevisionRef.current.eventId ? queueRevisionRef.current.revision : Number(event?.queueRevision) || 0
    const eventRef = doc(db, 'events', eventId)
    const refs = items.map(item => doc(db, 'events', eventId, 'items', item.id))
    try {
      const noteRefs = []
      for (const id of deleteIds) {
        const noteCollection = collection(db, 'events', eventId, 'items', id, 'notes')
        const [departmentNotes, legacyNotes] = await Promise.all([
          getDocs(query(noteCollection, where('department', 'in', NOTE_QUERY_DEPARTMENTS))),
          getDocs(query(noteCollection, where('audience', 'in', LEGACY_NOTE_AUDIENCES))),
        ])
        for (const snapshot of [...departmentNotes.docs, ...legacyNotes.docs]) noteRefs.push(snapshot.ref)
      }
      await runTransaction(db, async transaction => {
        const eventSnapshot = await transaction.get(eventRef)
        if (!eventSnapshot.exists()) throw new Error('Üritust ei leitud.')
        const remote = eventSnapshot.data()
        if ((Number(remote.queueRevision) || 0) !== revision) throw new Error('Järjekord muutus teises seadmes. Oota sünkroonimist ja proovi uuesti.')
        const snapshots = []
        for (const itemRef of refs) snapshots.push(await transaction.get(itemRef))
        const rows = snapshots.filter(snapshot => snapshot.exists()).map(snapshot => ({ id: snapshot.id, ...snapshot.data() })).sort((a, b) => a.order - b.order)
        const current = deriveTimeline(remote, rows, Date.now() + (clockOffset ?? 0))
        if (deleteIds.includes(current.itemId)) throw new Error('Laval olevat segmenti ei saa eemaldada.')
        const nextRows = rows.filter(row => !deleteIds.includes(row.id)).map((row, order) => ({ ...row, order }))
        const noteSnapshots = []
        for (const noteRef of noteRefs) noteSnapshots.push(await transaction.get(noteRef))
        noteSnapshots.forEach((snapshot, index) => { if (snapshot.exists()) transaction.delete(noteRefs[index]) })
        rows.forEach((row, index) => {
          const reference = refs.find(itemRef => itemRef.id === row.id)
          if (deleteIds.includes(row.id)) transaction.delete(reference)
          else if (row.order !== nextRows.find(candidate => candidate.id === row.id).order) transaction.update(reference, { order: nextRows.find(candidate => candidate.id === row.id).order })
        })
        const nextTimeline = rebaseTimelineAfterQueueEdit(remote, rows, nextRows, Date.now() + (clockOffset ?? 0), user.uid)
        transaction.update(eventRef, {
          queueRevision: revision + 1,
          ...(nextTimeline ? { timeline: nextTimeline } : {}),
          updatedAt: serverTimestamp(), updatedBy: user.uid,
        })
      })
      queueRevisionRef.current = { eventId, revision: revision + 1 }
      setEvents(current => current.map(item => item.id === eventId ? { ...item, queueRevision: revision + 1 } : item))
      showToast('Järjekorra segment eemaldatud')
      return true
    } catch (error) { showToast(error.message?.replace(/^Firebase:\s*/, '') || 'Segmenti ei saanud eemaldada.'); return false }
    finally { finishOperation() }
  }

  async function moveItem(itemId, targetId) {
    if (!db || !user || itemId === targetId) return false
    const eventRef = doc(db, 'events', eventId)
    const refs = items.map(item => doc(db, 'events', eventId, 'items', item.id))
    const revision = eventId === queueRevisionRef.current.eventId ? queueRevisionRef.current.revision : Number(event?.queueRevision) || 0
    if (!beginOperation()) return false
    try {
      await runTransaction(db, async transaction => {
        const eventSnapshot = await transaction.get(eventRef)
        if (!eventSnapshot.exists()) throw new Error('Üritust ei leitud.')
        const remote = eventSnapshot.data()
        if ((Number(remote.queueRevision) || 0) !== revision) throw new Error('Järjekord muutus teises seadmes. Oota sünkroonimist ja proovi uuesti.')
        const snapshots = []
        for (const reference of refs) snapshots.push(await transaction.get(reference))
        const rows = snapshots.filter(snapshot => snapshot.exists()).map(snapshot => ({ id: snapshot.id, ...snapshot.data() })).sort((a, b) => a.order - b.order)
        if (rows.length !== items.length) throw new Error('Järjekord muutus lohistamise ajal. Proovi uuesti.')
        const groups = getQueueGroups(rows)
        const from = groups.findIndex(group => group.performance?.id === itemId)
        const target = groups.findIndex(group => group.performance?.id === targetId)
        if (from < 0 || target < 0) throw new Error('Esinemist ei leitud.')
        const [moving] = groups.splice(from, 1)
        const targetAfterRemoval = groups.findIndex(group => group.performance?.id === targetId)
        const insertAt = from < target ? targetAfterRemoval + 1 : targetAfterRemoval
        groups.splice(insertAt, 0, moving)
        const reordered = flattenGroups(groups)
        const nextRows = reordered.map((row, order) => ({ ...row, order }))
        validateQueueRows(nextRows)
        nextRows.forEach((row, index) => {
          const old = rows.find(candidate => candidate.id === row.id)
          if (old.order !== index) transaction.update(refs.find(reference => reference.id === row.id), { order: index })
        })
        const nextTimeline = rebaseTimelineAfterQueueEdit(remote, rows, nextRows, Date.now() + (clockOffset ?? 0), user.uid)
        transaction.update(eventRef, {
          queueRevision: revision + 1,
          ...(nextTimeline ? { timeline: nextTimeline } : {}),
          updatedAt: serverTimestamp(), updatedBy: user.uid,
        })
      })
      queueRevisionRef.current = { eventId, revision: revision + 1 }
      setEvents(current => current.map(item => item.id === eventId ? { ...item, queueRevision: revision + 1 } : item))
      return true
    } catch (error) { showToast(error.message?.replace(/^Firebase:\s*/, '') || 'Järjekorra muutmine ebaõnnestus.'); return false }
    finally { finishOperation() }
  }

  const clockWarning = !isServerClockConfigured
    ? 'Serverikella sünkroonimine puudub. Lisa Firebase Realtime Database URL.'
    : clockError || (clockOffset === null ? 'Serverikell laeb…' : '')
  const hostClockReady = isServerClockConfigured && clockOffset !== null && !clockError

  if (!authReady) return <main className="q-auth-screen"><section className="q-auth-card"><QueueMarkPlaceholder/>Queue laadib…</section></main>
  if (!user) return <AuthScreen configured={isFirebaseConfigured} busy={authBusy} error={authError} notice={authNotice} onLogin={handleLogin} onReset={handlePasswordReset}/>
  if (membership === 'loading' || membership === 'provisioning') return <main className="q-auth-screen"><section className="q-auth-card"><QueueMarkPlaceholder/>{membership === 'provisioning' ? 'Loon kasutajaprofiili…' : 'Kontrollin ligipääsu…'}</section></main>
  if (membership === 'error') return <AccessScreen status="error" error={memberError} onRetry={() => { setMemberError(''); setMembershipRetry(value => value + 1) }} onSignOut={logout}/>
  if (membership === 'profile-setup') return <MemberSetupScreen email={user.email} busy={false} error={profileError} onCreate={handleCreateMemberProfile} onSignOut={logout}/>
  if (membership !== 'allowed') return <AccessScreen status={membership} onRetry={() => { setMemberError(''); setMembershipRetry(value => value + 1) }} onSignOut={logout}/>

  return <AppShell mode={mode} setMode={setMode} member={member} onOpenSettings={() => setMode('settings')}>
    {!online && <div className="q-banner" role="alert">Internetiühendus katkes. Muudatused jõustuvad pärast ühenduse taastumist; Host käsud on peatatud.</div>}
    {eventsError && <div className="q-banner" role="alert">{eventsError}</div>}
    {itemsError && <div className="q-banner" role="alert">{itemsError}</div>}
    {notesError && <div className="q-banner" role="alert">{notesError}</div>}
    {mode === 'settings' ? <SettingsPage events={events} selectedEventId={eventId} member={member} onSelectEvent={id => { setEventId(id); setMode('production') }} onCreateEvent={() => { setEventDialogError(''); setShowCreateEvent(true) }} onSignOut={logout}/> : !event ? <section className="q-empty-workspace"><h1>{eventsReady ? 'Tööruumi pole valitud' : 'Laen tööruume…'}</h1>{eventsReady && <button className="q-button q-button--primary" onClick={() => setMode('settings')}><Settings2 size={15}/>Ava tööruumid</button>}</section> : mode === 'edit' ? <QueueEditor event={eventDoc || event} items={items} notesByItem={allNotesByItem} noteBusy={noteBusy} onAddNote={item => setNoteItem({ item, note: null })} onEditNote={(item, note) => setNoteItem({ item, note })} onDeleteNote={deleteNote} queueRevision={event.queueRevision} onSaveItem={saveItem} onDeleteItem={deleteItem} onMoveItem={moveItem} onAddItem={addQueueItem} onSaveEvent={saveEvent}/> : (mode === 'production' || mode === 'host') ? (
      !itemsReady ? <div className="q-empty-workspace">Laen järjekorda…</div> : <>
        <ProductionView
          mode={mode}
          event={eventDoc || event}
          items={items}
          timeline={timeline}
          serverNow={serverNow}
          selectedId={selectedId}
          onSelect={setSelectedId}
          notesByItem={notesByItem}
          noteFilter={noteFilter}
          setNoteFilter={setNoteFilter}
          messages={messages}
          messagesReady={messagesReady}
          eventId={eventId}
          currentName={currentName}
          chatError={chatPaneError}
          onSendMessage={sendMessage}
          onSkipBack={() => commitTimelineAction('back')}
          onSkipForward={() => commitTimelineAction('forward')}
          onTogglePlay={() => commitTimelineAction('toggle')}
          onJumpSelected={() => commitTimelineAction('jump', selectedId)}
          busy={operationBusy || !online || (mode === 'host' && !hostClockReady)}
          clockWarning={clockWarning}
        />
      </>
    ) : null}
    {showCreateEvent && <CreateEventDialog onClose={() => { setShowCreateEvent(false); setEventDialogError('') }} onCreate={createEvent} busy={operationBusy} error={eventDialogError}/>}
    {mode === 'edit' && noteItem && <NoteDialog key={`${noteItem.item.id}:${noteItem.note?.id || 'new'}`} item={noteItem.item} note={noteItem.note} onClose={() => setNoteItem(null)} onSave={values => saveNote(noteItem.item, noteItem.note, values)} busy={noteBusy} error=""/>}
    {toast && <div className="q-toast" role="status">{toast}</div>}
  </AppShell>
}

function QueueMarkPlaceholder() {
  return <div className="q-brand"><span className="q-brand-mark">Q</span><strong>QUEUE</strong></div>
}

export default App
