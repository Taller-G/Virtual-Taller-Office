const TOAST_MS = 4_000
const MAX_VISIBLE = 4

/** Discreet notice in the corner of the game; it disappears on its own. */
export function toast(text: string) {
  const host = document.getElementById('toasts')
  if (!host) return
  while (host.children.length >= MAX_VISIBLE) host.firstElementChild?.remove()
  const el = document.createElement('div')
  el.className = 'toast'
  el.setAttribute('role', 'status')
  el.textContent = text
  host.append(el)
  setTimeout(() => {
    el.classList.add('toast--out')
    setTimeout(() => el.remove(), 300)
  }, TOAST_MS)
}
