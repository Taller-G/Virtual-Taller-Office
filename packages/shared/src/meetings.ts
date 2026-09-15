/**
 * Meetings: something that is planned in the office, given a room, and
 * entered.
 *
 * A meeting is a title, a stretch of time, one of the world's **meeting
 * rooms** (see `PROP_ZONE_MEETING` in `map.ts`) and the people its organiser
 * invited. Entering one puts you in a chair around that room's big table in a
 * single step and in the same conversation as everyone else who entered,
 * however far apart the table puts you.
 *
 * The rules live here, deliberately shared: the panel applies them to decide
 * what to offer and what to say, and the server applies them again as the
 * authority, because a client can lie. Neither side gets to hold an opinion
 * the other does not.
 *
 * Nothing here is stored: meetings live in the server's memory for as long as
 * the server runs (see `apps/server/src/meetings.ts`).
 */

import { normalizeLine } from './text'

/** Longest a title may be, once normalised. */
export const MEETING_TITLE_MAX_LENGTH = 60
/** Shortest meeting anybody can book, in minutes. Zero is not a meeting. */
export const MEETING_MIN_MINUTES = 5
/** Longest meeting anybody can book, in minutes (four hours). */
export const MEETING_MAX_MINUTES = 240
/** How far ahead a meeting can be scheduled, in days. */
export const MEETING_MAX_DAYS_AHEAD = 7
/**
 * How long before the start time "Enter meeting" appears. Before that the
 * meeting is listed but there is nothing to press: turning up five minutes
 * early is turning up, turning up an hour early is sitting in an empty room.
 */
export const MEETING_ENTRY_WINDOW_MS = 5 * 60_000

/** Every way a meeting action can be refused. Each one has a message below. */
export type MeetingRejection =
  | 'title_empty'
  | 'title_too_long'
  | 'start_past'
  | 'start_too_far'
  | 'duration_out_of_range'
  | 'unknown_room'
  | 'room_conflict'
  | 'not_found'
  | 'not_organiser'
  | 'not_invited'
  | 'too_early'
  | 'over'
  | 'already_in'
  | 'travel_failed'
  | 'offline'

/**
 * What each refusal says. `room_conflict` deliberately leaves out the
 * conflicting meeting: the server sends that alongside, and the panel adds it
 * in the reader's own time zone (the server's is nobody's).
 */
export const MEETING_REJECTION_TEXT: Record<MeetingRejection, string> = {
  title_empty: 'Give the meeting a title.',
  title_too_long: `A title cannot be longer than ${MEETING_TITLE_MAX_LENGTH} characters.`,
  start_past: 'A meeting has to start in the future.',
  start_too_far: `A meeting cannot be scheduled more than ${MEETING_MAX_DAYS_AHEAD} days ahead.`,
  duration_out_of_range: `A meeting lasts between ${MEETING_MIN_MINUTES} and ${MEETING_MAX_MINUTES} minutes.`,
  unknown_room: 'That meeting room does not exist.',
  room_conflict: 'That room is already booked at that time.',
  not_found: 'That meeting is no longer there.',
  not_organiser: 'Only the organiser can cancel this meeting.',
  not_invited: 'This meeting is invite-only.',
  too_early: 'The meeting has not opened yet.',
  over: 'That meeting is already over.',
  already_in: 'You are already in this meeting.',
  travel_failed: 'Could not get to the meeting room.',
  offline: 'No connection to the server.',
}

/** What a client asks for when it schedules a meeting. */
export interface MeetingDraft {
  title: string
  /** Start of the meeting (epoch ms). */
  startsAt: number
  /** How long it lasts, in minutes. */
  minutes: number
  /** Id of the world the room is in. */
  worldId: string
  /** Name of the meeting room (a zone marked `meeting` in that world's map). */
  room: string
  /** `personId`s of the people invited; the organiser is added by the server. */
  invited: string[]
}

/**
 * Normalises a title exactly the way a chat message is normalised (see
 * `normalizeLine`): no invisible characters, whitespace collapsed, ends
 * trimmed. It is shown as plain text everywhere, so nothing is escaped.
 */
