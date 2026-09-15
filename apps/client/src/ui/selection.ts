/**
 * Who is currently picked out: the person whose card is open.
 *
 * It is its own little store because the two places you can pick somebody from
 * - clicking their avatar in the world, clicking their row in the people list
 * - live on opposite sides of the app, and neither has any business knowing
 * about the card or about each other. The scene is also torn down and rebuilt
 * on every trip through a door, so anything hung off it would have to be
 * hooked up again each time; this survives that.
 */

/** sessionId of whoever is picked, or `''` for nobody. */
let selected = ''
/** Was the last pick made with the keyboard? Then the keyboard follows it. */
let viaKeyboard = false
const listeners = new Set<(sessionId: string) => void>()

export function selectedPerson(): string {
  return selected
}

/**
 * Whether the open card was reached by keyboard. Opening it with the mouse
 * deliberately leaves the focus where it was: clicking somebody across the
 * room should not take the movement keys away from whoever clicked.
 */
export function pickedByKeyboard(): boolean {
  return viaKeyboard
}

/** Picks somebody (or `''` to close). Picking the same person again closes it. */
export function selectPerson(sessionId: string, keyboard = false) {
  const next = sessionId === selected ? '' : sessionId
  if (next === selected) return
  selected = next
  viaKeyboard = keyboard
  for (const listener of listeners) listener(selected)
}

/** Closes whatever is open, without the toggling behaviour of `selectPerson`. */
export function clearSelection() {
  if (selected === '') return
  selected = ''
  viaKeyboard = false
  for (const listener of listeners) listener(selected)
}

export function onSelection(listener: (sessionId: string) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
