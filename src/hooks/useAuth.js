import { onAuthStateChanged } from 'firebase/auth'
import { useEffect, useState } from 'react'
import { auth } from '../firebase.js'
import { ensureUserEmailIndex } from '../utils/userProfile.js'

export function useAuth() {
  const [user, setUser] = useState(null)
  const [initializing, setInitializing] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u)
      setInitializing(false)
      if (u) {
        ensureUserEmailIndex(u).catch((err) => {
          console.error('ensureUserEmailIndex failed', err)
        })
      }
    })
    return () => unsub()
  }, [])

  return { user, initializing }
}

