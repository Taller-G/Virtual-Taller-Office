import {
  APPEARANCE_BASES,
  AVATARS,
  DEFAULT_APPEARANCE,
  DEFAULT_AVATAR,
  GLASSES_OPTIONS,
  HAIR_COLORS,
  HAIR_COLOR_IDS,
  HAT_OPTIONS,
  NAME_MAX_LENGTH,
  SKIN_TONES,
  TOP_COLORS,
  TOP_COLOR_IDS,
  isAvatarId,
  parseAppearance,
  sanitizeName,
  serializeAppearance,
  type Appearance,
  type AppearanceBase,
  type GlassesOption,
  type HairColorId,
  type HatOption,
  type SkinTone,
  type TopColorId,
} from '@vto/shared'
import { avatarThumb } from './avatarThumb'

export interface Identity {
  name: string
  avatar: string
  /** JSON de Appearance (aspecto compuesto). Vacío = usar preset. */
  appearance: string
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
      appearance:
        typeof parsed.appearance === 'string' && parseAppearance(parsed.appearance)
          ? parsed.appearance
          : undefined,
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

// ---------------------------------------------------------------------------
// Appearance editor helpers
// ---------------------------------------------------------------------------

const LABEL: Record<string, string> = {
  adam: 'Estilo 1',
  ash: 'Estilo 2',
  lucy: 'Estilo 3',
  nancy: 'Estilo 4',
  default: 'Original',
  light: 'Clara',
  medium: 'Media',
  tan: 'Bronceada',
  dark: 'Oscura',
  none: 'Ninguno',
  cap: 'Gorra',
  beanie: 'Gorro',
  'glasses-round': 'Redondos',
  'glasses-square': 'Cuadrados',
}

function colorHex(n: number): string {
  return '#' + n.toString(16).padStart(6, '0')
}

/** Creates a row of option buttons for one appearance property. */
function optionRow<T extends string>(
  title: string,
  options: readonly T[],
  current: T,
  onChange: (v: T) => void,
  colorMap?: Record<T, number>,
): HTMLElement {
  const row = document.createElement('div')
  row.className = 'appearance-row'
  const heading = document.createElement('span')
  heading.className = 'appearance-row__label'
  heading.textContent = title
  row.append(heading)

  const btns = document.createElement('div')
  btns.className = 'appearance-row__options'

  for (const opt of options) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'appearance-opt'
    btn.dataset.value = opt
    btn.setAttribute('aria-pressed', String(opt === current))
    if (colorMap && opt in colorMap) {
      const swatch = document.createElement('span')
      swatch.className = 'color-swatch'
      swatch.style.backgroundColor = colorHex(colorMap[opt])
      btn.append(swatch)
    } else {
      btn.textContent = LABEL[opt] ?? opt
    }
    btn.addEventListener('click', () => {
      onChange(opt)
      for (const other of btns.querySelectorAll<HTMLButtonElement>('.appearance-opt')) {
        other.setAttribute('aria-pressed', String(other.dataset.value === opt))
      }
    })
    btns.append(btn)
  }
  row.append(btns)
  return row
}

// ---------------------------------------------------------------------------
// Entry screen
// ---------------------------------------------------------------------------

/**
 * Pantalla de entrada: nombre visible y elección de avatar.
 *
 * Dos modos (pestañas):
 * - **Presets**: los 11 avatares del catálogo (single-sheet), igual que antes.
 * - **Personalizar**: editor de apariencia compuesta con pickers para base,
 *   tono de piel, color de pelo, color de ropa, gorro y anteojos.
 *
 * Recuerda la última elección en localStorage. Resuelve cuando el usuario
 * confirma; recién entonces se entra a la sala.
 */
