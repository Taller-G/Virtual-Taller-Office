import { AVATARS, DEFAULT_AVATAR, isAvatarId, NAME_MAX_LENGTH, sanitizeName } from '@vto/shared'
import { avatarThumb } from './avatarThumb'

export interface Identity {
  name: string
  avatar: string
}

const STORAGE_KEY = 'vto.identity'

function loadIdentity(): Partial<Identity> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Partial<Identity>
    return {
      name: sanitizeName(parsed.name),
      avatar: isAvatarId(parsed.avatar) ? parsed.avatar : undefined,
    }
  } catch {
    return {}
  }
}

function saveIdentity(identity: Identity) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity))
  } catch {
    // Sin almacenamiento (modo privado, etc.): se pide de nuevo la próxima vez.
  }
}

/**
 * Pantalla de entrada: nombre visible y elección de avatar entre los del
 * catálogo. Recuerda la última elección en localStorage. Resuelve cuando el
 * usuario confirma; recién entonces se entra a la sala.
 */
export function showEntry(): Promise<Identity> {
  const remembered = loadIdentity()
  const overlay = document.getElementById('entry')!
  const form = overlay.querySelector<HTMLFormElement>('form')!
  const nameInput = form.querySelector<HTMLInputElement>('#entry-name')!
  const grid = form.querySelector<HTMLElement>('#entry-avatars')!
  const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!

  nameInput.maxLength = NAME_MAX_LENGTH
  nameInput.value = remembered.name ?? ''
  let selected = remembered.avatar ?? DEFAULT_AVATAR

  grid.replaceChildren()
  for (const { id, label } of AVATARS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'avatar-pick'
    button.dataset.avatar = id
    button.setAttribute('aria-pressed', String(id === selected))
    button.append(
      avatarThumb(id, 2),
      Object.assign(document.createElement('span'), { textContent: label }),
    )
    button.addEventListener('click', () => {
      selected = id
      for (const other of grid.querySelectorAll<HTMLButtonElement>('.avatar-pick')) {
        other.setAttribute('aria-pressed', String(other.dataset.avatar === selected))
      }
    })
    grid.append(button)
  }

  const refreshSubmit = () => {
    submit.disabled = sanitizeName(nameInput.value) === undefined
  }
  nameInput.addEventListener('input', refreshSubmit)
  refreshSubmit()

  overlay.hidden = false
  nameInput.focus()

  return new Promise((resolve) => {
    form.addEventListener(
      'submit',
      (event) => {
        event.preventDefault()
        const name = sanitizeName(nameInput.value)
        if (!name) return
        const identity: Identity = { name, avatar: selected }
        saveIdentity(identity)
        overlay.hidden = true
        nameInput.blur()
        resolve(identity)
      },
      { once: true },
    )
  })
}
