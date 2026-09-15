/**
 * Normalising the single-line text a person types: a chat message, a meeting
 * title. Both are shown as plain text (`textContent` in the panel,
 * `Phaser.Text` in a balloon), so nothing is escaped here — `<b>hi</b>` is
 * meant to read literally. What is taken out is what cannot be read at all.
 */

/**
 * Invisible characters that are always stripped: zero-width spaces and
 * direction marks (LRO/RLO/isolates). They add nothing and are used to
 * disguise text or reverse the order of what is read.
 *
 * Written as escapes and not as the characters themselves: pasted literally
 * they are invisible in the source too, which is exactly the property that
 * makes them worth stripping.
 */
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g

/**
 * Turns control characters (C0 and C1) into spaces, which the whitespace
 * collapse then removes. It is done by code point instead of with a regular
 * expression because a control-character class is unreadable and the linter
 * flags it (`no-control-regex`).
 */
function withoutControls(value: string): string {
  let out = ''
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    out += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? ' ' : char
  }
  return out
}

/**
 * One line of text as everyone will see it: invisible and control characters
 * gone, any whitespace (line breaks included) collapsed to single spaces, ends
 * trimmed. It does **not** cap the length: whoever calls it decides whether
 * going over is a truncation or a refusal.
 */
export function normalizeLine(value: unknown): string {
  if (typeof value !== 'string') return ''
  return withoutControls(value.replace(INVISIBLE, '')).replace(/\s+/g, ' ').trim()
}
