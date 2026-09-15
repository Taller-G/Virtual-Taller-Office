import { newPersonId, sanitizePersonId } from '@vto/shared'

/**
 * Who this tab is, across worlds.
 *
 * The session ends at every door — each world is its own room — so anything
 * that has to keep pointing at a person after they travel (a meeting's
 * invitees, its participants) names them by this instead. It is kept in
 * `sessionStorage` on purpose, and not in `localStorage` beside the identity:
 * the scope that is wanted is exactly a tab's. Two tabs of the same browser
 * are two people in the office, each with their own avatar, and two people is
 * what they have to stay when a meeting invites one of them; a reload of
 * either is the same person coming back.
 *
 * Without storage (private mode, storage blocked) it still works: the id lives
 * for as long as the page does, which is as long as the person is here.
 */
const KEY = 'vto.personId'

let cached: string | undefined

export function myPersonId(): string {
  if (cached) return cached
  try {
    const stored = sanitizePersonId(sessionStorage.getItem(KEY))
    if (stored) return (cached = stored)
  } catch {
    // No storage: a fresh id per page load is still a usable person.
  }
  cached = newPersonId()
  try {
    sessionStorage.setItem(KEY, cached)
  } catch {
    // Nothing to do: the id simply does not survive a reload.
  }
  return cached
}
