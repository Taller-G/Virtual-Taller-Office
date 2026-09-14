/**
 * Notice of a new message when the window does not have the focus.
 *
 * Two discreet signals and no intrusive one: a short blip generated with
 * WebAudio (no sound file) and a counter in the tab's title. Both switch
 * themselves off as soon as the window has the focus again.
 */

const BASE_TITLE = document.title
/** Volume of the blip: audible without startling. */
const VOLUME = 0.05

let unread = 0
let audio: AudioContext | undefined

/** Is the window in the background (another tab, another app, minimised)? */
export function isWindowUnfocused(): boolean {
  return document.hidden || !document.hasFocus()
}

/**
 * A short two-tone blip. The `AudioContext` is only created on the first
 * notice: by then the user has already interacted with the page (they chose a
 * name and an avatar), so the browser lets it play. If audio is unavailable it
 * is ignored silently: it is decoration, not a feature.
 */
function chime() {
  try {
    audio ??= new AudioContext()
    if (audio.state === 'suspended') void audio.resume()
    const now = audio.currentTime
    const gain = audio.createGain()
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(VOLUME, now + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18)
    gain.connect(audio.destination)
    const osc = audio.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(660, now)
    osc.frequency.setValueAtTime(880, now + 0.09)
    osc.connect(gain)
    osc.start(now)
    osc.stop(now + 0.2)
  } catch {
    // No audio available: the title counter is notice enough.
  }
}

/** Announces a message received without focus: bumps the counter and sounds once. */
export function notifyUnread() {
  unread++
  document.title = `(${unread}) ${BASE_TITLE}`
  chime()
}

/** Puts the title back to its normal form and forgets what is pending. */
export function clearUnread() {
  unread = 0
  document.title = BASE_TITLE
}

/**
 * Lets the window's focus clear the notice. `extra` is called along with the
 * clearing (the panel uses it to switch off its highlight).
 */
export function watchFocus(extra?: () => void) {
  const clear = () => {
    if (unread > 0 || extra) clearUnread()
    extra?.()
  }
  window.addEventListener('focus', clear)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) clear()
  })
}
