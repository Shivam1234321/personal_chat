import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { useMemo, useState } from 'react'
import { auth, db } from '../firebase.js'
import { normalizeEmail } from '../utils/conversation.js'

function friendlyAuthError(code) {
  switch (code) {
    case 'auth/configuration-not-found':
      return 'Firebase Auth is not configured for this project. In Firebase Console: Authentication → Get started → Sign-in method → enable Email/Password.'
    case 'auth/invalid-email':
      return 'Invalid email address.'
    case 'auth/missing-password':
      return 'Password is required.'
    case 'auth/weak-password':
      return 'Password is too weak (try 6+ characters).'
    case 'auth/email-already-in-use':
      return 'This email is already registered. Try logging in.'
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Email or password is incorrect.'
    default:
      return code || 'Authentication error.'
  }
}

export function AuthPage() {
  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const title = useMemo(() => (mode === 'login' ? 'Login' : 'Create account'), [mode])

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const emailNorm = normalizeEmail(email)
      if (mode === 'login') {
        await signInWithEmailAndPassword(auth, emailNorm, password)
        return
      }

      const cred = await createUserWithEmailAndPassword(auth, emailNorm, password)
      const uid = cred.user.uid

      await setDoc(doc(db, 'users', uid), {
        uid,
        email: emailNorm,
        createdAt: serverTimestamp(),
      })

      await setDoc(doc(db, 'userEmails', emailNorm), {
        uid,
        email: emailNorm,
        createdAt: serverTimestamp(),
      })
    } catch (err) {
      setError(friendlyAuthError(err?.code) || String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <h1>Chat</h1>
        <div className="muted">Private 1:1 chats with Firebase</div>
      </div>

      <div style={{ padding: 18, display: 'grid', gap: 12 }}>
        <h2>{title}</h2>

        <form onSubmit={onSubmit} style={{ display: 'grid', gap: 10 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <div className="muted">Email</div>
            <input
              className="input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <div className="muted">Password</div>
            <input
              className="input"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </label>

          {error ? <div className="error">{error}</div> : null}

          <button className="btn primary" disabled={busy} type="submit">
            {busy ? 'Please wait…' : mode === 'login' ? 'Login' : 'Create account'}
          </button>
        </form>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div className="muted">
            {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}
          </div>
          <button
            className="btn"
            type="button"
            onClick={() => {
              setError('')
              setMode((m) => (m === 'login' ? 'signup' : 'login'))
            }}
          >
            {mode === 'login' ? 'Sign up' : 'Login'}
          </button>
        </div>

        <div className="muted">
          Tip: after signup, your email is stored in Firestore so others can start a chat by your email.
        </div>
      </div>
    </div>
  )
}

