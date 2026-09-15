/**
 * Client configuration. Vite injects the `VITE_*` variables at build time
 * (see `.env.example`): the server URL is not hard-coded.
 */
const serverUrl = import.meta.env.VITE_SERVER_URL as string | undefined

if (!serverUrl) {
  throw new Error(
    'VITE_SERVER_URL is missing. Copy apps/client/.env.example to .env and set the server URL.',
  )
}

/** Folder with the avatars' sprite sheets (`<id>.png`). */
const avatarsUrl = '/assets/avatars/'

/** Folder with the mascots' sprite sheets (`<type>.png`, see `AGENT_TYPES`). */
const mascotsUrl = '/assets/mascots/'

/** Taller logo in pixel art, decoration for the reception. */
const logoUrl = '/assets/logo/taller-logo-pixel.png'

/** `?debug` in the URL draws collision bodies, spawns and doors. */
const debug = new URLSearchParams(window.location.search).has('debug')

export const config = {
  serverUrl,
  avatarsUrl,
  mascotsUrl,
  logoUrl,
  debug,
} as const
