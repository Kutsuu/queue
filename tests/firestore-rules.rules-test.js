import test from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp, deleteApp } from 'firebase/app'
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signOut } from 'firebase/auth'
import {
  collection, connectFirestoreEmulator, deleteDoc, doc, getDoc, getDocs, getFirestore, orderBy,
  query, runTransaction, serverTimestamp, setDoc, updateDoc,
} from 'firebase/firestore'

const projectId = 'demo-queue-rules'
const firestoreBase = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`
const now = new Date().toISOString()
const apps = []

function encodeFirestoreValue(value) {
  if (value === null) return { nullValue: null }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeFirestoreValue) } }
  if (value instanceof Date) return { timestampValue: value.toISOString() }
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, child]) => [key, encodeFirestoreValue(child)])) } }
}

async function seedDocument(path, data) {
  const response = await fetch(`${firestoreBase}/${path}`, {
    method: 'PATCH',
    headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encodeFirestoreValue(value)])) }),
  })
  if (!response.ok) throw new Error(`Could not seed Firestore emulator (${response.status}): ${await response.text()}`)
}

async function createClient(email, appName) {
  const app = initializeApp({ apiKey: 'fake-api-key', authDomain: `${projectId}.firebaseapp.com`, projectId }, appName)
  apps.push(app)
  const auth = getAuth(app)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  const credential = await createUserWithEmailAndPassword(auth, email, 'QueueTestPass123!')
  const db = getFirestore(app)
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  return { app, auth, db, user: credential.user }
}

test('Firestore Rules enforce member allow-list, scoped notes, queue validation, and timeline integrity', { timeout: 60_000 }, async () => {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const memberEmail = `member-${runId}@example.test`
  const outsiderEmail = `outsider-${runId}@example.test`
  const disabledEmail = `disabled-${runId}@example.test`
  const member = await createClient(memberEmail, `member-${runId}`)
  const outsider = await createClient(outsiderEmail, `outsider-${runId}`)
  const disabled = await createClient(disabledEmail, `disabled-${runId}`)
  const eventId = `event-${runId}`
  const itemId = `item-${runId}`

  await seedDocument(`members/${member.user.uid}`, { enabled: true, email: memberEmail, fullName: 'Test Member' })
  await seedDocument(`members/${disabled.user.uid}`, { enabled: false, email: disabledEmail, fullName: 'Disabled Member' })
  await seedDocument(`events/${eventId}`, {
    title: 'Rules test', venue: '', date: '2026-11-01', start: '18:00', startAt: new Date('2026-11-01T16:00:00.000Z'),
    queueRevision: 0,
    timeline: { status: 'scheduled', itemId: null, positionMs: 0, anchorAt: null, firstStartedAt: null, commandRevision: 0, updatedAt: new Date(now), updatedBy: member.user.uid },
    createdAt: new Date(now), createdBy: member.user.uid, updatedAt: new Date(now), updatedBy: member.user.uid,
  })
  await seedDocument(`events/${eventId}/items/${itemId}`, {
    title: 'Act', performer: '', description: '', duration: '03:00', type: 'performance', order: 0, color: '#7645ff', createdAt: new Date(now),
  })
  await seedDocument(`events/${eventId}/items/${itemId}/notes/private-note`, { body: 'private legacy note', audience: 'private' })

  const eventRef = doc(member.db, 'events', eventId)
  const itemRef = doc(member.db, 'events', eventId, 'items', itemId)
  const memberRef = doc(member.db, 'members', member.user.uid)
  const directoryRef = doc(member.db, 'memberDirectory', member.user.uid)
  assert.equal((await getDoc(eventRef)).exists(), true, 'active member should read event')
  assert.equal((await getDocs(query(collection(member.db, 'events'), orderBy('startAt', 'asc')))).size, 1, 'active member should list events')
  assert.equal((await getDoc(memberRef)).exists(), true, 'member should read only their own member record')
  await assert.rejects(getDocs(collection(member.db, 'members')), error => error.code === 'permission-denied')
  await setDoc(directoryRef, { fullName: 'Test Member', lastSeenAt: serverTimestamp() })
  const directory = await getDocs(collection(member.db, 'memberDirectory'))
  assert.equal(directory.size, 1, 'members should read the private-field-free team directory')
  assert.equal('email' in directory.docs[0].data(), false, 'team directory should not expose member emails')
  await updateDoc(memberRef, { color: '#2a89f5' })
  assert.equal((await getDoc(memberRef)).data().color, '#2a89f5', 'member should be able to set their own valid chat color')
  await assert.rejects(updateDoc(memberRef, { color: 'blue' }), error => error.code === 'permission-denied')
  await assert.rejects(updateDoc(directoryRef, { fullName: 'Impersonated Name' }), error => error.code === 'permission-denied')
  await runTransaction(member.db, async transaction => {
    await transaction.get(memberRef)
    await transaction.get(directoryRef)
    transaction.update(memberRef, { fullName: 'Renamed Member' })
    transaction.update(directoryRef, { fullName: 'Renamed Member', lastSeenAt: serverTimestamp() })
  })
  assert.equal((await getDoc(directoryRef)).data().fullName, 'Renamed Member', 'profile rename should update the shared name by member ID')
  await assert.rejects(getDoc(doc(member.db, 'members', outsider.user.uid)), error => error.code === 'permission-denied')
  await assert.rejects(getDoc(doc(member.db, 'events', eventId, 'items', itemId, 'notes', 'private-note')), error => error.code === 'permission-denied')
  await assert.rejects(getDoc(doc(outsider.db, 'events', eventId)), error => error.code === 'permission-denied')
  await assert.rejects(getDoc(doc(disabled.db, 'events', eventId)), error => error.code === 'permission-denied')

  const noteRef = doc(collection(member.db, 'events', eventId, 'items', itemId, 'notes'))
  await setDoc(noteRef, { body: 'Sound cue checked', department: 'HELI', authorId: member.user.uid, author: 'Renamed Member', updatedAt: serverTimestamp() })
  assert.equal((await getDoc(noteRef)).data().body, 'Sound cue checked', 'members should read valid department notes')
  await assert.rejects(updateDoc(noteRef, { author: 'Impersonated User' }), error => error.code === 'permission-denied')
  const messageRef = doc(collection(member.db, 'events', eventId, 'messages'))
  await setDoc(messageRef, { body: 'Color test', audience: 'all', author: 'Renamed Member', authorId: member.user.uid, authorColor: '#2a89f5', createdAt: serverTimestamp() })
  assert.equal((await getDoc(messageRef)).data().authorColor, '#2a89f5', 'member should send chat messages with their saved color')
  await assert.rejects(setDoc(doc(collection(member.db, 'events', eventId, 'messages')), {
    body: 'Spoofed color', audience: 'all', author: 'Renamed Member', authorId: member.user.uid, authorColor: '#ff0000', createdAt: serverTimestamp(),
  }), error => error.code === 'permission-denied')
  await assert.rejects(setDoc(doc(collection(member.db, 'events', eventId, 'items')), {
    title: 'Zero length', performer: '', description: '', duration: '00:00', type: 'performance', order: 1, color: '#7645ff', createdAt: serverTimestamp(),
  }), error => error.code === 'permission-denied')
  await assert.rejects(setDoc(doc(member.db, 'events', eventId, 'items', `unrevisioned-${runId}`), {
    title: 'Unrevisioned write', performer: '', description: '', duration: '00:01', type: 'performance', order: 1, color: '#7645ff', createdAt: serverTimestamp(),
  }), error => error.code === 'permission-denied')
  await assert.rejects(updateDoc(eventRef, { createdBy: outsider.user.uid }), error => error.code === 'permission-denied')
  const validItemRef = doc(member.db, 'events', eventId, 'items', `revisioned-${runId}`)
  await runTransaction(member.db, async transaction => {
    const eventSnapshot = await transaction.get(eventRef)
    transaction.set(validItemRef, {
      title: 'Revisioned write', performer: '', description: '', duration: '00:01', type: 'performance', order: 1, color: '#7645ff', createdAt: serverTimestamp(),
    })
    transaction.update(eventRef, { queueRevision: eventSnapshot.data().queueRevision + 1, updatedAt: serverTimestamp(), updatedBy: member.user.uid })
  })
  await assert.rejects(updateDoc(validItemRef, { duration: '00:02' }), error => error.code === 'permission-denied')
  await runTransaction(member.db, async transaction => {
    const eventSnapshot = await transaction.get(eventRef)
    transaction.update(validItemRef, { duration: '00:02' })
    transaction.update(eventRef, { queueRevision: eventSnapshot.data().queueRevision + 1, updatedAt: serverTimestamp(), updatedBy: member.user.uid })
  })
  assert.equal((await getDoc(validItemRef)).data().duration, '00:02', 'queue edits with a revision bump should succeed')
  await assert.rejects(deleteDoc(validItemRef), error => error.code === 'permission-denied')
  await runTransaction(member.db, async transaction => {
    const eventSnapshot = await transaction.get(eventRef)
    transaction.delete(validItemRef)
    transaction.update(eventRef, { queueRevision: eventSnapshot.data().queueRevision + 1, updatedAt: serverTimestamp(), updatedBy: member.user.uid })
  })
  assert.equal((await getDoc(validItemRef)).exists(), false, 'item deletion with a revision bump should succeed')
  await updateDoc(eventRef, {
    timeline: { status: 'paused', itemId, positionMs: 0, anchorAt: null, firstStartedAt: null, commandRevision: 1, updatedAt: serverTimestamp(), updatedBy: member.user.uid },
    updatedAt: serverTimestamp(), updatedBy: member.user.uid,
  })
  assert.equal((await getDoc(eventRef)).data().timeline.status, 'paused', 'member should write a valid timeline command')

  await signOut(member.auth)
  await assert.rejects(getDoc(eventRef), error => error.code === 'permission-denied')
})

test.after(async () => {
  await Promise.all(apps.map(app => deleteApp(app).catch(() => {})))
})
