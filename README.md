# Virtual Taller Office

Oficina virtual 2D de Taller, estilo Gather: avatares en una sala compartida en tiempo real.
Este repositorio contiene la **fundación**: cliente web, servidor en tiempo real y la sala única
**"Oficina Taller"** a la que todo el mundo entra automáticamente, con un ciclo de conexión sólido
(entrar, salir, refrescar, perder la red, caída del servidor); el **mapa 2D de la oficina**
(recepción, escritorios, sala de reunión, cocina) con paredes y muebles que bloquean el paso; y la
**presencia en tiempo real**: cada persona elige nombre y avatar, se mueve con flechas o WASD, ve a
los demás moverse con animación, y un panel muestra quién está y quién está ausente.

El mapa es un archivo [Tiled](https://www.mapeditor.org/) editable por cualquiera del equipo, sin
tocar código: ver [`docs/mapa.md`](docs/mapa.md).

Stack: [Phaser 3](https://phaser.io/) + [Colyseus 0.18](https://colyseus.io/) + [Vite](https://vite.dev/),
todo en TypeScript.

## Estructura

```
apps/
  client/        Cliente web (Vite + Phaser 3 + @colyseus/sdk). Se despliega como sitio estático.
    public/assets/map/       Mapa Tiled de la oficina (oficina-taller.json)
    public/assets/tilesets/  Imágenes de los tilesets que usa el mapa
    public/assets/avatars/   Hojas de sprites de los 8 avatares (<id>.png)
  server/        Servidor Node (Colyseus). Se despliega aparte, como servicio independiente.
packages/
  shared/        Contratos compartidos: sala, mensajes, esquema del estado, mapa, catálogo de avatares e identidad.
tools/
  recolor-avatars.py   Genera las 4 variantes recoloreadas de los avatares (solo desarrollo, Python + Pillow).
docs/
  mapa.md              Cómo editar el mapa en Tiled y qué capas/propiedades espera la app
  licencias-assets.md  Origen y licencia de cada asset gráfico
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

Abrí `http://localhost:5173` en dos navegadores distintos: cada uno elige un nombre y un avatar y
ambos aparecen en la misma sala. `http://localhost:2567/health` devuelve el estado del servidor y cuántos jugadores hay.

Para correr una sola parte: `npm run dev -w apps/server` o `npm run dev -w apps/client`.

## Configuración (variables de entorno)

No hay valores hardcodeados: puerto y URL del servidor salen del entorno. Cada app tiene un
`.env.example` documentado y un `.env.development` con los valores locales.

### Servidor (`apps/server`)

| Variable                  | Default          | Qué hace                                                                               |
| ------------------------- | ---------------- | -------------------------------------------------------------------------------------- |
| `PORT`                    | `2567`           | Puerto HTTP + WebSocket.                                                               |
| `MAX_CLIENTS`             | `50`             | Máximo de jugadores simultáneos en la sala.                                            |
| `RECONNECT_GRACE_SECONDS` | `2`              | Segundos que se sostiene el asiento de un jugador cuya red se cortó antes de quitarlo. |
| `AWAY_AFTER_SECONDS`      | `300`            | Segundos sin moverse tras los cuales el avatar aparece como "ausente" para los demás.  |
| `PING_INTERVAL_MS`        | `2000`           | Cada cuánto se hace ping a cada socket.                                                |
| `PING_MAX_RETRIES`        | `2`              | Pings sin respuesta antes de dar la conexión por muerta.                               |
| `MAP_FILE`                | mapa del cliente | Ruta al mapa Tiled JSON del que se toman el punto de aparición y los límites.          |

`@colyseus/tools` carga automáticamente `.env.development` o `.env.production` según `NODE_ENV`.
En producción lo habitual es definir las variables en el proveedor de hosting.

### Cliente (`apps/client`)

| Variable          | Default (dev)                     | Qué hace                                                        |
| ----------------- | --------------------------------- | --------------------------------------------------------------- |
| `VITE_SERVER_URL` | `ws://localhost:2567`             | URL pública del servidor Colyseus. `wss://` en producción.      |
| `VITE_PORT`       | `5173`                            | Puerto del servidor de desarrollo de Vite.                      |
| `VITE_MAP_URL`    | `/assets/map/oficina-taller.json` | URL del mapa Tiled. Las imágenes se resuelven relativas a ella. |

Vite inyecta `VITE_SERVER_URL` **en tiempo de build**: para apuntar el sitio estático a otro
servidor hay que volver a construirlo. Si falta, el cliente falla al arrancar con un mensaje claro.

## El mapa y el movimiento

- **El mapa es datos.** `apps/client/public/assets/map/oficina-taller.json` es un mapa Tiled con
  capas de piso, paredes, muebles decorativos y muebles con colisión, más el punto de aparición y las
  zonas con nombre. Reemplazarlo por otro válido cambia la oficina sin tocar código. El contrato
  completo está en [`docs/mapa.md`](docs/mapa.md).
- **Colisiones desde el mapa.** Un tile bloquea si su tileset lo marca con `collides: true`; un
  mueble bloquea si él o su capa tienen `collides: true`. El código no conoce nombres de capas.
- **Spawn desde el mapa.** El servidor lee el mismo archivo al arrancar (`MAP_FILE`), toma el objeto
  de clase `spawn` y coloca a cada jugador al azar dentro de su radio. Si el mapa no es válido, el
  servidor no arranca y explica por qué.
- **Movimiento.** Flechas o WASD mueven el avatar propio con física Arcade contra paredes y
  muebles. La cámara sigue al jugador con zoom 2 y `pixelArt` para que el pixel art se vea nítido.
- **Debug.** `http://localhost:5173/?debug` dibuja los cuerpos de colisión y expone `window.__vto`.

## Avatares, movimiento y presencia

- **Identidad.** Al entrar se elige un nombre visible (hasta 20 caracteres) y uno de los 8 avatares
  del catálogo (`packages/shared/src/avatars.ts`). Viajan como opciones de `joinOrCreate`; el
  servidor los valida (nombre recortado, avatar del catálogo; si no, `Invitado-xxxx` y el avatar por
  defecto) y los guarda en el estado. El navegador recuerda la última elección. El nombre se puede
  cambiar después desde el panel.
- **Animación.** Cada avatar es una hoja de 52 frames (32×48): quieto y caminando en cuatro
  direcciones. El propio se anima según su velocidad; en diagonal manda el eje horizontal.
- **Sincronización.** El cliente manda `move` `{x, y, dir, moving}` **a lo sumo 20 veces por
  segundo y solo cuando algo cambió**; el servidor acota la posición al mapa, valida la dirección y
  replica el estado a todos. Los demás avatares no saltan: se deslizan hacia la última posición
  recibida con un suavizado exponencial independiente del framerate (τ = 80 ms) y solo "saltan" si
  la distancia es enorme o la pestaña estuvo oculta. Su animación sale de `dir`/`moving`.
- **El servidor es la fuente de verdad.** El panel "En la oficina" y los avatares en pantalla se
  crean en `onAdd` y se destruyen en `onRemove` del mapa `players`; el cliente nunca agrega ni
  retiene jugadores por su cuenta. Al entrar o salir alguien aparece un aviso discreto.
- **Ausente.** Tras `AWAY_AFTER_SECONDS` (300 por defecto) sin moverse, el servidor marca al
  jugador como ausente: los demás lo ven atenuado con la insignia "ausente" y así figura en el
  panel; al moverse vuelve a activo. El botón "Marcarme ausente" fija el estado a mano: en ese
  caso moverse **no** lo quita, solo el mismo botón.
- **Escribir no mueve.** Mientras un campo de texto tiene el foco, el teclado del juego se apaga y
  deja de capturar flechas y espacio, así el cursor del campo funciona y el avatar no se mueve.

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
dentro de la gracia conserva la sesión, que refrescar varias veces deja exactamente un jugador, que
el jugador aparece en el spawn del mapa, que el movimiento (posición, dirección, animación) se
replica acotado al mapa, que nombre y avatar elegidos llegan a todos (y los inválidos caen en el
fallback), que renombrar se replica, que la inactividad marca "ausente" y moverse lo quita, y que
el ausente manual solo se quita a mano. Además validan el **mapa real** (`test/map.test.ts`):
spawn único sobre piso transitable, cuatro zonas, tilesets embebidos con imágenes presentes y
colisiones declaradas en el mapa; y el **catálogo de avatares** y la normalización de nombres
(`test/identity.test.ts`).

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
Colyseus con estado sincronizado de jugadores, cliente que escucha altas/bajas y mapa Tiled con
colisiones por propiedad), pero está escrito de cero sobre las versiones actuales de Colyseus
(0.18, `@colyseus/sdk`, `@colyseus/schema` 5 sin decoradores), Phaser 3.90 y Vite 8. El plano de la
oficina parte del mapa de SkyOffice (MIT) retocado para Taller.

## Créditos

- Gráficos (tiles, muebles, personajes): [LimeZu](https://limezu.itch.io/) — packs _Modern
  Interiors_ y _Modern Office_. Cuatro de los ocho avatares son recoloreados de los personajes de
  LimeZu (edición permitida por la licencia). Uso permitido en proyectos comerciales y no comerciales con crédito; **no se
  pueden redistribuir**, por lo que este repositorio debe permanecer privado mientras los
  contenga. Detalle en [`docs/licencias-assets.md`](docs/licencias-assets.md).
- Mapa de origen y enfoque: [SkyOffice](https://github.com/kevinshen56714/SkyOffice), MIT
  © 2021 Kuan-Hsuan Shen.