export function showEntry(): Promise<Identity> {
  const remembered = loadIdentity()
  const overlay = document.getElementById('entry')!
  const form = overlay.querySelector<HTMLFormElement>('form')!
  const nameInput = form.querySelector<HTMLInputElement>('#entry-name')!
  const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!

  nameInput.maxLength = NAME_MAX_LENGTH
  nameInput.value = remembered.name ?? ''

  // Which mode are we in? 'preset' or 'custom'
  const hadAppearance = remembered.appearance ? parseAppearance(remembered.appearance) : null
  let mode: 'preset' | 'custom' = hadAppearance ? 'custom' : 'preset'
  let selectedPreset = remembered.avatar ?? DEFAULT_AVATAR
  let appearance: Appearance = hadAppearance ?? { ...DEFAULT_APPEARANCE }

  // -- Tab bar --
  const fieldset = form.querySelector<HTMLFieldSetElement>('.entry__avatars')!
  fieldset.replaceChildren()
  const legend = document.createElement('legend')
  legend.textContent = 'Tu avatar'
  fieldset.append(legend)

  const tabs = document.createElement('div')
  tabs.className = 'entry__tabs'
  const presetTab = document.createElement('button')
  presetTab.type = 'button'
  presetTab.textContent = 'Presets'
  presetTab.className = 'entry__tab'
  const customTab = document.createElement('button')
  customTab.type = 'button'
  customTab.textContent = 'Personalizar'
  customTab.className = 'entry__tab'
  tabs.append(presetTab, customTab)
  fieldset.append(tabs)

  // -- Preset grid --
  const presetPanel = document.createElement('div')
  presetPanel.id = 'entry-avatars'
  presetPanel.className = 'avatar-grid'
  for (const { id, label } of AVATARS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'avatar-pick'
    button.dataset.avatar = id
    button.setAttribute('aria-pressed', String(id === selectedPreset))
    button.append(
      avatarThumb(id, 2),
      Object.assign(document.createElement('span'), { textContent: label }),
    )
    button.addEventListener('click', () => {
      selectedPreset = id
      for (const other of presetPanel.querySelectorAll<HTMLButtonElement>('.avatar-pick')) {
        other.setAttribute('aria-pressed', String(other.dataset.avatar === selectedPreset))
      }
    })
    presetPanel.append(button)
  }

  // -- Custom panel --
  const customPanel = document.createElement('div')
  customPanel.className = 'appearance-editor'

  customPanel.append(
    optionRow('Silueta', APPEARANCE_BASES, appearance.base, (v: AppearanceBase) => {
      appearance = { ...appearance, base: v }
    }),
    optionRow('Piel', SKIN_TONES, appearance.skinTone, (v: SkinTone) => {
      appearance = { ...appearance, skinTone: v }
    }),
    optionRow(
      'Pelo',
      HAIR_COLOR_IDS,
      appearance.hairColor,
      (v: HairColorId) => {
        appearance = { ...appearance, hairColor: v }
      },
      HAIR_COLORS as Record<HairColorId, number>,
    ),
    optionRow(
      'Ropa',
      TOP_COLOR_IDS,
      appearance.topColor,
      (v: TopColorId) => {
        appearance = { ...appearance, topColor: v }
      },
      TOP_COLORS as Record<TopColorId, number>,
    ),
    optionRow('Gorro', HAT_OPTIONS, appearance.hat, (v: HatOption) => {
      appearance = { ...appearance, hat: v }
    }),
    optionRow('Anteojos', GLASSES_OPTIONS, appearance.glasses, (v: GlassesOption) => {
      appearance = { ...appearance, glasses: v }
    }),
  )

  fieldset.append(presetPanel, customPanel)

  // -- Tab switching --
  function setMode(m: 'preset' | 'custom') {
    mode = m
    presetTab.setAttribute('aria-selected', String(m === 'preset'))
    customTab.setAttribute('aria-selected', String(m === 'custom'))
    presetPanel.hidden = m !== 'preset'
    customPanel.hidden = m !== 'custom'
  }
  presetTab.addEventListener('click', () => setMode('preset'))
  customTab.addEventListener('click', () => setMode('custom'))
  setMode(mode)

  // -- Submit --
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
        const identity: Identity = {
          name,
          avatar: mode === 'preset' ? selectedPreset : DEFAULT_AVATAR,
          appearance: mode === 'custom' ? serializeAppearance(appearance) : '',
        }
        saveIdentity(identity)
        overlay.hidden = true
        nameInput.blur()
        resolve(identity)
      },
      { once: true },
    )
  })
}
