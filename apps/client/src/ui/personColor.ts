import type { OfficeRoom } from '../network/connection'

/**
 * The colour each person is drawn in throughout the panel.
 *
 * Every person gets one of the hues below and keeps it: their name in the
 * people list, their name among the bubble's members, and the name, the ring
 * around their portrait and the tint of their messages in the chat all come
 * from here, so a conversation can be followed by colour without reading a
 * single name.
 */

/**
 * Eight hues spread around the wheel, all light enough to sit on the panel's
 * dark surfaces: each one measures at least 5.9:1 against every surface in the
 * sidebar and against its own tinted message bubble.
 *
 * Deliberately no blue: the accent already owns it (one's own messages, the
 * "you" mark), and no near-duplicates - with a handful of people in a bubble,
 * two hues one cannot tell apart are worse than a palette with fewer of them.
 */
export const PERSON_COLORS = [
  '#ff9d8c', // coral
  '#f3c258', // amber
  '#b7e06b', // lime
  '#5fdcaa', // mint
  '#56d3ef', // cyan
  '#8fb6ff', // sky
  '#d49bff', // orchid
  '#ff9ccd', // pink
] as const

/** FNV-1a, 32 bits: short, stable, and it scatters similar keys apart. */
function hash(key: string): number {
  let value = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    value ^= key.charCodeAt(i)
    // The FNV prime as shifts and adds, so it stays inside 32 bits.
    value += (value << 1) + (value << 4) + (value << 7) + (value << 8) + (value << 24)
  }
  return value >>> 0
}

/**
 * The hue a person would like: the hash of their session, taken straight.
 *
 * The session is the key and not the name on purpose: the name can be changed
 * at any time from the panel's own field, and someone's colour shifting
 * mid-conversation would undo the very thing it is for. The session is also
 * the same string on every client, so the same person is worked out the same
 * way everywhere.
 */
function preferred(sessionId: string): number {
  return hash(sessionId) % PERSON_COLORS.length
}

/**
 * Colours for a whole roster, resolving the clashes the hash leaves behind.
 *
 * A bare hash into eight hues is not enough: with only three people in a
 * bubble two of them land on the same hue a third of the time, which is
 * exactly the case the colours exist for. So whoever is alone on their hue
 * keeps it, and only those who are contending for one are settled - in order
 * of session id, the first taking it and the rest walking on to the next free
 * hue.
 *
 * It stays the same on every client (the roster and the order are the server's
 * state, identical everywhere) and it survives a reload for the same reason.
 * Nobody holding a hue uncontested is ever moved by someone arriving, so a
 * newcomer disturbs at most the people who were already sharing a hue with
 * them. Past `PERSON_COLORS.length` people in the office the hues have to
 * repeat, and the surplus falls back to its bare hash.
 */
export function resolveColors(sessionIds: Iterable<string>): Map<string, string> {
  const ids = [...sessionIds].sort()
  const taken = new Array<boolean>(PERSON_COLORS.length).fill(false)
  const colors = new Map<string, string>()

  // How many want each hue: the ones nobody else wants are settled outright.
  const wanted = new Array<number>(PERSON_COLORS.length).fill(0)
  for (const id of ids) wanted[preferred(id)]++

  const contended: string[] = []
  for (const id of ids) {
    const slot = preferred(id)
    if (wanted[slot] === 1) {
      taken[slot] = true
      colors.set(id, PERSON_COLORS[slot])
    } else {
      contended.push(id)
    }
  }

  for (const id of contended) {
    const slot = preferred(id)
    let free = slot
    let steps = 0
    while (taken[free] && steps < PERSON_COLORS.length) {
      free = (free + 1) % PERSON_COLORS.length
      steps++
    }
    // Full house: more people than hues, so this one shares with someone.
    if (taken[free]) free = slot
    taken[free] = true
    colors.set(id, PERSON_COLORS[free])
  }

  return colors
}

/** The roster the cached map below was worked out from. */
let cachedKey = ''
let cached = new Map<string, string>()

/**
 * The colours of everyone in the office, worked out once per change of roster.
 *
 * The three parts of the panel that paint people - the list, the bubble's
 * members and the chat - all read from here, so they cannot disagree: it is
 * derived from the room's state rather than passed between them.
 */
export function personColors(room: OfficeRoom | undefined): Map<string, string> {
  if (!room) return new Map()
  const ids = [...room.state.players.keys()]
  const key = [...ids].sort().join(',')
  if (key !== cachedKey) {
    cachedKey = key
    cached = resolveColors(ids)
  }
  return cached
}

/**
 * The colour of one person. Someone no longer in the office (an old message
 * from whoever has left) falls back to their bare hash.
 */
export function personColor(room: OfficeRoom | undefined, sessionId: string): string {
  return personColors(room).get(sessionId) ?? PERSON_COLORS[preferred(sessionId)]
}

/**
 * Hands the colour to CSS as `--person`, which the panel's rules use to derive
 * the ring and the tint (with `color-mix`) instead of hard-coding one variant
 * per hue.
 */
export function paintPerson(el: HTMLElement, color: string): void {
  el.style.setProperty('--person', color)
}
