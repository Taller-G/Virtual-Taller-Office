import Phaser from 'phaser'

/** Does the element receive text from the keyboard? (input, textarea, select, contentEditable) */
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
 * While a text field has the focus, the keyboard does not reach the game: the
 * KeyboardManager is turned off (so the keys do not move the avatar) and
 * `preventDefault` stops being applied to arrows/space (so the field's caret
 * works). On losing the focus it is restored and any keys left marked as
 * pressed are released.
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
