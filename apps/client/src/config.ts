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

/** Mapa Tiled JSON de la oficina. Las imágenes de sus tilesets se resuelven relativas a él. */
const mapUrl =
  (import.meta.env.VITE_MAP_URL as string | undefined) || '/assets/map/oficina-taller.json'

/** Carpeta con las hojas de sprites de los avatares (`<id>.png`). */
const avatarsUrl = '/assets/avatars/'

/** `?debug` en la URL dibuja los cuerpos de colisión (mapa y avatares). */
const debug = new URLSearchParams(window.location.search).has('debug')

export const config = {
  serverUrl,
  mapUrl,
  avatarsUrl,
  debug,
} as const
