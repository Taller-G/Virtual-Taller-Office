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

export const config = {
  serverUrl,
} as const
