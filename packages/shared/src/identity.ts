import { DEFAULT_AVATAR, isAvatarId } from './avatars'

export const NAME_MAX_LENGTH = 20

/** What the client sends as `options` when joining a world's room. */
export interface JoinOptions {
  name?: string
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
