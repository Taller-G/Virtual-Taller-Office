import {
  AGENT_TYPES,
  APPEARANCE_BASES,
  AVATARS,
  DEFAULT_AGENTS,
  DEFAULT_AGENT_TYPE,
  DEFAULT_APPEARANCE,
  DEFAULT_AVATAR,
  FACIAL_HAIR_OPTIONS,
  GLASSES_OPTIONS,
  HAIR_COLORS,
  HAIR_COLOR_IDS,
  HAIR_STYLES,
  HAT_OPTIONS,
  MAX_AGENTS,
  NAME_MAX_LENGTH,
  PANTS_COLORS,
  PANTS_COLOR_IDS,
  SHOE_COLORS,
  SHOE_COLOR_IDS,
  SKIN_TONES,
  TOP_COLORS,
  TOP_COLOR_IDS,
  isAvatarId,
  parseAppearance,
  sanitizeAgentCount,
  sanitizeAgentType,
  sanitizeName,
  serializeAppearance,
  type Appearance,
  type HairColorId,
  type PantsColorId,
  type ShoeColorId,
  type TopColorId,
} from '@vto/shared'
import { avatarPreview } from './avatarPreview'
import { avatarThumb } from './avatarThumb'
import { mascotThumb } from './mascotThumb'

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
  /**
   * What those agents look like: an id from `AGENT_TYPES`. One choice covers
   * all of them, and like the count it travels to the server on joining and
   * through every door after that.
   */
  agentType: string
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
      // none, like anything else unusable. One stored before they could be
      // chosen has no type either, and reads as the classic robot — which is
      // exactly what it was drawn as back then.
      agents: sanitizeAgentCount(parsed.agents),
      agentType: sanitizeAgentType(parsed.agentType),
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
  short: 'Short',
  long: 'Long',
  bun: 'Bun',
  curly: 'Curly',
  ponytail: 'Ponytail',
  stubble: 'Stubble',
  mustache: 'Moustache',
  beard: 'Beard',
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
 * Entry screen: visible name, how many agents walk with you and what they look
 * like, and choice of avatar.
 *
 * The agents block sits on its own, above the avatar group and outside it: the
 * count and the type apply whichever tab is open, and neither is part of one's
 * own look.
 *
 * Two modes (tabs) for the avatar:
 * - **Presets**: the 11 avatars in the catalogue (single-sheet), as before.
 * - **Customise**: composed appearance editor with a row per part — silhouette,
 *   skin tone, hair style and colour, facial hair, clothes, trousers, shoes,
 *   hat and glasses.
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
  const card = form.closest<HTMLElement>('.entry__card') ?? form
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

  // -- Custom panel: the option rows, and the avatar they build beside them --
  const customPanel = document.createElement('div')
  customPanel.className = 'appearance-editor'

  const preview = avatarPreview()

  /**
   * Handler for one option row. Every row changes the appearance through here,
   * so none of them can be added later and forget to repaint the preview.
   */
  function change<K extends keyof Appearance>(key: K) {
    return (value: Appearance[K]) => {
      appearance = { ...appearance, [key]: value }
      preview.update(appearance)
    }
  }

  const rows = document.createElement('div')
  rows.className = 'appearance-editor__rows'
  rows.append(
    optionRow('Silhouette', APPEARANCE_BASES, appearance.base, change('base')),
    optionRow('Skin', SKIN_TONES, appearance.skinTone, change('skinTone')),
    optionRow('Hair style', HAIR_STYLES, appearance.hairStyle, change('hairStyle')),
    optionRow(
      'Hair colour',
      HAIR_COLOR_IDS,
      appearance.hairColor,
      change('hairColor'),
      HAIR_COLORS as Record<HairColorId, number>,
    ),
    optionRow('Facial hair', FACIAL_HAIR_OPTIONS, appearance.facialHair, change('facialHair')),
    optionRow(
      'Clothes',
      TOP_COLOR_IDS,
      appearance.topColor,
      change('topColor'),
      TOP_COLORS as Record<TopColorId, number>,
    ),
    optionRow(
      'Trousers',
      PANTS_COLOR_IDS,
      appearance.pantsColor,
      change('pantsColor'),
      PANTS_COLORS as Record<PantsColorId, number>,
    ),
    optionRow(
      'Shoes',
      SHOE_COLOR_IDS,
      appearance.shoeColor,
      change('shoeColor'),
      SHOE_COLORS as Record<ShoeColorId, number>,
    ),
    optionRow('Hat', HAT_OPTIONS, appearance.hat, change('hat')),
    optionRow('Glasses', GLASSES_OPTIONS, appearance.glasses, change('glasses')),
  )
  customPanel.append(rows, preview.el)

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
    // The customise tab needs room for the preview column beside the options.
    card.classList.toggle('entry__card--custom', m === 'custom')
    // Repaint on the way in: a canvas keeps what it drew, but this is also
    // what puts a remembered appearance on screen before anything is clicked.
    if (m === 'custom') preview.update(appearance)
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

  // -- Agent type picker --
  // Beside the stepper, one thumbnail per type so the choice is made by
  // looking rather than by reading. It stays enabled at a count of zero: one
  // picks what the agents will be and then how many, as often as the other way
  // round, and a control that greys itself out reads as broken.
  let agentType = remembered.agentType ?? DEFAULT_AGENT_TYPE
  const agentTypes = form.querySelector<HTMLElement>('#entry-agent-types')!
  agentTypes.replaceChildren()
  for (const { id, label } of AGENT_TYPES) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'mascot-pick'
    button.dataset.agentType = id
    button.title = label
    button.setAttribute('aria-pressed', String(id === agentType))
    button.append(
      mascotThumb(id, 2),
      Object.assign(document.createElement('span'), { textContent: label }),
    )
    button.addEventListener('click', () => {
      agentType = id
      for (const other of agentTypes.querySelectorAll<HTMLButtonElement>('.mascot-pick')) {
        other.setAttribute('aria-pressed', String(other.dataset.agentType === agentType))
      }
    })
    agentTypes.append(button)
  }

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
          agentType,
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
