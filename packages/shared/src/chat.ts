/**
 * Chat de texto de la burbuja de proximidad.
 *
 * Los mensajes son efímeros y **no** viven en el schema: van por
 * `room.send` / `room.onMessage` (ver `messages.ts`), el servidor solo los
 * retransmite a los miembros de la burbuja del remitente y nadie guarda
 * historial. El único historial es el que cada cliente arma en memoria
 * mientras está en la burbuja.
 *
 * Acá vive la validación del texto, compartida a propósito: el cliente la usa
 * para rechazar antes de enviar (y mostrar el motivo) y el servidor la vuelve
 * a aplicar, porque un cliente puede mentir.
 */

/** Máximo de caracteres de un mensaje, ya normalizado. */
export const CHAT_MAX_LENGTH = 240

/**
 * Motivos por los que un mensaje no se envía o el servidor no lo acepta.
 * `offline` es el único que decide solo el cliente (no hay sala a la que
 * mandarlo); los demás los puede devolver el servidor.
 */
export type ChatRejection = 'empty' | 'too_long' | 'no_bubble' | 'rate_limited' | 'offline'

/** Texto para la UI de cada motivo de rechazo. */
export const CHAT_REJECTION_TEXT: Record<ChatRejection, string> = {
  empty: 'Escribí algo para enviar.',
  too_long: `El mensaje no puede pasar de ${CHAT_MAX_LENGTH} caracteres.`,
  no_bubble: 'Ya no estás en la conversación.',
  rate_limited: 'Escribiste muy rápido: esperá un momento.',
  offline: 'Sin conexión con el servidor.',
}

/**
 * Caracteres invisibles que se sacan siempre: espacios de ancho cero y marcas
 * de dirección (LRO/RLO/aislantes). No aportan nada a un mensaje y sirven para
 * disfrazar texto o dar vuelta el orden de lo que se lee.
 */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g

/**
 * Cambia por espacios los caracteres de control (C0 y C1), que después el
 * colapso de espacios se lleva. Se hace por código y no con una expresión
 * regular porque una clase de caracteres de control es ilegible y la marca
 * el linter (`no-control-regex`).
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
 * Normaliza el texto de un mensaje: saca invisibles y controles, colapsa
 * cualquier espacio (saltos de línea incluidos: el campo es de una línea) y
 * recorta las puntas. **No** recorta el largo ni escapa nada: el mensaje se
 * transporta tal como se escribió y se muestra como texto plano
 * (`textContent` en el panel, `Phaser.Text` en el globo), así `<b>hola</b>`
 * se lee literal en vez de convertirse en HTML.
 */
export function sanitizeChatText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return withoutControls(value.replace(INVISIBLE, '')).replace(/\s+/g, ' ').trim()
}

export type ChatTextResult =
  { ok: true; text: string } | { ok: false; reason: Extract<ChatRejection, 'empty' | 'too_long'> }

/**
 * Valida el texto de un mensaje. El largo se mide sobre el texto normalizado
 * y se **rechaza**, no se recorta: el que escribe tiene que ver que se pasó.
 */
export function validateChatText(value: unknown): ChatTextResult {
  const text = sanitizeChatText(value)
  if (text.length === 0) return { ok: false, reason: 'empty' }
  if (text.length > CHAT_MAX_LENGTH) return { ok: false, reason: 'too_long' }
  return { ok: true, text }
}

/** Largo máximo del id con el que el remitente correlaciona su acuse. */
export const CHAT_ID_MAX_LENGTH = 40
const UNSAFE_ID = /[^A-Za-z0-9_-]/g

/**
 * Normaliza el id que manda el cliente (lo elige él para reconocer el eco de
 * su propio mensaje). Se limita a caracteres inofensivos y a un largo fijo; si
 * no queda nada usable, el servidor pone uno.
 */
export function sanitizeChatId(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.replace(UNSAFE_ID, '').slice(0, CHAT_ID_MAX_LENGTH)
}

/** Id local de un mensaje propio, para reconocer su eco. */
export function newChatId(): string {
  return `m${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
