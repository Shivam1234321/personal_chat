import { signOut } from 'firebase/auth'
import {
  addDoc,
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { useEffect, useMemo, useRef, useState } from 'react'
import { auth, db } from '../firebase.js'
import { conversationIdForUids, normalizeEmail } from '../utils/conversation.js'

function otherMemberEmail(conversation, myUid) {
  const map = conversation?.memberEmails || {}
  const entries = Object.entries(map)
  const other = entries.find(([uid]) => uid !== myUid)
  return other?.[1] || '(unknown)'
}

export function ChatPage() {
  const user = auth.currentUser
  const myUid = user?.uid
  const myEmail = normalizeEmail(user?.email)

  const [targetEmail, setTargetEmail] = useState('')
  const [startError, setStartError] = useState('')
  const [busyStart, setBusyStart] = useState(false)

  const [conversations, setConversations] = useState([])
  const [activeConversationId, setActiveConversationId] = useState(null)
  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) || null,
    [conversations, activeConversationId],
  )

  const [messages, setMessages] = useState([])
  const [messageText, setMessageText] = useState('')
  const [sendError, setSendError] = useState('')
  const [busySend, setBusySend] = useState(false)

  const listRef = useRef(null)

  useEffect(() => {
    if (!myUid) return
    const q = query(
      collection(db, 'conversations'),
      where('members', 'array-contains', myUid),
      orderBy('updatedAt', 'desc'),
      limit(50),
    )
    return onSnapshot(q, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      setConversations(items)
      setActiveConversationId((prev) => prev || items[0]?.id || null)
    })
  }, [myUid])

  useEffect(() => {
    if (!activeConversationId) {
      setMessages([])
      return
    }
    const q = query(
      collection(db, 'conversations', activeConversationId, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(200),
    )
    return onSnapshot(q, (snap) => {
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      queueMicrotask(() => {
        const el = listRef.current
        if (el) el.scrollTop = el.scrollHeight
      })
    })
  }, [activeConversationId])

  async function startConversationByEmail(e) {
    e.preventDefault()
    setStartError('')
    setBusyStart(true)
    try {
      const emailNorm = normalizeEmail(targetEmail)
      if (!emailNorm) throw new Error('Enter an email.')
      if (emailNorm === myEmail) throw new Error('You cannot chat with yourself.')

      const emailDoc = await getDoc(doc(db, 'userEmails', emailNorm))
      if (!emailDoc.exists()) throw new Error('User not found. They must sign up first.')
      const otherUid = emailDoc.data()?.uid
      if (!otherUid) throw new Error('User lookup failed.')

      const convoId = conversationIdForUids(myUid, otherUid)
      const convoRef = doc(db, 'conversations', convoId)
      const convoSnap = await getDoc(convoRef)
      if (!convoSnap.exists()) {
        await setDoc(convoRef, {
          members: [myUid, otherUid].sort(),
          memberEmails: { [myUid]: myEmail, [otherUid]: emailNorm },
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          lastMessage: '',
        })
      } else {
        await updateDoc(convoRef, { updatedAt: serverTimestamp() })
      }

      setActiveConversationId(convoId)
      setTargetEmail('')
    } catch (err) {
      setStartError(err?.message || String(err))
    } finally {
      setBusyStart(false)
    }
  }

  async function sendMessage(e) {
    e.preventDefault()
    if (!activeConversationId) return
    setSendError('')
    setBusySend(true)
    try {
      const text = String(messageText || '').trim()
      if (!text) return

      const msgRef = collection(db, 'conversations', activeConversationId, 'messages')
      await addDoc(msgRef, {
        text,
        senderId: myUid,
        createdAt: serverTimestamp(),
      })

      await updateDoc(doc(db, 'conversations', activeConversationId), {
        lastMessage: text.slice(0, 160),
        updatedAt: serverTimestamp(),
      })

      setMessageText('')
    } catch (err) {
      setSendError(err?.message || String(err))
    } finally {
      setBusySend(false)
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <div style={{ display: 'grid', gap: 2 }}>
          <h1>Chat</h1>
          <div className="muted">Signed in as {myEmail}</div>
        </div>
        <button className="btn" type="button" onClick={() => signOut(auth)}>
          Logout
        </button>
      </div>

      <div className="layout">
        <div className="sidebar">
          <form onSubmit={startConversationByEmail} style={{ display: 'grid', gap: 8 }}>
            <div className="muted">Start chat by email</div>
            <input
              className="input"
              type="email"
              placeholder="friend@example.com"
              value={targetEmail}
              onChange={(e) => setTargetEmail(e.target.value)}
            />
            {startError ? <div className="error">{startError}</div> : null}
            <button className="btn primary" disabled={busyStart} type="submit">
              {busyStart ? 'Starting…' : 'Start / Open'}
            </button>
          </form>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="muted">Your chats</div>
            <div className="muted">{conversations.length}</div>
          </div>

          <div className="conversation-list" role="list">
            {conversations.length ? (
              conversations.map((c) => (
                <div
                  key={c.id}
                  role="listitem"
                  className={[
                    'conversation-item',
                    c.id === activeConversationId ? 'active' : '',
                  ].join(' ')}
                  onClick={() => setActiveConversationId(c.id)}
                >
                  <div style={{ fontWeight: 650, color: 'var(--text-h)' }}>
                    {otherMemberEmail(c, myUid)}
                  </div>
                  <div className="muted" style={{ marginTop: 2 }}>
                    {c.lastMessage || 'No messages yet'}
                  </div>
                </div>
              ))
            ) : (
              <div className="muted">No chats yet. Start one by email.</div>
            )}
          </div>
        </div>

        <div className="content">
          <div className="messages" ref={listRef}>
            {activeConversation ? (
              <>
                <div className="muted">
                  Conversation with <b>{otherMemberEmail(activeConversation, myUid)}</b>
                </div>
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={['bubble', m.senderId === myUid ? 'me' : ''].join(' ')}
                    title={m.senderId === myUid ? 'You' : 'Them'}
                  >
                    {m.text}
                  </div>
                ))}
              </>
            ) : (
              <div className="muted">Pick a chat or start a new one by email.</div>
            )}
          </div>

          <form className="composer" onSubmit={sendMessage}>
            <input
              className="input"
              disabled={!activeConversationId}
              placeholder={activeConversationId ? 'Type a message…' : 'Select a conversation…'}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
            />
            <button className="btn primary" disabled={!activeConversationId || busySend} type="submit">
              {busySend ? 'Sending…' : 'Send'}
            </button>
            {sendError ? (
              <div className="error" style={{ gridColumn: '1 / -1' }}>
                {sendError}
              </div>
            ) : null}
          </form>
        </div>
      </div>
    </div>
  )
}

