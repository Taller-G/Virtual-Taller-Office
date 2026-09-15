import { DEFAULT_AVATAR, isAvatarId } from './avatars'

export const NAME_MAX_LENGTH = 20

/**
 * Length of a `personId`. It is a random string the client mints, not
 * anything a person types, so there is nothing to be gained by allowing more.
 */
export const PERSON_ID_LENGTH = 24

/** What the client sends as `options` when joining a world's room. */
export interface JoinOptions {
  name?: string
  /**
   * Who is joining, across worlds (see `Player.personId`). The client keeps
   * one per browser tab: crossing a door hands out a new session id, and a
   * meeting's invitees would stop meaning anything if that were the name they
   * were kept under. Absent or unusable, the server mints one.
   */
  personId?: string
  /**
   * Id of the meeting to arrive already seated in, for whoever crossed over
   * from another world in order to enter it. The room applies exactly the
   * same rules as `MEETING_ENTER`; if it refuses, the arrival is an ordinary
   * one through the entrance.
   */
  meeting?: string
  avatar?: string
  /** JSON of `Appearance` (composed look).  Empty or absent = use a preset. */
  appearance?: string
  /**
   * Name of the spawn you arrive through. The door you crossed sets it;
   * without it you enter through the world's entry spawn.
   */
  spawn?: string
  /**
   * How many agent mascots follow you. The server clamps it to a valid count
   * (see `sanitizeAgentCount`); anything unusable reads as none.
   */
  agents?: number
  /**
   * What those mascots look like (an id from `AGENT_TYPES`). The server
   * validates it (see `sanitizeAgentType`); anything unusable reads as the
   * classic robot.
   */
  agentType?: string
  /** The "away" state you travel with, so crossing a door does not lose it. */
  away?: boolean
  /** `true` if that away state had been set by hand by the user. */
  awayManual?: boolean
}

/**
 * Normalises a visible name: trims whitespace (repeated ones included), caps
 * the length and returns `undefined` if nothing usable is left. The server
 * decides the fallback (`Guest-xxxx`).
 */
export function sanitizeName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const name = value.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX_LENGTH).trim()
  return name.length > 0 ? name : undefined
}

/** A valid avatar from the catalogue, or the default avatar. */
export function sanitizeAvatar(value: unknown): string {
  return isAvatarId(value) ? value : DEFAULT_AVATAR
}

export function guestName(sessionId: string): string {
  return `Guest-${sessionId.slice(0, 4)}`
}

const UNSAFE_PERSON_ID = /[^A-Za-z0-9_-]/g

/**
 * A usable `personId` from what the client sent, or `undefined`. It is
 * limited to harmless characters and a fixed length; anything else (a made-up
 * one, an empty one, something that is not a string) is discarded and the
 * server mints one instead, so a client cannot claim to be somebody else by
 * sending an id with a surprise in it.
 */
export function sanitizePersonId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const id = value.replace(UNSAFE_PERSON_ID, '').slice(0, PERSON_ID_LENGTH)
  return id.length > 0 ? id : undefined
}

/** A fresh `personId`. Used by the client on opening a tab, and as the fallback. */
export function newPersonId(): string {
  let id = ''
  while (id.length < PERSON_ID_LENGTH) id += Math.random().toString(36).slice(2)
  return id.slice(0, PERSON_ID_LENGTH)
}