export function sanitizeMeetingTitle(value: unknown): string {
  return normalizeLine(value)
}

/** A meeting as everyone reads it: the fields the rules below are decided on. */
export interface MeetingTimes {
  startsAt: number
  endsAt: number
}

export type MeetingDraftResult =
  | { ok: true; title: string; startsAt: number; endsAt: number; minutes: number }
  | { ok: false; reason: MeetingRejection }

/**
 * Validates the title, the start time and the duration of a draft. The room
 * and the invitees are not checked here: whether a room exists and whether it
 * is free are questions only the server (which holds the maps and every
 * meeting) can answer.
 *
 * The length is **rejected**, not truncated, and a start time already gone is
 * rejected rather than nudged forward: whoever books has to see what happened.
 */
export function validateMeetingDraft(
  draft: Partial<MeetingDraft>,
  now: number,
): MeetingDraftResult {
  const title = sanitizeMeetingTitle(draft?.title)
  if (title.length === 0) return { ok: false, reason: 'title_empty' }
  if (title.length > MEETING_TITLE_MAX_LENGTH) return { ok: false, reason: 'title_too_long' }

  const startsAt = Math.round(Number(draft?.startsAt))
  if (!Number.isFinite(startsAt) || startsAt <= now) return { ok: false, reason: 'start_past' }
  if (startsAt - now > MEETING_MAX_DAYS_AHEAD * 24 * 60 * 60_000) {
    return { ok: false, reason: 'start_too_far' }
  }

  const minutes = Math.round(Number(draft?.minutes))
  if (!Number.isFinite(minutes) || minutes < MEETING_MIN_MINUTES || minutes > MEETING_MAX_MINUTES) {
    return { ok: false, reason: 'duration_out_of_range' }
  }

  return { ok: true, title, startsAt, endsAt: startsAt + minutes * 60_000, minutes }
}

/**
 * Do two bookings of the same room clash? Half-open intervals, so a meeting
 * that ends exactly when the next one starts is not a conflict: back-to-back
 * meetings in one room are ordinary.
 */
export function meetingsOverlap(a: MeetingTimes, b: MeetingTimes): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt
}

/** Has the meeting's end time passed? Then it is over for everyone. */
export function meetingIsOver(meeting: MeetingTimes, now: number): boolean {
  return now >= meeting.endsAt
}

/** When "Enter meeting" starts being offered. */
export function meetingOpensAt(meeting: MeetingTimes): number {
  return meeting.startsAt - MEETING_ENTRY_WINDOW_MS
}

/**
 * Is the meeting open to walk into right now? From `MEETING_ENTRY_WINDOW_MS`
 * before the start until the end time. Before that there is no button; after
 * it the meeting is gone.
 */
export function meetingIsOpen(meeting: MeetingTimes, now: number): boolean {
  return now >= meetingOpensAt(meeting) && !meetingIsOver(meeting, now)
}

/**
 * Why entering is refused right now, or `undefined` if it is not. The
 * invitation is checked before the clock on purpose: somebody who was not
 * invited is told exactly that whenever they try, rather than "come back in an
 * hour" for a meeting that was never theirs to walk into.
 */
export function meetingEntryRefusal(
  meeting: MeetingTimes & { invited: readonly string[] },
  personId: string,
  now: number,
): MeetingRejection | undefined {
  if (!meeting.invited.includes(personId)) return 'not_invited'
  if (meetingIsOver(meeting, now)) return 'over'
  if (now < meetingOpensAt(meeting)) return 'too_early'
  return undefined
}

/** Does the meeting start on the same day (local time) as `now`? */
export function meetingIsToday(meeting: MeetingTimes, now: number): boolean {
  const start = new Date(meeting.startsAt)
  const today = new Date(now)
  return (
    start.getFullYear() === today.getFullYear() &&
    start.getMonth() === today.getMonth() &&
    start.getDate() === today.getDate()
  )
}
