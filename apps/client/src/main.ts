import Phaser from 'phaser'
import { config } from './config'
import { OfficeConnection } from './network/connection'
import { BootScene } from './game/BootScene'
import { OfficeScene } from './game/OfficeScene'
import { mountHud } from './ui/hud'

const connection = new OfficeConnection(config.serverUrl)
mountHud(connection)

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1b1f2a',
  // Pixel art: sin suavizado al escalar y posiciones redondeadas.
  pixelArt: true,
  // El canvas ocupa todo el contenedor y se adapta al tamaño de la ventana.
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  physics: { default: 'arcade', arcade: { debug: config.debug } },
  // En modo debug el bucle usa setTimeout en vez de requestAnimationFrame: así
  // el juego sigue corriendo con la pestaña en segundo plano (pruebas automatizadas).
  fps: { forceSetTimeOut: config.debug },
  scene: [new BootScene(config.mapUrl), new OfficeScene(connection, { debug: config.debug })],
})

// Con `?debug`, juego y conexión quedan accesibles desde la consola del navegador.
if (config.debug) Object.assign(window, { __vto: { game, connection } })

// Cerrar o refrescar la pestaña: salida consentida para que el servidor nos
// quite al instante (sin fantasma ni duplicado al volver a entrar).
window.addEventListener('pagehide', () => connection.leaveForGood())

void connection.start()
