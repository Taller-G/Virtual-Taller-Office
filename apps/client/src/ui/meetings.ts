import {
  MEETING_MAX_MINUTES,
  MEETING_MIN_MINUTES,
  MEETING_REJECTION_TEXT,
  MEETING_TITLE_MAX_LENGTH,
  meetingIsOpen,
  meetingIsOver,
  meetingIsToday,
  meetingOpensAt,
  worldName,
  type MeetingErrorPayload,
  type MeetingRejection,
  type MeetingSchedulePayload,
} from '@vto/shared'
import type { OfficeConnection, OfficeRoom } from '../network/connection'
import { myPersonId } from '../network/person'
import { toast } from './toasts'

/**
 * The "Upcoming meetings" panel: what is on today, and the one action that
 * takes you to it.
 *
 * Everything shown is `state.meetings`, which is the same in every world's
 * room — so a meeting booked into the First Office is listed, and can be
 * entered, from the Chiron Office too. The client decides nothing: it neither
 * adds a meeting to the list nor removes one, it only draws what the server
 * says and stops offering an action the server would refuse. A meeting leaves
 * the list because it ended or was cancelled, never because this panel thought
 * it should.
 *
 * "Enter meeting" is offered inside the entry window, to the people invited.
 * Pressing it in the world the room is in is one message; from another world
 * it is a trip that arrives already seated (`travel`), and a trip that does
 * not come off leaves the person exactly where they were with the reason.
 */

/** What the panel needs of the scene to reach a meeting in another world. */
export interface MeetingTravel {
  travelToMeeting(
    worldId: string,
    meetingId: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }>
}

/** How often the list is re-derived so an entry window opens on its own. */
const TICK_MS = 1_000
/** Duration the form starts on. */
const DEFAULT_MINUTES = 30
/** How far ahead the form's start time is set, in minutes. */
const DEFAULT_LEAD_MINUTES = 10

/** Which refusals belong to the scheduling form rather than to the office. */
const FORM_REASONS: ReadonlySet<MeetingRejection> = new Set<MeetingRejection>([
  'title_empty',
  'title_too_long',
  'start_past',
  'start_too_far',
  'duration_out_of_range',
  'unknown_room',
  'room_conflict',
])

const clock = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' })

/** A meeting as this panel needs it, already decided against the clock. */
interface MeetingView {
  id: string
  title: string
  worldId: string
  room: string
  startsAt: number
  endsAt: number
  organiserName: string
  mine: boolean
  invited: boolean
  participants: string[]
  /** I am in this meeting right now. */
  inside: boolean
  /** The entry window is open and I was invited. */
  canEnter: boolean
}

