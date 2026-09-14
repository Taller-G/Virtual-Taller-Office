/**
 * Configuración del cliente. Vite inyecta en build las variables `VITE_*`
 * (ver `.env.example`): la URL del servidor no se hardcodea.
 */
const serverUrl = import.meta.env.VITE_SERVER_URL as string | undefined

if (!serverUrl) {
  throw new Error(
    'Falta VITE_SERVER_URL. Copiá apps/client/.env.example a .env y poné la URL del servidor.',
  )
}

/** Carpeta con las hojas de sprites de los avatares (`<id>.png`). */
const avatarsUrl = '/assets/avatars/'

/** Logo de Taller en pixel art, decoración de la recepción. */
const logoUrl = '/assets/logo/taller-logo-pixel.png'

/** `?debug` en la URL dibuja cuerpos de colisión, spawns y puertas. */
const debug = new URLSearchParams(window.location.search).has('debug')

export const config = {
  serverUrl,
  avatarsUrl,
  logoUrl,
  debug,
} as const
