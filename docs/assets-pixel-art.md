# Assets pixel art: logo y avatares del equipo

Qué es cada asset pixel art que se agregó para la Oficina Taller, sus dimensiones y
cómo está organizado. Para licencias y atribución ver [`licencias-assets.md`](licencias-assets.md).

Las imágenes originales (logo y fotos de las personas) viven en el repo `Taller-G/images`
(`logo.png`, `person1.png`, `person2.png`, `person3.png`) y **no se modifican**: los assets
pixel art se suman aparte, acá en `virtual-taller-office`.

## Logo

- **Archivo:** `apps/client/public/assets/logo/taller-logo-pixel.png`
- **Dimensiones:** 160×32 px (5×1 tiles de 32 px), fondo transparente.
- **Origen:** derivado de `images/logo.png` (flecha naranja + texto "TALLER").
- **Cómo se hizo:** escalado del original a la grilla, paleta reducida a los colores de
  marca (blanco, naranja, naranja oscuro) y un contorno oscuro de 1 px para que se lea
  sobre pisos claros u oscuros del mapa.
- **Uso:** se dibuja como decoración de la recepción, anclado a la zona `Recepción` del
  mapa, en `apps/client/src/game/officeMap.ts` (`addReceptionLogo`). Es un sprite **sin
  cuerpo físico**, así que no bloquea el paso ni interfiere con las interacciones; va como
  calcomanía de piso (profundidad debajo de muebles y avatares, por eso los personajes le
  pasan por encima). Se carga en `BootScene`; si el archivo faltara, la oficina igual abre
  sin logo. Para reubicarlo, ver las constantes `LOGO_ZONE_*` en `officeMap.ts`.

## Avatares de las personas

Tres personajes jugables, uno por persona del equipo. Conservan los rasgos identificables
de cada persona (largo y color de pelo, color de ropa) para que se reconozca quién es quién.

| id         | Persona (rasgos)                         | Sprite base |
| ---------- | ---------------------------------------- | ----------- |
| `persona1` | Pelo largo claro/rubio, blusa crema      | `lucy`      |
| `persona2` | Pelo largo negro, campera de cuero negra | `nancy`     |
| `persona3` | Pelo castaño, top claro                  | `ash`       |

- **Archivos:** `apps/client/public/assets/avatars/persona1.png`, `persona2.png`, `persona3.png`
- **Cómo se hicieron:** con `tools/person-avatars.py` (Python + Pillow, solo desarrollo).
  Parte de los sprites base de LimeZu y recolorea de forma independiente el pelo y la ropa
  para acercarse a cada persona, conservando piel, contornos y el sombreado. Es la misma
  convención que `tools/recolor-avatars.py`. Para regenerarlos: `python3 tools/person-avatars.py`.
- **Selección:** aparecen en el selector de entrada junto a los avatares genéricos (el catálogo
  está en `packages/shared/src/avatars.ts`); la elección se guarda en `localStorage` y se
  mantiene al recargar.
- **Fallback:** si una hoja no cargara, `BootScene` no aborta y `Avatar`/`avatarAnims` resuelven
  ese avatar al por defecto, de modo que la oficina abre igual y nunca queda en pantalla en blanco.

### Organización del sprite sheet (igual que el resto de avatares)

Todos los avatares comparten exactamente el mismo formato, definido en
`packages/shared/src/avatars.ts` (`AVATAR_FRAME`, `ANIM_START`):

- **Hoja:** 1664×48 px, una sola fila.
- **Frame:** 32×48 px, **52 frames** por hoja (índices 0–51, de izquierda a derecha).
- **Frames por animación:** 6.
- **Layout (índice del primer frame de cada animación):**

  | Animación      | right | up    | left  | down  |
  | -------------- | ----- | ----- | ----- | ----- |
  | idle (quieto)  | 0–5   | 6–11  | 12–17 | 18–23 |
  | walk (caminar) | 24–29 | 30–35 | 36–41 | 42–47 |

  Los frames 48–51 son la pose sentada (aún no se usa).

Como las tres hojas comparten dimensiones, paleta general y cantidad de frames, se ven
coherentes entre sí y con los avatares que ya existían, y el engine las carga sin ningún
reprocesamiento (`apps/client/src/game/BootScene.ts` recorre `AVATAR_IDS`).
