import {
  APPEARANCE_BASES,
  AVATARS,
  DEFAULT_AGENTS,
  DEFAULT_APPEARANCE,
  DEFAULT_AVATAR,
  GLASSES_OPTIONS,
  HAIR_COLORS,
  HAIR_COLOR_IDS,
  HAT_OPTIONS,
  MAX_AGENTS,
  NAME_MAX_LENGTH,
  SKIN_TONES,
  TOP_COLORS,
  TOP_COLOR_IDS,
  isAvatarId,
  parseAppearance,
  sanitizeAgentCount,
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
  /** Appearance JSON (composed look). Empty = use a preset. */
  appearance: string
  /**
   * How many agent mascots walk behind you. For now it is set by hand here;
   * later it will be however many agents Chiron reports. It is part of the
   * identity like the name is, so it travels to the server on joining (see
   * `JoinOptions`) and through every door after that.
   */
  agents: number
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
      // An identity stored before there were agents has no count: it reads as
      // none, like anything else unusable.
      agents: sanitizeAgentCount(parsed.agents),
    }
  } catch {
    return {}
  }
}

function saveIdentity(identity: Identity) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity))
  } catch {
    // No storage (private mode, etc.): it will be asked again next time.
  }
}

// ---------------------------------------------------------------------------
// Appearance editor helpers
// ---------------------------------------------------------------------------

const LABEL: Record<string, string> = {
  adam: 'Style 1',
  ash: 'Style 2',
  lucy: 'Style 3',
  nancy: 'Style 4',
  default: 'Original',
  light: 'Light',
  medium: 'Medium',
  tan: 'Tan',
  dark: 'Dark',
  none: 'None',
  cap: 'Cap',
  beanie: 'Beanie',
  'glasses-round': 'Round',
  'glasses-square': 'Square',
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
 * Entry screen: visible name, how many agents walk with you, and choice of
 * avatar.
 *
 * The agents stepper sits on its own, above the avatar group and outside it:
 * it applies whichever tab is open, and it is not part of the look.
 *
 * Two modes (tabs) for the avatar:
 * - **Presets**: the 11 avatars in the catalogue (single-sheet), as before.
 * - **Customise**: composed appearance editor with pickers for base, skin
 *   tone, hair colour, clothes colour, hat and glasses.
 *
 * It remembers the last choice in localStorage. It resolves when the user
 * confirms; only then is the room joined.
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
  // A role="group" div rather than a fieldset: a fieldset lays its children out
  // in an anonymous content box that keeps height:auto, so a constrained height
  // never reaches them and the panels below could not shrink in order to scroll.
  const group = form.querySelector<HTMLElement>('.entry__avatars')!
  group.replaceChildren()
  const groupLabel = document.createElement('span')
  groupLabel.id = 'entry-avatars-label'
  groupLabel.className = 'entry__avatars-label'
  groupLabel.textContent = 'Your avatar'
  group.append(groupLabel)

  const tabs = document.createElement('div')
  tabs.className = 'entry__tabs'
  const presetTab = document.createElement('button')
  presetTab.type = 'button'
  presetTab.textContent = 'Presets'
  presetTab.className = 'entry__tab'
  const customTab = document.createElement('button')
  customTab.type = 'button'
  customTab.textContent = 'Customise'
  customTab.className = 'entry__tab'
  tabs.append(presetTab, customTab)
  group.append(tabs)

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
    optionRow('Silhouette', APPEARANCE_BASES, appearance.base, (v: AppearanceBase) => {
      appearance = { ...appearance, base: v }
    }),
    optionRow('Skin', SKIN_TONES, appearance.skinTone, (v: SkinTone) => {
      appearance = { ...appearance, skinTone: v }
    }),
    optionRow(
      'Hair',
      HAIR_COLOR_IDS,
      appearance.hairColor,
      (v: HairColorId) => {
        appearance = { ...appearance, hairColor: v }
      },
      HAIR_COLORS as Record<HairColorId, number>,
    ),
    optionRow(
      'Clothes',
      TOP_COLOR_IDS,
      appearance.topColor,
      (v: TopColorId) => {
        appearance = { ...appearance, topColor: v }
      },
      TOP_COLORS as Record<TopColorId, number>,
    ),
    optionRow('Hat', HAT_OPTIONS, appearance.hat, (v: HatOption) => {
      appearance = { ...appearance, hat: v }
    }),
    optionRow('Glasses', GLASSES_OPTIONS, appearance.glasses, (v: GlassesOption) => {
      appearance = { ...appearance, glasses: v }
    }),
  )

  // Both panels share one scroller, so on a short window the avatar area
  // scrolls while the group label, the tabs and the submit button stay put.
  const panels = document.createElement('div')
  panels.className = 'entry__panels'
  panels.append(presetPanel, customPanel)
  group.append(panels)

  // -- Tab switching --
  function setMode(m: 'preset' | 'custom') {
    mode = m
    presetTab.setAttribute('aria-selected', String(m === 'preset'))
    customTab.setAttribute('aria-selected', String(m === 'custom'))
    presetPanel.hidden = m !== 'preset'
    customPanel.hidden = m !== 'custom'
    panels.scrollTop = 0
  }
  presetTab.addEventListener('click', () => setMode('preset'))
  customTab.addEventListener('click', () => setMode('custom'))
  setMode(mode)

  // -- Agents stepper --
  // It is above the avatar group and outside it on purpose: the count applies
  // to both tabs, and the Customise tab is being worked on elsewhere.
  let agents = remembered.agents ?? DEFAULT_AGENTS
  const agentsValue = form.querySelector<HTMLOutputElement>('#entry-agents-value')!
  const agentsLess = form.querySelector<HTMLButtonElement>('#entry-agents-less')!
  const agentsMore = form.querySelector<HTMLButtonElement>('#entry-agents-more')!

  const setAgents = (value: number) => {
    agents = sanitizeAgentCount(value)
    agentsValue.textContent = String(agents)
    // At either end the button that cannot do anything says so.
    agentsLess.disabled = agents === 0
    agentsMore.disabled = agents === MAX_AGENTS
  }
  agentsLess.addEventListener('click', () => setAgents(agents - 1))
  agentsMore.addEventListener('click', () => setAgents(agents + 1))
  setAgents(agents)

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
          agents,
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
