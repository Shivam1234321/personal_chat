/**
 * Download an image from a data URL or http(s) URL.
 */
export async function downloadImageFromSrc(src, baseName = 'chat-photo') {
  const ext =
    src.startsWith('data:image/png')
      ? 'png'
      : src.startsWith('data:image/webp')
        ? 'webp'
        : src.startsWith('data:image/gif')
          ? 'gif'
          : 'jpg'
  const filename = `${baseName}-${Date.now()}.${ext}`

  if (src.startsWith('data:')) {
    const a = document.createElement('a')
    a.href = src
    a.download = filename
    a.rel = 'noopener'
    a.click()
    return
  }

  try {
    const res = await fetch(src, { mode: 'cors' })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    a.click()
    URL.revokeObjectURL(url)
  } catch {
    window.open(src, '_blank', 'noopener,noreferrer')
  }
}
