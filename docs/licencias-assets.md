# Licencias de los assets gráficos

Inventario de todo lo que hay en `apps/client/public/assets/`, de dónde salió y bajo qué
condiciones se puede usar. Si agregás un asset nuevo, sumalo acá en el mismo commit.

## Resumen

| Archivo                                               | Contenido                                                                                                                                                                                 | Autor                    | Licencia                                    | Vía       |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------- | --------- |
| `tilesets/FloorAndGround.png`                         | Pisos y paredes (Room Builder)                                                                                                                                                            | LimeZu                   | LimeZu Modern Interiors                     | SkyOffice |
| `tilesets/Modern_Office_Black_Shadow.png`             | Muebles de oficina (escritorios, sillas, plantas…)                                                                                                                                        | LimeZu                   | LimeZu Modern Office                        | SkyOffice |
| `tilesets/Generic.png`                                | Muebles genéricos (mesas, heladera, cocina, sofás…)                                                                                                                                       | LimeZu                   | LimeZu Modern Interiors                     | SkyOffice |
| `tilesets/Basement.png`                               | Objetos varios (cajas, máquinas, estanterías)                                                                                                                                             | LimeZu                   | LimeZu Modern Interiors                     | SkyOffice |
| `tilesets/chair.png`                                  | Sillas en 4 direcciones (hoja 32×64)                                                                                                                                                      | LimeZu                   | LimeZu Modern Office                        | SkyOffice |
| `tilesets/computer.png`                               | Escritorio con computadora (hoja 96×64)                                                                                                                                                   | LimeZu                   | LimeZu Modern Office                        | SkyOffice |
| `tilesets/whiteboard.png`                             | Pizarra (hoja 64×64)                                                                                                                                                                      | LimeZu                   | LimeZu Modern Office                        | SkyOffice |
| `tilesets/vendingmachine.png`                         | Máquina expendedora (48×72)                                                                                                                                                               | LimeZu                   | LimeZu Modern Interiors                     | SkyOffice |
| `avatars/adam.png` `ash.png` `lucy.png` `nancy.png`   | Personajes (hojas 32×48, 52 frames: quieto/caminar en 4 direcciones)                                                                                                                      | LimeZu                   | LimeZu Modern Interiors                     | SkyOffice |
| `avatars/bruno.png` `dana.png` `iris.png` `tomas.png` | Variantes recoloreadas de los cuatro anteriores (ropa y pelo; piel y contornos intactos), generadas con `tools/recolor-avatars.py`                                                        | LimeZu (edición: Taller) | LimeZu Modern Interiors (edición permitida) | —         |
| `avatars/persona1.png` `persona2.png` `persona3.png`  | Avatares del equipo de Taller (hojas 32×48, 52 frames), derivados de `lucy`/`nancy`/`ash` recoloreando pelo y ropa para parecerse a cada persona; generados con `tools/person-avatars.py` | LimeZu (edición: Taller) | LimeZu Modern Interiors (edición permitida) | —         |
| `avatars/layers/{base}/body-*.png`                    | Capa body (piel, contornos, pantalón, zapatos) extraída de cada personaje base y con variantes de tono de piel; generada con `tools/split-layers.py`                                      | LimeZu (edición: Taller) | LimeZu Modern Interiors (edición permitida) | —         |
| `avatars/layers/{base}/hair.png`                      | Capa hair (pelo, escala de grises para teñir con `setTint()`); generada con `tools/split-layers.py`                                                                                       | LimeZu (edición: Taller) | LimeZu Modern Interiors (edición permitida) | —         |
| `avatars/layers/{base}/top.png`                       | Capa top (ropa torso, escala de grises para teñir con `setTint()`); generada con `tools/split-layers.py`                                                                                  | LimeZu (edición: Taller) | LimeZu Modern Interiors (edición permitida) | —         |
| `avatars/layers/accessories/cap.png` `beanie.png`     | Accesorios de sombrero (hojas 32×48, 52 frames, overlay transparente); pixel art original generado con `tools/gen-accessories.py`                                                         | Taller                   | Propio                                      | —         |
| `avatars/layers/accessories/glasses-*.png`            | Accesorios de anteojos (hojas 32×48, 52 frames, overlay transparente); pixel art original generado con `tools/gen-accessories.py`                                                         | Taller                   | Propio                                      | —         |
| `logo/taller-logo-pixel.png`                          | Logo de Taller en pixel art (160×32, fondo transparente), derivado de `images/logo.png`                                                                                                   | Taller                   | Propio (marca Taller)                       | —         |
| `map/oficina-taller.json`                             | Plano de la oficina (mapa Tiled)                                                                                                                                                          | Taller                   | Propio; deriva del mapa de SkyOffice (MIT)  | —         |

## LimeZu — Modern Interiors / Modern Office

- Autor: LimeZu — <https://limezu.itch.io/>
- Packs: [Modern Interiors](https://limezu.itch.io/moderninteriors) y
  [Modern Office - Revamped](https://limezu.itch.io/modernoffice).
- Condiciones publicadas por el autor en itch.io (consultadas el 2026-09-07):
  - **Se puede** editar y usar los assets en cualquier proyecto, comercial o no comercial.
  - **Se debe** dar crédito a LimeZu con enlace a <https://limezu.itch.io/>.
  - **No se puede** revender ni redistribuir los assets a terceros, ni editados ni sin editar.

Qué implica para este proyecto:

- El uso en la oficina virtual interna de Taller está permitido, incluidas las variantes recoloreadas
  de los personajes (la licencia permite editar los assets).
- El crédito figura en el `README.md` del repo (sección "Créditos") y debe mantenerse.
- La prohibición de redistribuir significa que **estos PNG no deberían vivir en un repositorio
  público**. El repo `Taller-G/Virtual-Taller-Office` debe ser privado mientras contenga estos
  archivos; si en algún momento se vuelve público, hay que sacarlos del historial y servirlos desde
  un almacenamiento privado, o reemplazarlos por un tileset con licencia libre (por ejemplo CC0).

## SkyOffice (código y mapa de origen)

- Repo: <https://github.com/kevinshen56714/SkyOffice> — licencia MIT, © 2021 Kuan-Hsuan Shen.
- De SkyOffice se tomaron: el enfoque de mapa Tiled con colisiones por propiedad y el plano original
  (`client/public/assets/map/map.json`), que se retocó para representar la oficina de Taller.
- La licencia MIT cubre el código y el archivo de mapa, **no** los PNG de LimeZu que SkyOffice
  redistribuye: esos siguen bajo las condiciones de LimeZu descritas arriba.

## Cómo agregar un asset nuevo

1. Verificá la licencia antes de copiar el archivo. Para uso interno sirven CC0, CC-BY (con
   crédito), MIT/OFL, o licencias de packs comerciales que permitan uso en proyectos (como la de
   LimeZu). Evitá "personal use only" y cualquier cosa sin licencia explícita.
2. Copialo a `apps/client/public/assets/tilesets/` y agregá la fila en la tabla de arriba.
3. Si la licencia exige crédito, sumalo a la sección "Créditos" del `README.md`.
4. Agregalo como tileset en Tiled (ver `docs/mapa.md`); el cliente lo carga solo.
