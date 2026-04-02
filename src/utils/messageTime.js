export function formatMessageTime(createdAt) {
  if (!createdAt) return ''
  try {
    const d =
      typeof createdAt?.toDate === 'function' ? createdAt.toDate() : new Date(createdAt)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return ''
  }
}
