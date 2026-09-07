import Phaser from 'phaser'

/** ¿El elemento recibe texto del teclado? (input, textarea, select, contentEditable) */
export function isTypingTarget(element: EventTarget | Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false
  if (element.isContentEditable) return true
  const tag = element.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (element as HTMLInputElement).type
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color'].includes(
      type,
    )
  }
  return false
}

export function isTyping(): boolean {
  return isTypingTarget(document.activeElement)
}

/**
 * Mientras un campo de texto tiene el foco, el teclado no llega al juego:
 * se apaga el KeyboardManager (así las teclas no mueven al avatar) y se deja
 * de hacer `preventDefault` sobre flechas/espacio (así el cursor del campo
 * funciona). Al perder el foco se restaura y se sueltan las teclas que
 * hubieran quedado marcadas como presionadas.
 */
export function installTypingGuard(game: Phaser.Game): () => void {
  const manager = game.input.keyboard
  if (!manager) return () => {}

  const resetKeys = () => {
    for (const scene of game.scene.getScenes(true)) scene.input?.keyboard?.resetKeys()
  }
  const pause = () => {
    manager.enabled = false
    manager.preventDefault = false
    resetKeys()
  }
  const resume = () => {
    manager.enabled = true
    manager.preventDefault = true
    resetKeys()
  }
  const onFocusIn = (event: FocusEvent) => {
    if (isTypingTarget(event.target)) pause()
  }
  const onFocusOut = (event: FocusEvent) => {
    if (isTypingTarget(event.target)) resume()
  }

  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('focusout', onFocusOut)
  if (isTyping()) pause()

  return () => {
    document.removeEventListener('focusin', onFocusIn)
    document.removeEventListener('focusout', onFocusOut)
    resume()
  }
}
