/** Short notification tone (no audio file). Requires a prior user gesture on many browsers. */
let sharedCtx = null

export function playIncomingMessageSound() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    if (!sharedCtx) sharedCtx = new AC()
    const ctx = sharedCtx
    if (ctx.state === 'suspended') {
      void ctx.resume()
    }

    const t0 = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, t0)
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18)

    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(t0)
    osc.stop(t0 + 0.2)
  } catch {
    // Autoplay policy or missing API — ignore
  }
}
