# Virtual Taller Office

Oficina virtual 2D de Taller, estilo Gather: avatares en una sala compartida en tiempo real.
Este repositorio contiene la **fundación**: cliente web, servidor en tiempo real y la sala única
**"Oficina Taller"** a la que todo el mundo entra automáticamente, con un ciclo de conexión sólido
(entrar, salir, refrescar, perder la red, caída del servidor).

Stack: [Phaser 3](https://phaser.io/) + [Colyseus 0.18](https://colyseus.io/) + [Vite](https://vite.dev/),
todo en TypeScript.

## Estructura

```
apps/
  client/        Cliente web (Vite + Phaser 3 + @colyseus/sdk). Se despliega como sitio estático.
  server/        Servidor Node (Colyseus). Se despliega aparte, como servicio independiente.
packages/
  shared/        Contratos compartidos: nombre de la sala, mensajes y esquema del estado.
```

Es un monorepo con npm workspaces. El cliente importa de `@vto/shared` las definiciones del estado
y, solo como tipos, la sala del servidor: un typo en un nombre de sala o de mensaje es un error de
compilación, pero nada del servidor termina en el bundle del navegador.

## Requisitos

- **Node 22 o superior** (Colyseus 0.18 lo exige). Hay un `.nvmrc`: con nvm basta `nvm use`.
- npm 10 (viene con Node 22).

## Correr en desarrollo

```bash
git clone https://github.com/Taller-G/Virtual-Taller-Office.git
cd Virtual-Taller-Office
nvm use            # o asegurate de tener Node 22 activo
npm install
npm run dev
```

`npm run dev` levanta las dos partes con un solo comando:

| Parte    | URL                     | Recarga                          |
| -------- | ----------------------- | -------------------------------- |
| Servidor | `ws://localhost:2567`   | `tsx watch`: reinicia al guardar |
| Cliente  | `http://localhost:5173` | Vite HMR                         |

Abrí `http://localhost:5173` en dos navegadores distintos: ambos aparecen en la misma sala sin
elegir nada. `http://localhost:2567/health` devuelve el estado del servidor y cuántos jugadores hay.

Para correr una sola parte: `npm run dev -w apps/server` o `npm run dev -w apps/client`.

## Configuración (variables de entorno)

No hay valores hardcodeados: puerto y URL del servidor salen del entorno. Cada app tiene un
`.env.example` documentado y un `.env.development` con los valores locales.

### Servidor (`apps/server`)

| Variable                  | Default | Qué hace                                                                               |
| ------------------------- | ------- | -------------------------------------------------------------------------------------- |
| `PORT`                    | `2567`  | Puerto HTTP + WebSocket.                                                               |
| `MAX_CLIENTS`             | `50`    | Máximo de jugadores simultáneos en la sala.                                            |
| `RECONNECT_GRACE_SECONDS` | `2`     | Segundos que se sostiene el asiento de un jugador cuya red se cortó antes de quitarlo. |
| `PING_INTERVAL_MS`        | `2000`  | Cada cuánto se hace ping a cada socket.                                                |
| `PING_MAX_RETRIES`        | `2`     | Pings sin respuesta antes de dar la conexión por muerta.                               |

`@colyseus/tools` carga automáticamente `.env.development` o `.env.production` según `NODE_ENV`.
En producción lo habitual es definir las variables en el proveedor de hosting.

### Cliente (`apps/client`)

| Variable          | Default (dev)         | Qué hace                                                   |
| ----------------- | --------------------- | ---------------------------------------------------------- |
| `VITE_SERVER_URL` | `ws://localhost:2567` | URL pública del servidor Colyseus. `wss://` en producción. |
| `VITE_PORT`       | `5173`                | Puerto del servidor de desarrollo de Vite.                 |

Vite inyecta `VITE_SERVER_URL` **en tiempo de build**: para apuntar el sitio estático a otro
servidor hay que volver a construirlo. Si falta, el cliente falla al arrancar con un mensaje claro.

## Cómo funciona la conexión

- **Sala única.** El servidor registra la sala `oficina_taller` con `autoDispose = false` y la crea
  al arrancar; el cliente hace `joinOrCreate` y siempre cae en esa instancia. No hay lobby, salas
  custom ni contraseñas.
- **Entrar.** Al entrar, el servidor agrega un `Player` al estado con la clave `sessionId` y le
  manda al cliente su identificador y los metadatos de la sala. El SDK sincroniza el estado
  completo y luego solo los cambios.
- **Cerrar o refrescar la pestaña.** El cliente hace un `leave` consentido en `pagehide`; el
  servidor lo quita al instante y el resto lo ve desaparecer. Refrescar entra con una sesión nueva,
  así que nunca queda un duplicado.
- **Perder la red.** Si el socket se corta sin aviso, el servidor marca al jugador como
  desconectado (su avatar se atenúa para los demás) y sostiene su asiento
  `RECONNECT_GRACE_SECONDS`. Si vuelve a tiempo conserva la sesión; si no, se lo quita.
- **Caída o reinicio del servidor.** El cliente muestra "Desconectado" y reintenta solo con backoff
  exponencial (1 s, 2 s, 4 s… hasta 10 s) hasta volver a entrar. No hace falta tocar nada.

## Calidad

```bash
npm run lint          # ESLint (flat config + typescript-eslint)
npm run format        # Prettier
npm run typecheck     # tsc en los tres paquetes
npm test              # Vitest: ciclo conectar / desconectar contra un servidor real
npm run check         # todo lo anterior
```

Las pruebas (`apps/server/test`) levantan un servidor Colyseus real con `@colyseus/testing` y
conectan clientes del SDK: verifican que dos clientes se ven, que una salida consentida quita al
jugador de inmediato, que una desconexión sin aviso lo quita antes de 3 segundos, que reconectar
dentro de la gracia conserva la sesión y que refrescar varias veces deja exactamente un jugador.

## Despliegue

Cliente y servidor se despliegan **por separado**.

### Servidor (servicio Node)

```bash
npm ci
npm run build -w apps/server        # genera apps/server/build/index.mjs (bundle ESM)
NODE_ENV=production PORT=2567 npm start -w apps/server
```

Con Docker, construyendo desde la raíz del repo:

```bash
docker build -f apps/server/Dockerfile -t vto-server .
docker run -p 2567:2567 -e PORT=2567 vto-server
```

Sirve en cualquier host que corra Node 22 o contenedores (Render, Railway, Fly.io, una VM con
PM2). Necesita soportar WebSockets. Detrás de un proxy inverso (nginx, Caddy) hay que reenviar las
cabeceras `Upgrade` y `Connection`. El endpoint `GET /health` sirve como chequeo de salud.

### Cliente (sitio estático)

```bash
VITE_SERVER_URL=wss://oficina.tu-dominio.com npm run build -w apps/client
# publicar apps/client/dist
```

Cualquier hosting estático sirve (Netlify, Vercel, Cloudflare Pages, GitHub Pages, un bucket S3).
Configurar `VITE_SERVER_URL` como variable de entorno del build en el proveedor y usar `wss://` si
el sitio se sirve por HTTPS: los navegadores bloquean `ws://` desde páginas seguras.

## Referencias

El diseño toma como referencia [SkyOffice](https://github.com/kevinshen56714/SkyOffice) (Room de
Colyseus con estado sincronizado de jugadores y cliente que escucha altas/bajas), pero está
escrito de cero sobre las versiones actuales de Colyseus (0.18, `@colyseus/sdk`,
`@colyseus/schema` 5 sin decoradores), Phaser 3.90 y Vite 8.
