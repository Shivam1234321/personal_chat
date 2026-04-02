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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { auth, db } from '../firebase.js'
import { useIsMobile } from '../hooks/useIsMobile.js'
import { compressImageFileToDataUrl } from '../utils/imageBase64.js'
import { formatMessageTime } from '../utils/messageTime.js'
import { conversationIdForUids, normalizeEmail } from '../utils/conversation.js'
import { downloadImageFromSrc } from '../utils/downloadImage.js'
import { playIncomingMessageSound } from '../utils/incomingMessageSound.js'

function otherMemberEmail(conversation, myUid) {
  const map = conversation?.memberEmails || {}
  const entries = Object.entries(map)
  const other = entries.find(([uid]) => uid !== myUid)
  return other?.[1] || '(unknown)'
}

function extractFirebaseConsoleUrl(text) {
  const m = String(text || '').match(/https:\/\/console\.firebase\.google\.com[^\s)'"]+/)
  return m ? m[0] : ''
}

function isNearBottom(el, thresholdPx = 140) {
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight <= thresholdPx
}

function scrollMessagesToBottom(el, endEl) {
  if (!el) return
  el.scrollTop = el.scrollHeight
  endEl?.scrollIntoView({ block: 'end', behavior: 'auto' })
}

function MessageBubble({ m, myUid, onImageOpen }) {
  const isMe = m.senderId === myUid
  const time = formatMessageTime(m.createdAt)
  const type = m.type
  const imageSrc = type === 'image' ? (m.dataUrl || m.mediaUrl) : null

  let body = null
  if (type === 'image' && imageSrc) {
    body = (
      <>
        <button
          type="button"
          className="bubble-media-btn"
          onClick={() => onImageOpen?.({ src: imageSrc, caption: m.text })}
          aria-label="View image full size"
        >
          <img className="bubble-media" src={imageSrc} alt="" loading="lazy" />
        </button>
        {m.text ? <div className="bubble-caption">{m.text}</div> : null}
      </>
    )
  } else if (type === 'video' && m.mediaUrl) {
    body = (
      <>
        <video className="bubble-media" src={m.mediaUrl} controls playsInline />
        {m.text ? <div className="bubble-caption">{m.text}</div> : null}
      </>
    )
  } else if (m.text != null && m.text !== '') {
    body = m.text
  }

  if (body == null) return null

  return (
    <div
      className={['bubble', isMe ? 'me' : ''].join(' ')}
      title={isMe ? 'You' : 'Them'}
    >
      {body}
      {time ? <div className="bubble-time">{time}</div> : null}
    </div>
  )
}

function ImageLightbox({ open, src, caption, onClose, onDownload }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open || !src) return null

  return (
    <div className="image-lightbox" role="dialog" aria-modal="true" aria-label="Image preview">
      <button type="button" className="image-lightbox-backdrop" aria-label="Close" onClick={onClose} />
      <div className="image-lightbox-inner">
        <div className="image-lightbox-toolbar">
          <button type="button" className="btn btn-lightbox" onClick={onDownload}>
            Download
          </button>
          <button type="button" className="btn btn-lightbox btn-lightbox-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="image-lightbox-stage">
          <img className="image-lightbox-img" src={src} alt="" />
        </div>
        {caption ? <div className="image-lightbox-caption">{caption}</div> : null}
      </div>
    </div>
  )
}

