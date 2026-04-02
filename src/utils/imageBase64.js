/** Max data-URL string length (Firestore document ~1 MiB limit; leave room for other fields). */
const DEFAULT_MAX_DATA_URL_CHARS = 750_000

/**
 * Resize + JPEG-compress to a data URL that fits under maxChars.
 * @param {File} file
 * @param {{ maxWidth?: number, maxChars?: number }} [options]
 * @returns {Promise<string>} data:image/jpeg;base64,...
 */
export function compressImageFileToDataUrl(file, options = {}) {
  const maxWidth = options.maxWidth ?? 1280
  const maxChars = options.maxChars ?? DEFAULT_MAX_DATA_URL_CHARS

  if (!file.type.startsWith('image/')) {
    return Promise.reject(new Error('Please choose an image file.'))
  }

  return new Promise((resolve, reject) => {
    const img = new Image()
    const blobUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(blobUrl)
      try {
        let w = img.naturalWidth || img.width
        let h = img.naturalHeight || img.height
        if (w > maxWidth) {
          h = (h * maxWidth) / w
          w = maxWidth
        }
        w = Math.max(1, Math.round(w))
        h = Math.max(1, Math.round(h))

        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Could not draw image.'))
          return
        }

        const draw = () => {
          canvas.width = w
          canvas.height = h
          ctx.drawImage(img, 0, 0, w, h)
        }
        draw()

        let quality = 0.9
        let dataUrl = canvas.toDataURL('image/jpeg', quality)
        while (dataUrl.length > maxChars && quality > 0.25) {
          quality -= 0.06
          dataUrl = canvas.toDataURL('image/jpeg', quality)
        }

        while (dataUrl.length > maxChars && w > 360 && h > 360) {
          w = Math.floor(w * 0.88)
          h = Math.floor(h * 0.88)
          draw()
          quality = 0.85
          dataUrl = canvas.toDataURL('image/jpeg', quality)
          while (dataUrl.length > maxChars && quality > 0.25) {
            quality -= 0.06
            dataUrl = canvas.toDataURL('image/jpeg', quality)
          }
        }

        if (dataUrl.length > maxChars) {
          reject(
            new Error(
              'Image is still too large. Try a smaller photo or lower-resolution file.',
            ),
          )
          return
        }
        resolve(dataUrl)
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(blobUrl)
      reject(new Error('Could not load this image (unsupported format?).'))
    }
    img.src = blobUrl
  })
}
