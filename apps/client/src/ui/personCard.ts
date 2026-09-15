import { PLAYER_STATUS_TEXT, playerStatus, type Player } from '@vto/shared'
import type { OfficeScene } from '../game/OfficeScene'
import type { OfficeConnection, OfficeRoom } from '../network/connection'
import { avatarBadge } from './avatarThumb'
import { focusChatInput } from './chat'
import { personColor } from './personColor'
import { clearSelection, onSelection, pickedByKeyboard, selectedPerson } from './selection'
import { toast } from './toasts'

/**
 * The card that floats over somebody when you pick them out.
 *
 * It is DOM and not drawn into the canvas: it is a piece of interface - text,
 * buttons, a menu, a focus order - and everything it needs already exists in
 * CSS, while in the scene it would all have to be rebuilt in Phaser and would
 * stop being reachable by keyboard.
 *
 * It follows its avatar every frame, so it stays over their head while either
 * of you walks, and it closes by itself when they leave the world.
 */

/** Side of the portrait, in px. */
const PORTRAIT = 56
/** Gap between the card and the head it sits over, in px. */
const ANCHOR_GAP = 14
/** Smallest gap between the card and the edges of the game area, in px. */
const EDGE_GAP = 8
/**
 * How long the Wave button stays spent after a wave. The server holds the same
 * cooldown, so this is what keeps the two in step - and what makes the button
 * say what the server would have said instead of swallowing the refusal.
 */
const WAVE_COOLDOWN_MS = 3000

function icon(path: string, label: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  el.setAttribute('d', path)
  svg.append(el)
  svg.dataset.icon = label
  return svg
}

const ICON_CHAT =
  'M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-2.8-.4L3 21l1.6-4.8A8.2 8.2 0 0 1 3.6 11.5a8.4 8.4 0 0 1 9-8.4 8.4 8.4 0 0 1 8.4 8.4Z'
const ICON_GO = 'M4 12h13M13 6l6 6-6 6'
const ICON_MORE = 'M12 6.2v.01M12 12v.01M12 17.8v.01'

