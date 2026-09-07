/**
 * Aviso de mensaje nuevo cuando la ventana no tiene el foco.
 *
 * Dos señales discretas y ninguna intrusiva: un blip corto generado con
 * WebAudio (sin archivo de sonido) y un contador en el título de la pestaña.
 * Las dos se apagan solas en cuanto la ventana vuelve a tener el foco.
 */

const BASE_TITLE = document.title
/** Volumen del blip: audible sin sobresaltar. */
const VOLUME = 0.05

let unread = 0
let audio: AudioContext | undefined

/** ¿La ventana está en segundo plano (otra pestaña, otra app, minimizada)? */
export function isWindowUnfocused(): boolean {
  return document.hidden || !document.hasFocus()
}

/**
 * Blip corto de dos tonos. El `AudioContext` se crea recién en el primer
 * aviso: a esa altura el usuario ya interactuó con la página (eligió nombre y
 * avatar), así que el navegador lo deja sonar. Si el audio no está disponible
 * se ignora en silencio: es un adorno, no una función.
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
    // Sin audio disponible: el contador del título alcanza como aviso.
  }
}

/** Avisa de un mensaje recibido sin foco: suma al contador y suena una vez. */
export function notifyUnread() {
  unread++
  document.title = `(${unread}) ${BASE_TITLE}`
  chime()
}

/** Vuelve el título a su forma normal y olvida los pendientes. */
export function clearUnread() {
  unread = 0
  document.title = BASE_TITLE
}

/**
 * Deja que el foco de la ventana limpie el aviso. `extra` se llama junto con
 * la limpieza (lo usa el panel para apagar su resaltado).
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
