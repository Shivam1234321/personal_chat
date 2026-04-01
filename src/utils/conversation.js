export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

export function conversationIdForUids(uidA, uidB) {
  const [a, b] = [uidA, uidB].sort()
  return `${a}__${b}`
}