export function mountMeetings(connection: OfficeConnection, travel: MeetingTravel) {
  const panel = document.getElementById('meetings')!
  const listEl = document.getElementById('meetings-list')!
  const details = document.getElementById('meetings-new') as HTMLDetailsElement
  const form = document.getElementById('meeting-form') as HTMLFormElement
  const titleInput = document.getElementById('meeting-title') as HTMLInputElement
  const startInput = document.getElementById('meeting-start') as HTMLInputElement
  const minutesInput = document.getElementById('meeting-minutes') as HTMLInputElement
  const roomSelect = document.getElementById('meeting-room') as HTMLSelectElement
  const invitedEl = document.getElementById('meeting-invited')!
  const errorEl = document.getElementById('meeting-error')!

  titleInput.maxLength = MEETING_TITLE_MAX_LENGTH
  minutesInput.min = String(MEETING_MIN_MINUTES)
  minutesInput.max = String(MEETING_MAX_MINUTES)
  minutesInput.step = '5'
  minutesInput.value = String(DEFAULT_MINUTES)

  let room: OfficeRoom | undefined
  let unbind: (() => void) | undefined
  /**
   * What each part last drew. Redrawing rebuilds the nodes, and a node that is
   * rebuilt under the pointer never receives the click that was aimed at it —
   * so nothing is redrawn until what it shows has actually changed. The state
   * patches here several times a second (everybody's footsteps are in it).
   */
  let drawn = ''
  let drawnRooms = ''
  let drawnRoster = ''
  /** Who is ticked in the invite list, kept across redraws by `personId`. */
  const invited = new Set<string>()
  /** A trip is under way: the button says so and does not fire twice. */
  let travelling = false

  // --- Reading the state ---------------------------------------------------

  function views(now: number): MeetingView[] {
    const state = room?.state
    if (!state) return []
    const me = myPersonId()
    const list: MeetingView[] = []
    state.meetings.forEach((meeting) => {
      // Today's, and only while they are still running: a meeting is dropped
      // by the server the moment it ends, and this is the same rule drawn a
      // second earlier so nothing lingers between patches.
      if (meetingIsOver(meeting, now) || !meetingIsToday(meeting, now)) return
      const wasInvited = [...meeting.invited].some((person) => person.personId === me)
      const participants = [...meeting.participants].map((person) => person.name)
      const inside = [...meeting.participants].some((person) => person.personId === me)
      list.push({
        id: meeting.id,
        title: meeting.title,
        worldId: meeting.worldId,
        room: meeting.room,
        startsAt: meeting.startsAt,
        endsAt: meeting.endsAt,
        organiserName: meeting.organiserName,
        mine: meeting.organiser === me,
        invited: wasInvited,
        participants,
        inside,
        canEnter: wasInvited && !inside && meetingIsOpen(meeting, now),
      })
    })
    return list.sort((a, b) => a.startsAt - b.startsAt || a.title.localeCompare(b.title, 'en'))
  }

  /** Everyone else in this world, as the invite list offers them. */
  function roster(): { personId: string; name: string }[] {
    const state = room?.state
    if (!state) return []
    const me = myPersonId()
    const people: { personId: string; name: string }[] = []
    state.players.forEach((player) => {
      if (player.personId === '' || player.personId === me) return
      people.push({ personId: player.personId, name: player.name })
    })
    return people.sort((a, b) => a.name.localeCompare(b.name, 'en'))
  }

  // --- Drawing -------------------------------------------------------------

  const when = (view: MeetingView) => `${clock.format(view.startsAt)}–${clock.format(view.endsAt)}`

  function where(view: MeetingView): string {
    const elsewhere = view.worldId !== connection.worldId
    return elsewhere ? `${view.room} · ${worldName(view.worldId)}` : view.room
  }

  function row(view: MeetingView): HTMLLIElement {
    const li = document.createElement('li')
    li.className = 'meetings__row'
    li.dataset.meeting = view.id
    li.dataset.mine = String(view.inside)

    const name = document.createElement('p')
    name.className = 'meetings__name'
    name.textContent = view.title

    const place = document.createElement('p')
    place.className = 'meetings__where'
    place.textContent = `${where(view)} · ${when(view)} · ${view.mine ? 'you' : view.organiserName}`

    const who = document.createElement('p')
    who.className = 'meetings__who'
    who.dataset.any = String(view.participants.length > 0)
    who.textContent =
      view.participants.length === 0
        ? 'Nobody has come in yet'
        : `In the room: ${view.participants.join(', ')}`

    li.append(name, place, who)

    const actions = document.createElement('div')
    actions.className = 'meetings__actions'
    if (view.inside) {
      actions.append(button('Leave meeting', 'ghost', () => connection.leaveMeeting(view.id)))
    } else if (view.canEnter) {
      const enter = button('Enter meeting', 'solid', () => void goIn(view))
      enter.disabled = travelling
      actions.append(enter)
    } else if (view.invited) {
      // Invited but not yet: say when the door opens rather than leaving a
      // dead button or nothing at all.
      const soon = document.createElement('span')
      soon.className = 'meetings__who'
      soon.textContent = `Opens at ${clock.format(meetingOpensAt(view))}`
      actions.append(soon)
    }
    if (view.mine) {
      actions.append(
        button('Cancel', 'ghost', () => {
          connection.cancelMeeting(view.id)
        }),
      )
    }
    if (actions.childElementCount > 0) li.append(actions)
    return li
  }

  function button(label: string, kind: 'solid' | 'ghost', onClick: () => void): HTMLButtonElement {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = kind === 'ghost' ? 'button button--ghost' : 'button'
    el.textContent = label
    el.addEventListener('click', () => {
      onClick()
      el.blur()
    })
    return el
  }

  function render() {
    const list = views(Date.now())
    // Redrawing every second would fight with the pointer; the signature is
    // everything the rows show, so nothing is redrawn until something changed.
    const signature = JSON.stringify([
      list.map((view) => [
        view.id,
        view.title,
        view.room,
        view.worldId,
        view.startsAt,
        view.endsAt,
        view.organiserName,
        view.mine,
        view.invited,
        view.inside,
        view.canEnter,
        view.participants,
      ]),
      travelling,
      connection.worldId,
    ])
    if (signature === drawn) return
    drawn = signature
    panel.dataset.state = list.length > 0 ? 'some' : 'none'
    listEl.replaceChildren(...list.map(row))
  }

  /** The rooms on offer, straight from the state (they come off the maps). */
  function renderRooms() {
    const state = room?.state
    const chosen = roomSelect.value
    const signature = JSON.stringify([
      state ? [...state.meetingRooms].map((r) => [r.worldId, r.name]) : [],
      connection.worldId,
    ])
    if (signature === drawnRooms) return
    drawnRooms = signature
    const options = state
      ? [...state.meetingRooms].map((meetingRoom) => ({
          value: `${meetingRoom.worldId}|${meetingRoom.name}`,
          label:
            meetingRoom.worldId === connection.worldId
              ? meetingRoom.name
              : `${meetingRoom.name} (${worldName(meetingRoom.worldId)})`,
        }))
      : []
    roomSelect.replaceChildren(
      ...options.map(({ value, label }) => {
        const option = document.createElement('option')
        option.value = value
        option.textContent = label
        return option
      }),
    )
    if (options.some((option) => option.value === chosen)) roomSelect.value = chosen
  }

  function renderInvited() {
    const people = roster()
    const signature = JSON.stringify(people)
    if (signature === drawnRoster) return
    drawnRoster = signature
    // Anybody who has left the office stops being invitable, and stops being
    // ticked: inviting a name nobody can see would invite nobody.
    for (const personId of [...invited]) {
      if (!people.some((person) => person.personId === personId)) invited.delete(personId)
    }
    if (people.length === 0) {
      const alone = document.createElement('p')
      alone.className = 'meetings__nobody'
      alone.textContent = 'Nobody else is here to invite yet.'
      invitedEl.replaceChildren(alone)
      return
    }
    invitedEl.replaceChildren(
      ...people.map((person) => {
        const label = document.createElement('label')
        label.className = 'meetings__invitee'
        const check = document.createElement('input')
        check.type = 'checkbox'
        check.checked = invited.has(person.personId)
        check.addEventListener('change', () => {
          if (check.checked) invited.add(person.personId)
          else invited.delete(person.personId)
        })
        const name = document.createElement('span')
        name.textContent = person.name
        label.append(check, name)
        return label
      }),
    )
  }

  // --- Acting --------------------------------------------------------------

  /**
   * Entering. In this world it is one message and the server answers by
   * putting you in a chair; in another it is the trip first, arriving already
   * seated. Either way a refusal leaves you exactly where you were, with the
   * reason said out loud.
   */
  async function goIn(view: MeetingView) {
    if (travelling) return
    if (view.worldId === connection.worldId) {
      connection.enterMeeting(view.id)
      return
    }
    travelling = true
    drawn = ''
    render()
    try {
      const outcome = await travel.travelToMeeting(view.worldId, view.id)
      if (!outcome.ok) toast(outcome.reason)
    } finally {
      travelling = false
      drawn = ''
      render()
    }
  }

  /** The start time the form means: that time of day, today. */
  function startsAtFrom(value: string): number {
    const [hours, minutes] = value.split(':').map(Number)
    const at = new Date()
    at.setHours(hours, minutes, 0, 0)
    return at.getTime()
  }

  /** The form's opening state: a title to overwrite and a time soon enough to use. */
  function resetForm() {
    titleInput.value = ''
    minutesInput.value = String(DEFAULT_MINUTES)
    const at = new Date(Date.now() + DEFAULT_LEAD_MINUTES * 60_000)
    at.setSeconds(0, 0)
    startInput.value = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
    invited.clear()
    errorEl.textContent = ''
    drawnRoster = ''
    renderInvited()
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const [worldId, ...rest] = roomSelect.value.split('|')
    const draft: MeetingSchedulePayload = {
      title: titleInput.value,
      startsAt: startsAtFrom(startInput.value),
      minutes: Number(minutesInput.value),
      worldId,
      room: rest.join('|'),
      invited: [...invited],
    }
    errorEl.textContent = ''
    connection.scheduleMeeting(draft)
  })

  details.addEventListener('toggle', () => {
    if (details.open) resetForm()
  })

  // --- The office ----------------------------------------------------------

  function bind(next: OfficeRoom) {
    unbind?.()
    room = next
    drawn = ''
    drawnRooms = ''
    drawnRoster = ''
    const refresh = () => {
      renderRooms()
      renderInvited()
      render()
    }
    next.onStateChange(refresh)
    unbind = () => next.onStateChange.remove(refresh)
    refresh()
  }

  function clear() {
    unbind?.()
    unbind = undefined
    room = undefined
    drawn = ''
    drawnRooms = ''
    drawnRoster = ''
    invited.clear()
    render()
    renderInvited()
  }

  connection.on('room', bind)
  if (connection.room) bind(connection.room)
  connection.on('status', (status) => {
    if (status === 'disconnected') clear()
  })

  connection.on('meetingError', (error) => showRefusal(error))
  connection.on('meetingEnded', (ended) => {
    toast(
      ended.reason === 'cancelled'
        ? `"${ended.title}" was cancelled`
        : `"${ended.title}" has ended`,
    )
  })

  /**
   * A refusal. The ones about the meeting being booked go back into the form,
   * where the field that has to change is; the rest are about the office and
   * are said where anything else about the office is said.
   */
  function showRefusal(error: MeetingErrorPayload) {
    let text = MEETING_REJECTION_TEXT[error.reason] ?? 'That did not work.'
    if (error.conflict) {
      const { title, startsAt, endsAt } = error.conflict
      text = `That room is taken by "${title}" (${clock.format(startsAt)}–${clock.format(endsAt)}).`
    }
    if (FORM_REASONS.has(error.reason)) {
      errorEl.textContent = text
      details.open = true
    } else {
      toast(text)
    }
  }

  // A meeting opens by the clock, not by anything the server sends, so the
  // list is re-derived on its own. It redraws only when something changed.
  setInterval(render, TICK_MS)
  resetForm()
  render()
}