export function mountPersonCard(connection: OfficeConnection, scene: OfficeScene) {
  const host = document.getElementById('game')!

  const card = document.createElement('section')
  card.className = 'pcard'
  card.id = 'person-card'
  card.hidden = true
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-label', 'Person')

  // --- who ------------------------------------------------------------------
  const portrait = document.createElement('span')
  portrait.className = 'pcard__portrait'
  const nameEl = document.createElement('h2')
  nameEl.className = 'pcard__name'
  const statusEl = document.createElement('p')
  statusEl.className = 'pcard__status'
  const who = document.createElement('header')
  who.className = 'pcard__who'
  const id = document.createElement('div')
  id.className = 'pcard__id'
  id.append(nameEl, statusEl)
  who.append(portrait, id)

  // --- actions --------------------------------------------------------------
  const waveBtn = document.createElement('button')
  waveBtn.type = 'button'
  waveBtn.className = 'pcard__primary'
  const waveGlyph = document.createElement('span')
  waveGlyph.className = 'pcard__wave'
  waveGlyph.textContent = '\u{1F44B}'
  waveGlyph.setAttribute('aria-hidden', 'true')
  const waveLabel = document.createElement('span')
  waveLabel.textContent = 'Wave'
  waveBtn.append(waveGlyph, waveLabel)

  const iconButton = (path: string, label: string) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'pcard__icon'
    button.title = label
    button.setAttribute('aria-label', label)
    button.append(icon(path, label))
    return button
  }
  const chatBtn = iconButton(ICON_CHAT, 'Chat')
  const goBtn = iconButton(ICON_GO, 'Go to them')
  const moreBtn = iconButton(ICON_MORE, 'More')
  moreBtn.setAttribute('aria-expanded', 'false')

  const actions = document.createElement('div')
  actions.className = 'pcard__actions'
  actions.append(waveBtn, chatBtn, goBtn, moreBtn)

  // --- the overflow menu ----------------------------------------------------
  const menu = document.createElement('div')
  menu.className = 'pcard__menu'
  menu.hidden = true
  menu.setAttribute('role', 'group')

  // Built once and only ever updated in place. It used to be rebuilt from
  // `render`, which runs every frame to keep the card over its avatar - so the
  // button under the pointer was destroyed and replaced sixty times a second
  // and a click could never land on it.
  const menuLine = document.createElement('p')
  menuLine.className = 'pcard__menuline'
  const awayItem = document.createElement('button')
  awayItem.type = 'button'
  awayItem.className = 'pcard__menuitem'
  const renameItem = document.createElement('button')
  renameItem.type = 'button'
  renameItem.className = 'pcard__menuitem'
  renameItem.textContent = 'Change my name'
  menu.append(menuLine, awayItem, renameItem)

  card.append(who, actions, menu)
  host.append(card)

  let room: OfficeRoom | undefined
  let frame = 0
  let waveUntil = 0
  let menuOpen = false
  /** What the card was opened from, so the focus can be handed back. */
  let opener: HTMLElement | undefined
  /** Which portrait is on the card, so it is not rebuilt for nothing. */
  let shownPortrait = ''

  const target = () => selectedPerson()
  const playerOf = (sessionId: string): Player | undefined =>
    room?.state.players.get(sessionId) ?? undefined
  const myBubble = () => (room ? (playerOf(room.sessionId)?.bubbleId ?? '') : '')
  /** Are we in the same conversation, so the chat can actually reach them? */
  const sharesBubble = (sessionId: string) => {
    const mine = myBubble()
    return mine !== '' && playerOf(sessionId)?.bubbleId === mine
  }

  function close(returnFocus = true) {
    const back = opener
    opener = undefined
    closeMenu()
    clearSelection()
    if (returnFocus) {
      // Back where it came from, or to the game when that is gone.
      if (back?.isConnected) back.focus()
      else host.querySelector('canvas')?.focus()
    }
  }

  function closeMenu() {
    menuOpen = false
    menu.hidden = true
    moreBtn.setAttribute('aria-expanded', 'false')
  }

  const STATUS_LINE: Record<string, string> = {
    focused: 'Heads-down at a desk: not available to talk',
    away: 'Away from the keyboard',
    offline: 'Lost connection',
    active: 'Here and available',
  }

  function renderMenu(player: Player) {
    menuLine.textContent = STATUS_LINE[playerStatus(player)] ?? STATUS_LINE.active
    const me = room ? playerOf(room.sessionId) : undefined
    awayItem.hidden = !me
    renameItem.hidden = !me
    if (me) awayItem.textContent = me.away ? 'Mark me back' : 'Mark me away'
  }

  awayItem.addEventListener('click', () => {
    const me = room ? playerOf(room.sessionId) : undefined
    if (!me) return
    connection.setAway(!me.away)
    closeMenu()
  })

  renameItem.addEventListener('click', () => {
    closeMenu()
    close(false)
    document.getElementById('my-name')?.focus()
  })

  /** Redraws everything about the card that can change while it is open. */
  function render() {
    const sessionId = target()
    if (sessionId === '') return
    const player = playerOf(sessionId)
    if (!player || !scene.hasPerson(sessionId)) {
      // They left the office while their card was open.
      close()
      return
    }

    const color = personColor(room, sessionId)
    card.style.setProperty('--person', color)
    nameEl.textContent = player.name
    const status = playerStatus(player)
    card.dataset.status = status
    statusEl.textContent = PLAYER_STATUS_TEXT[status]
    // Same reason as the menu: `render` runs every frame, and rebuilding the
    // portrait each time would throw away and recreate an image sixty times a
    // second for nothing.
    const portraitKey = `${player.avatar}|${color}`
    if (portraitKey !== shownPortrait) {
      shownPortrait = portraitKey
      portrait.replaceChildren(avatarBadge(player.avatar, color, PORTRAIT))
    }

    const now = Date.now()
    const spent = now < waveUntil
    waveBtn.disabled = spent
    waveLabel.textContent = spent ? 'Waved' : 'Wave'

    // Chat is never dead: near them it opens the field, and from across the
    // room it walks you over and opens it when you get there.
    const near = sharesBubble(sessionId)
    chatBtn.title = near ? 'Chat' : 'Walk over and chat'
    chatBtn.setAttribute('aria-label', chatBtn.title)
    goBtn.disabled = scene.walking
    if (menuOpen) renderMenu(player)
  }

  /** Keeps the card over its avatar's head, and inside the game area. */
  function place() {
    const sessionId = target()
    if (sessionId === '') return
    const anchor = scene.anchorOf(sessionId)
    if (!anchor) return
    const box = host.getBoundingClientRect()
    const width = card.offsetWidth
    const height = card.offsetHeight

    let top = anchor.headY - height - ANCHOR_GAP
    // No room above: it drops below their feet instead of being clipped.
    const below = top < EDGE_GAP
    if (below) top = anchor.footY + ANCHOR_GAP
    card.dataset.side = below ? 'below' : 'above'

    const left = Math.min(
      Math.max(anchor.x - width / 2, EDGE_GAP),
      Math.max(EDGE_GAP, box.width - width - EDGE_GAP),
    )
    top = Math.min(Math.max(top, EDGE_GAP), Math.max(EDGE_GAP, box.height - height - EDGE_GAP))
    card.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
  }

  function tick() {
    if (target() === '') return
    render()
    if (target() !== '') place()
    frame = requestAnimationFrame(tick)
  }

  function open() {
    card.hidden = false
    shownPortrait = ''
    render()
    // Laid out once before the first paint, so it never flashes at 0,0.
    place()
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(tick)
    // Reached by keyboard: the keyboard comes with it, so Tab walks the card's
    // own buttons and Esc hands it back. Reached by mouse it is left alone -
    // clicking somebody across the room must not take the movement keys away.
    if (pickedByKeyboard()) waveBtn.focus()
  }

  onSelection((sessionId) => {
    if (sessionId === '') {
      cancelAnimationFrame(frame)
      card.hidden = true
      closeMenu()
      return
    }
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    open()
  })

  // --- the actions ----------------------------------------------------------
  waveBtn.addEventListener('click', () => {
    const sessionId = target()
    if (sessionId === '' || !connection.sendWave(sessionId)) return
    waveUntil = Date.now() + WAVE_COOLDOWN_MS
    render()
    window.setTimeout(render, WAVE_COOLDOWN_MS)
  })

  chatBtn.addEventListener('click', () => {
    const sessionId = target()
    if (sessionId === '') return
    if (sharesBubble(sessionId)) {
      close(false)
      focusChatInput()
      return
    }
    const name = playerOf(sessionId)?.name ?? 'them'
    if (!scene.walkTo(sessionId, () => focusChatInput())) {
      toast(`No way through to ${name}`)
      return
    }
    toast(`Walking over to ${name}...`)
    close(false)
  })

  goBtn.addEventListener('click', () => {
    const sessionId = target()
    if (sessionId === '') return
    const name = playerOf(sessionId)?.name ?? 'them'
    if (!scene.walkTo(sessionId)) {
      toast(`No way through to ${name}`)
      return
    }
    toast(`Walking over to ${name}...`)
    close(false)
  })

  moreBtn.addEventListener('click', () => {
    const player = playerOf(target())
    if (!player) return
    menuOpen = !menuOpen
    menu.hidden = !menuOpen
    moreBtn.setAttribute('aria-expanded', String(menuOpen))
    if (menuOpen) {
      renderMenu(player)
      place()
    }
  })

  // --- closing --------------------------------------------------------------
  // A click anywhere outside puts it away. The canvas has its own handler
  // (which picks whoever was clicked, or nobody), so it is left alone here.
  document.addEventListener('pointerdown', (event) => {
    if (target() === '') return
    const node = event.target
    if (!(node instanceof Node)) return
    if (card.contains(node) || node instanceof HTMLCanvasElement) return
    // A row in the people list picks somebody: that is not "outside".
    if (node instanceof Element && node.closest('.presence__row')) return
    close(false)
  })

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || target() === '') return
    // Esc closes the menu first, then the card.
    event.preventDefault()
    if (menuOpen) {
      closeMenu()
      moreBtn.focus()
      return
    }
    close()
  })

  connection.on('room', (next) => {
    room = next
    if (target() !== '') close(false)
  })
  if (connection.room) room = connection.room
  connection.on('status', (status) => {
    if (status === 'disconnected') close(false)
  })
}
