import {
  findMeetingRooms,
  meetingEntryRefusal,
  meetingIsOver,
  meetingsOverlap,
  validateMeetingDraft,
  type MeetingDraft,
  type MeetingRejection,
} from '@vto/shared'
import { worldMaps } from './map'

/**
 * The office's meetings.
 *
 * Every meeting of every world lives here, in **one** book shared by all the
 * world rooms: a meeting is booked into a room of the First Office, but it is
 * listed — and can be entered — from the Chiron Office too, and that only
 * works if there is a single list rather than one per room. Each room mirrors
 * this into its own `state.meetings` and tells its clients (see `WorldRoom`).
 *
 * It is **in memory and nowhere else**, by the decision taken with the user:
 * restarting the server empties it, and reconnecting clients find no meetings
 * and no error. There is no file, no database and no recovery.
 *
 * The book owns the rules — who may enter, when, and whether a room is free —
 * and the rooms own the world: which chair somebody lands in is the room's
 * business, because only the room knows who is sitting where. So entering is
 * two steps: the book says yes, the room puts the person somewhere.
 *
 * People are named by `personId` and not by session: the session ends at every
 * door, and an invitee whose name stopped meaning anything the moment they
 * walked into another world would be an invitee who cannot come.
 */

/** Somebody a meeting names: invited to it, or already inside it. */
export interface MeetingPersonRecord {
  personId: string
  /** Their visible name when they were invited, or when they entered. */
  name: string
}

/** A meeting as the book holds it (the rooms copy this into their state). */
export interface MeetingRecord {
  id: string
  title: string
  worldId: string
  room: string
  startsAt: number
  endsAt: number
  organiser: string
  organiserName: string
  invited: MeetingPersonRecord[]
  participants: MeetingPersonRecord[]
}

/** A room a meeting can be booked into, as read off a world's map. */
export interface MeetingRoomRecord {
  worldId: string
  name: string
  /** How many seats its big table has. */
  seats: number
}

/**
 * The book changed and every room has to mirror it again. `closed` says a
 * meeting went and why, which is what the participants have to be told: being
 * tipped out of a conversation without a word is the thing to avoid.
 */
export interface MeetingChange {
  closed?: { meeting: MeetingRecord; reason: 'cancelled' | 'ended' }
}

export type ScheduleOutcome =
  | { ok: true; meeting: MeetingRecord }
  | { ok: false; reason: MeetingRejection; conflict?: MeetingRecord }

export type MeetingOutcome =
  { ok: true; meeting: MeetingRecord } | { ok: false; reason: MeetingRejection }

export class MeetingBook {
  private meetings = new Map<string, MeetingRecord>()
  private rooms?: MeetingRoomRecord[]
  private listeners = new Set<(change: MeetingChange) => void>()
  private nextId = 1

  /**
   * The rooms meetings can be booked into, read off every world's map once.
   * Which rooms those are is map data (a zone marked `meeting`), so adding one
   * is drawing it in Tiled — nothing here lists them.
   */
  roomList(): MeetingRoomRecord[] {
    this.rooms ??= [...worldMaps().values()].flatMap((world) =>
      findMeetingRooms(world.data).map((room) => ({
        worldId: world.world.id,
        name: room.name,
        seats: room.seats.length,
      })),
    )
    return this.rooms
  }

  /** The room with that name in that world, if the map has one. */
  room(worldId: string, name: string): MeetingRoomRecord | undefined {
    return this.roomList().find((room) => room.worldId === worldId && room.name === name)
  }

  /** Every meeting that has not ended, in time order. */
  list(): MeetingRecord[] {
    return [...this.meetings.values()].sort((a, b) => a.startsAt - b.startsAt)
  }

  get(id: string): MeetingRecord | undefined {
    return this.meetings.get(id)
  }

  /** The meeting this person is inside, if any. */
  meetingOf(personId: string): MeetingRecord | undefined {
    if (!personId) return undefined
    return [...this.meetings.values()].find((meeting) =>
      meeting.participants.some((p) => p.personId === personId),
    )
  }

