/**
 * Text chat of the proximity bubble.
 *
 * Messages are ephemeral and do **not** live in the schema: they travel over
 * `room.send` / `room.onMessage` (see `messages.ts`), the server only relays
 * them to the members of the sender's bubble and nobody stores history. The
 * only history is the one each client builds in memory while it is in the
 * bubble.
 *
 * Text validation lives here, deliberately shared: the client uses it to
 * reject before sending (and show the reason) and the server applies it
 * again, because a client can lie.
 */

/** Maximum number of characters of a message, once normalised. */
export const CHAT_MAX_LENGTH = 240

/**
 * Reasons why a message is not sent or the server does not accept it.
 * `offline` is the only one the client decides on its own (there is no room
 * to send it to); the others can be returned by the server.
 */
export type ChatRejection = 'empty' | 'too_long' | 'no_bubble' | 'rate_limited' | 'offline'

/** UI text for each rejection reason. */
export const CHAT_REJECTION_TEXT: Record<ChatRejection, string> = {
  empty: 'Write something to send.',
  too_long: `A message cannot be longer than ${CHAT_MAX_LENGTH} characters.`,
  no_bubble: 'You are no longer in the conversation.',
  rate_limited: 'You are typing too fast: wait a moment.',
  offline: 'No connection to the server.',
}

/**
 * Invisible characters that are always stripped: zero-width spaces and
 * direction marks (LRO/RLO/isolates). They add nothing to a message and are
 * used to disguise text or reverse the order of what is read.
 */
const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿]/g

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
 * Normalises the text of a message: strips invisible and control characters,
 * collapses any whitespace (line breaks included: the field is single-line)
 * and trims the ends. It does **not** cap the length nor escape anything: the
 * message travels exactly as it was written and is shown as plain text
 * (`textContent` in the panel, `Phaser.Text` in the balloon), so `<b>hi</b>`
 * reads literally instead of turning into HTML.
 */
export function sanitizeChatText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return withoutControls(value.replace(INVISIBLE, '')).replace(/\s+/g, ' ').trim()
}

export type ChatTextResult =
  { ok: true; text: string } | { ok: false; reason: Extract<ChatRejection, 'empty' | 'too_long'> }

/**
 * Validates the text of a message. The length is measured on the normalised
 * text and is **rejected**, not truncated: whoever writes has to see that
 * they went over.
 */
export function validateChatText(value: unknown): ChatTextResult {
  const text = sanitizeChatText(value)
  if (text.length === 0) return { ok: false, reason: 'empty' }
  if (text.length > CHAT_MAX_LENGTH) return { ok: false, reason: 'too_long' }
  return { ok: true, text }
}

/** Maximum length of the id the sender correlates its acknowledgement with. */
export const CHAT_ID_MAX_LENGTH = 40
const UNSAFE_ID = /[^A-Za-z0-9_-]/g

/**
 * Normalises the id the client sends (it picks it to recognise the echo of
 * its own message). It is limited to harmless characters and a fixed length;
 * if nothing usable is left, the server assigns one.
 */
export function sanitizeChatId(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(UNSAFE_ID, '').slice(0, CHAT_ID_MAX_LENGTH)
}

/** Local id of one's own message, to recognise its echo. */
export function newChatId(): string {
  return `m${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