export function ChatPage() {
  const user = auth.currentUser
  const myUid = user?.uid
  const myEmail = normalizeEmail(user?.email)
  const isMobile = useIsMobile()
  const isMobileRef = useRef(isMobile)

  useEffect(() => {
    isMobileRef.current = isMobile
  }, [isMobile])

  const [targetEmail, setTargetEmail] = useState('')
  const [startError, setStartError] = useState('')
  const [busyStart, setBusyStart] = useState(false)

  const [conversations, setConversations] = useState([])
  const [conversationsQueryError, setConversationsQueryError] = useState(null)
  const [activeConversationId, setActiveConversationId] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) || null,
    [conversations, activeConversationId],
  )

  const [messages, setMessages] = useState([])
  const [messageText, setMessageText] = useState('')
  const [sendError, setSendError] = useState('')
  const [busySend, setBusySend] = useState(false)
  const [otherTyping, setOtherTyping] = useState(false)
  const [imageLightbox, setImageLightbox] = useState(null)
  const closeLightbox = useCallback(() => setImageLightbox(null), [])

  const listRef = useRef(null)
  /** After switching chats, keep scrolling until the new messages are painted (Firestore is async). */
  const pinToBottomRef = useRef(false)
  const messagesEndRef = useRef(null)
  const galleryInputRef = useRef(null)
  const cameraPhotoInputRef = useRef(null)
  const typingStopTimeoutRef = useRef(null)
  const lastTypingWriteAtRef = useRef(0)

  const otherUid = useMemo(() => {
    if (!activeConversation) return null
    const map = activeConversation?.memberEmails || {}
    const entries = Object.entries(map)
    const other = entries.find(([uid]) => uid !== myUid)
    return other?.[0] || null
  }, [activeConversation, myUid])

  useEffect(() => {
    if (!myUid) return
    const q = query(
      collection(db, 'conversations'),
      where('members', 'array-contains', myUid),
      orderBy('updatedAt', 'desc'),
      limit(50),
    )
    return onSnapshot(
      q,
      (snap) => {
        setConversationsQueryError(null)
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        setConversations(items)
        setActiveConversationId((prev) => {
          if (prev && items.some((x) => x.id === prev)) return prev
          if (prev && !items.some((x) => x.id === prev)) return null
          if (isMobileRef.current) return null
          return items[0]?.id ?? null
        })
      },
      (err) => {
        const msg = err?.message || String(err)
        console.error('[conversations listener]', err)
        setConversations([])
        const url = extractFirebaseConsoleUrl(msg)
        const isIndex = err?.code === 'failed-precondition' || msg.includes('requires an index')
        let userMsg = isIndex
          ? 'Firestore needs a composite index for the chat list. In Firebase Console, open the link below and click Create index. Wait until Status is Enabled (can take a few minutes), then refresh this page.'
          : msg
        if (url) userMsg += `\n\n${url}`
        else if (isIndex)
          userMsg +=
            '\n\n(No link in this browser — copy the URL from DevTools console, or deploy firestore.indexes.json; see README.)'
        setConversationsQueryError(userMsg)
      },
    )
  }, [myUid])

  useEffect(() => {
    if (!activeConversationId) {
      setMessages([])
      pinToBottomRef.current = false
      return
    }
    pinToBottomRef.current = true
    setMessages([])
    const q = query(
      collection(db, 'conversations', activeConversationId, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(200),
    )
    let isFirstMessagesSnapshot = true
    return onSnapshot(q, (snap) => {
      if (!isFirstMessagesSnapshot) {
        for (const change of snap.docChanges()) {
          if (change.type === 'added') {
            const sender = change.doc.data()?.senderId
            if (sender && sender !== myUid) {
              playIncomingMessageSound()
              break
            }
          }
        }
      } else {
        isFirstMessagesSnapshot = false
      }
      setMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    })
  }, [activeConversationId, myUid])

  function sendTyping(isTyping) {
    if (!activeConversationId || !myUid) return Promise.resolve()
    return setDoc(
      doc(db, 'conversations', activeConversationId, 'typing', myUid),
      { isTyping: !!isTyping, lastUpdated: serverTimestamp() },
      { merge: true },
    ).catch(() => {
      // Ignore typing write failures (rules/network). UX only.
    })
  }

  // Listen to typing indicator for the other user in this conversation.
  useEffect(() => {
    if (!activeConversationId || !otherUid) {
      setOtherTyping(false)
      return
    }

    const typingRef = doc(db, 'conversations', activeConversationId, 'typing', otherUid)
    return onSnapshot(typingRef, (snap) => {
      const data = snap.data()
      const isTyping = !!data?.isTyping
      const lastUpdated = data?.lastUpdated
      const ms = lastUpdated?.toMillis ? lastUpdated.toMillis() : null
      const fresh = typeof ms === 'number' ? Date.now() - ms <= 4000 : false
      setOtherTyping(isTyping && fresh)
    })
  }, [activeConversationId, otherUid])

  // Stop typing when leaving the conversation.
  useEffect(() => {
    return () => {
      if (typingStopTimeoutRef.current) clearTimeout(typingStopTimeoutRef.current)
      typingStopTimeoutRef.current = null
      void sendTyping(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId])

  /* Open chat at latest messages; pin until first non-empty render; then only if near bottom */
  useLayoutEffect(() => {
    if (!activeConversationId) return
    const el = listRef.current
    const endEl = messagesEndRef.current
    if (!el) return

    const run = () => scrollMessagesToBottom(el, endEl)

    if (pinToBottomRef.current) {
      run()
      requestAnimationFrame(() => requestAnimationFrame(run))
      if (messages.length > 0) pinToBottomRef.current = false
      return
    }
    if (isNearBottom(el)) run()
  }, [messages, activeConversationId])

  useEffect(() => {
    const el = listRef.current
    if (!el || !activeConversationId) return
    const ro = new ResizeObserver(() => {
      const endEl = messagesEndRef.current
      if (pinToBottomRef.current) scrollMessagesToBottom(el, endEl)
      else if (isNearBottom(el, 200)) scrollMessagesToBottom(el, endEl)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [activeConversationId])

  useEffect(() => {
    if (isMobile && activeConversationId) setDrawerOpen(false)
  }, [activeConversationId, isMobile])

  function selectConversation(id) {
    setActiveConversationId(id)
    setDrawerOpen(false)
  }

  async function startConversationByEmail(e) {
    e.preventDefault()
    setStartError('')
    setBusyStart(true)
    try {
      const emailNorm = normalizeEmail(targetEmail)
      if (!emailNorm) throw new Error('Enter an email.')
      if (emailNorm === myEmail) throw new Error('You cannot chat with yourself.')

      const emailDoc = await getDoc(doc(db, 'userEmails', emailNorm))
      if (!emailDoc.exists()) {
        throw new Error(
          'No account registered for this email in chat lookup. They must sign up and log in to this app at least once (so their email is saved).',
        )
      }
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

      selectConversation(convoId)
      setTargetEmail('')
    } catch (err) {
      const code = err?.code
      const message = err?.message || String(err)
      const msgLower = String(message).toLowerCase()
      const looksOffline =
        code === 'unavailable' ||
        message === 'Failed to get document because the client is offline.' ||
        msgLower.includes('client is offline') ||
        msgLower.includes('offline')

      const base = `Search failed${code ? ` (${code})` : ''}: ${message}`
      if (!looksOffline) {
        setStartError(base)
        return
      }

      setStartError(
        `${base}\n\nIf you are on LOCAL: check your internet / firewall / adblock.\nIf you are on VERCEL: confirm Vercel env vars (VITE_FIREBASE_*) are set, then redeploy.\nAlso make sure Firestore Database is created in Firebase Console.`,
      )
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
      void sendTyping(false)
      const text = String(messageText || '').trim()
      if (!text) return

      const msgRef = collection(db, 'conversations', activeConversationId, 'messages')
      await addDoc(msgRef, {
        type: 'text',
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

  async function uploadImageAsBase64(file) {
    if (!activeConversationId || !file) return
    setSendError('')
    if (!file.type.startsWith('image/')) {
      setSendError('Please choose an image (photos only; videos are not stored in Firestore).')
      return
    }

    setBusySend(true)
    try {
      void sendTyping(false)
      const dataUrl = await compressImageFileToDataUrl(file)
      const caption = String(messageText || '').trim()
      const msgRef = collection(db, 'conversations', activeConversationId, 'messages')
      await addDoc(msgRef, {
        type: 'image',
        dataUrl,
        ...(caption ? { text: caption } : {}),
        senderId: myUid,
        createdAt: serverTimestamp(),
      })

      const preview = caption ? `📷 ${caption.slice(0, 120)}` : '📷 Photo'
      await updateDoc(doc(db, 'conversations', activeConversationId), {
        lastMessage: preview.slice(0, 160),
        updatedAt: serverTimestamp(),
      })

      setMessageText('')
    } catch (err) {
      setSendError(err?.message || String(err))
    } finally {
      setBusySend(false)
    }
  }

  function onImageInputChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    void uploadImageAsBase64(file)
  }

  function handleComposerChange(value) {
    setMessageText(value)
    if (!activeConversationId || !myUid) return

    if (typingStopTimeoutRef.current) {
      clearTimeout(typingStopTimeoutRef.current)
      typingStopTimeoutRef.current = null
    }

    const trimmed = String(value || '').trim()
    const shouldTyping = trimmed.length > 0
    if (!shouldTyping) {
      lastTypingWriteAtRef.current = Date.now()
      void sendTyping(false)
      return
    }

    const now = Date.now()
    if (now - lastTypingWriteAtRef.current > 900) {
      lastTypingWriteAtRef.current = now
      void sendTyping(true)
    }

    typingStopTimeoutRef.current = setTimeout(() => {
      void sendTyping(false)
      typingStopTimeoutRef.current = null
    }, 2500)
  }

  const peerLabel = activeConversation
    ? otherMemberEmail(activeConversation, myUid)
    : isMobile
      ? ''
      : 'Messages'

  const mobileListMode = isMobile && !activeConversationId
  const showDrawerOverlay = isMobile && drawerOpen && !!activeConversationId
  const drawerClasses = [
    'chat-drawer',
    isMobile ? 'chat-drawer--mobile' : 'chat-drawer--desktop',
    mobileListMode ? 'chat-drawer--list-mode' : '',
    isMobile && !mobileListMode && drawerOpen ? 'is-open' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const showChatPanel = !isMobile || !!activeConversationId

  return (
    <div className="card chat-card">
      {showDrawerOverlay ? (
        <button
          type="button"
          className="drawer-backdrop"
          aria-label="Close chat list"
          onClick={() => setDrawerOpen(false)}
        />
      ) : null}

      <aside className={drawerClasses} aria-label="Chat list">
        <div className="drawer-top">
          <div>
            <h1 className="drawer-title">Chats</h1>
            <div className="muted drawer-sub">{myEmail}</div>
          </div>
          <button className="btn btn-compact" type="button" onClick={() => signOut(auth)}>
            Logout
          </button>
        </div>

        <div className="drawer-body">
          <form onSubmit={startConversationByEmail} className="start-chat-form">
            <div className="muted">Start by email</div>
            <input
              className="input"
              type="email"
              placeholder="friend@example.com"
              value={targetEmail}
              onChange={(e) => setTargetEmail(e.target.value)}
            />
            {startError ? <div className="error start-chat-error">{startError}</div> : null}
            <button className="btn primary" disabled={busyStart} type="submit">
              {busyStart ? 'Starting…' : 'Start / Open'}
            </button>
          </form>

          <div className="drawer-section-head">
            <span className="muted">Conversations</span>
            <span className="muted">{conversations.length}</span>
          </div>

          {conversationsQueryError ? (
            <div className="error drawer-index-error">{conversationsQueryError}</div>
          ) : null}

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
                  onClick={() => selectConversation(c.id)}
                >
                  <div className="conversation-item-name">{otherMemberEmail(c, myUid)}</div>
                  <div className="muted conversation-item-preview">{c.lastMessage || 'No messages yet'}</div>
                </div>
              ))
            ) : (
              <div className="muted drawer-empty">No chats yet. Start one by email.</div>
            )}
          </div>
        </div>
      </aside>

      <main className={`chat-thread${showChatPanel ? '' : ' chat-thread--hidden-mobile'}`}>
        <header className="chat-toolbar">
          <div className="chat-toolbar-side">
            {isMobile && activeConversationId ? (
              <button
                type="button"
                className="btn btn-icon"
                aria-label="Back to chats"
                onClick={() => setActiveConversationId(null)}
              >
                ←
              </button>
            ) : null}
          </div>
          <div className="chat-toolbar-text">
            <span className="chat-toolbar-peer">{peerLabel}</span>
            {otherTyping ? <div className="typing-indicator">typing…</div> : null}
          </div>
          <div className="chat-toolbar-side chat-toolbar-side--end">
            {isMobile && activeConversationId ? (
              <button
                type="button"
                className="btn btn-icon"
                aria-label="Open chat list"
                onClick={() => setDrawerOpen(true)}
              >
                ☰
              </button>
            ) : null}
          </div>
        </header>

        <div className="messages-wrap">
          <div className="messages" ref={listRef}>
            {activeConversation ? (
              <>
                {messages.map((m) => (
                  <MessageBubble key={m.id} m={m} myUid={myUid} onImageOpen={setImageLightbox} />
                ))}
                <div ref={messagesEndRef} className="messages-end-spacer" aria-hidden />
              </>
            ) : (
              <div className="chat-empty-placeholder muted">
                {isMobile ? 'Choose a chat from the list or start with an email.' : 'Select a conversation from the list.'}
              </div>
            )}
          </div>
        </div>

        <form className="composer" onSubmit={sendMessage}>
          <div className="composer-tools">
            <input
              ref={galleryInputRef}
              className="sr-only"
              type="file"
              accept="image/*"
              onChange={onImageInputChange}
              aria-label="Choose image from gallery"
            />
            <input
              ref={cameraPhotoInputRef}
              className="sr-only"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onImageInputChange}
              aria-label="Take a photo"
            />
            <button
              type="button"
              className="btn"
              disabled={!activeConversationId || busySend}
              onClick={() => galleryInputRef.current?.click()}
            >
              Gallery
            </button>
            <button
              type="button"
              className="btn"
              disabled={!activeConversationId || busySend}
              onClick={() => cameraPhotoInputRef.current?.click()}
            >
              Camera
            </button>
            <span className="muted composer-hint">Caption optional — type first, then attach.</span>
          </div>
          <div className="composer-row">
            <input
              className="input"
              disabled={!activeConversationId}
              placeholder={activeConversationId ? 'Message…' : 'Select a chat…'}
              value={messageText}
              onChange={(e) => handleComposerChange(e.target.value)}
            />
            <button className="btn primary" disabled={!activeConversationId || busySend} type="submit">
              {busySend ? '…' : 'Send'}
            </button>
          </div>
          {sendError ? <div className="error composer-error">{sendError}</div> : null}
        </form>
      </main>

      {createPortal(
        <ImageLightbox
          open={!!imageLightbox}
          src={imageLightbox?.src}
          caption={imageLightbox?.caption}
          onClose={closeLightbox}
          onDownload={() => {
            if (imageLightbox?.src) void downloadImageFromSrc(imageLightbox.src)
          }}
        />,
        document.body,
      )}
    </div>
  )
}