  subscribe(listener: (change: MeetingChange) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * Books a meeting. The title, the start and the duration are checked with
   * the rules both sides share; the room has to exist, and it has to be free:
   * a second meeting overlapping one already in that room is refused, and the
   * one in the way comes back with the refusal so it can be named.
   *
   * The organiser is always invited: they scheduled it.
   */
  schedule(
    draft: Partial<MeetingDraft>,
    organiser: MeetingPersonRecord,
    now: number,
    invitees: MeetingPersonRecord[],
  ): ScheduleOutcome {
    const valid = validateMeetingDraft(draft, now)
    if (!valid.ok) return { ok: false, reason: valid.reason }

    const worldId = String(draft?.worldId ?? '')
    const roomName = String(draft?.room ?? '')
    const room = this.room(worldId, roomName)
    if (!room) return { ok: false, reason: 'unknown_room' }

    const conflict = [...this.meetings.values()].find(
      (other) =>
        other.worldId === room.worldId && other.room === room.name && meetingsOverlap(other, valid),
    )
    if (conflict) return { ok: false, reason: 'room_conflict', conflict }

    // The organiser first, then everybody they named, each one only once.
    const invited: MeetingPersonRecord[] = [organiser]
    for (const person of invitees) {
      if (person.personId === organiser.personId) continue
      if (invited.some((p) => p.personId === person.personId)) continue
      invited.push(person)
    }

    const meeting: MeetingRecord = {
      id: `mt${this.nextId++}`,
      title: valid.title,
      worldId: room.worldId,
      room: room.name,
      startsAt: valid.startsAt,
      endsAt: valid.endsAt,
      organiser: organiser.personId,
      organiserName: organiser.name,
      invited,
      participants: [],
    }
    this.meetings.set(meeting.id, meeting)
    this.notify({})
    return { ok: true, meeting }
  }

  /**
   * Cancels a meeting. Only its organiser can, and only while it is still
   * there. Whoever was inside is released by the rooms, which hear about it
   * through the `closed` change.
   */
  cancel(id: string, personId: string, now: number): MeetingOutcome {
    const meeting = this.meetings.get(id)
    if (!meeting || meetingIsOver(meeting, now)) return { ok: false, reason: 'not_found' }
    if (meeting.organiser !== personId) return { ok: false, reason: 'not_organiser' }
    this.meetings.delete(id)
    this.notify({ closed: { meeting, reason: 'cancelled' } })
    return { ok: true, meeting }
  }

  /**
   * Somebody enters a meeting: invited, within the entry window, and not
   * already in it. Entering one leaves whatever other meeting they were in —
   * you can only be in one conversation.
   *
   * This only records that they are in it. Where in the room they end up is
   * the room's decision (see `WorldRoom`), and if the room cannot place them
   * it calls `leave` to put the book back as it was.
   */
  enter(id: string, person: MeetingPersonRecord, now: number): MeetingOutcome {
    const meeting = this.meetings.get(id)
    if (!meeting) return { ok: false, reason: 'not_found' }
    const refusal = meetingEntryRefusal(
      { ...meeting, invited: meeting.invited.map((p) => p.personId) },
      person.personId,
      now,
    )
    if (refusal) return { ok: false, reason: refusal }
    if (meeting.participants.some((p) => p.personId === person.personId)) {
      return { ok: false, reason: 'already_in' }
    }

    this.leave(person.personId, { quiet: true })
    meeting.participants.push({ ...person })
    this.notify({})
    return { ok: true, meeting }
  }

  /**
   * Somebody is no longer in whatever meeting they were in — they left, stood
   * up, went away or dropped. The meeting itself carries on for the others; a
   * meeting nobody is in is still a meeting, it is simply empty.
   */
  leave(personId: string, options: { quiet?: boolean } = {}): MeetingRecord | undefined {
    const meeting = this.meetingOf(personId)
    if (!meeting) return undefined
    meeting.participants = meeting.participants.filter((p) => p.personId !== personId)
    if (!options.quiet) this.notify({})
    return meeting
  }

  /**
   * Ends every meeting whose time is up. Called on the rooms' clock; whichever
   * room gets there first is the one that ends it, and the change reaches all
   * of them. Returns what it ended, for the caller's log.
   */
  sweep(now: number): MeetingRecord[] {
    const over = [...this.meetings.values()].filter((meeting) => meetingIsOver(meeting, now))
    for (const meeting of over) {
      this.meetings.delete(meeting.id)
      this.notify({ closed: { meeting, reason: 'ended' } })
    }
    return over
  }

  /** Empties the book. Only the tests use it; a restart does the same thing. */
  reset() {
    this.meetings.clear()
    this.nextId = 1
    this.notify({})
  }

  private notify(change: MeetingChange) {
    for (const listener of [...this.listeners]) listener(change)
  }
}

/**
 * The office's one book of meetings. It is a module singleton on purpose:
 * every world's room is a different object in the same process, and they all
 * have to be looking at the same meetings.
 */
export const meetings = new MeetingBook()
