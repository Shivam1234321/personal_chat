import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase.js'
import { normalizeEmail } from './conversation.js'

/**
 * Ensures `users/{uid}` and `userEmails/{emailLower}` exist so others can start a chat by email.
 * `userEmails` rules only allow create (not update), so we create only when missing.
 */
export async function ensureUserEmailIndex(user) {
  if (!user?.uid || !user.email) return
  const emailNorm = normalizeEmail(user.email)

  await setDoc(
    doc(db, 'users', user.uid),
    {
      uid: user.uid,
      email: emailNorm,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )

  const emailRef = doc(db, 'userEmails', emailNorm)
  const snap = await getDoc(emailRef)
  if (!snap.exists()) {
    await setDoc(emailRef, {
      uid: user.uid,
      email: emailNorm,
      createdAt: serverTimestamp(),
    })
  }
}
