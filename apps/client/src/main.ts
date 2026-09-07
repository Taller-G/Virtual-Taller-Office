import Phaser from 'phaser'
import { config } from './config'
import { OfficeConnection } from './network/connection'
import { OfficeScene, SCENE_SIZE } from './game/OfficeScene'
import { mountHud } from './ui/hud'

const connection = new OfficeConnection(config.serverUrl)
mountHud(connection)

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: SCENE_SIZE.width,
  height: SCENE_SIZE.height,
  backgroundColor: '#1b1f2a',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [new OfficeScene(connection)],
})

// Cerrar o refrescar la pestaña: salida consentida para que el servidor nos
// quite al instante (sin fantasma ni duplicado al volver a entrar).
window.addEventListener('pagehide', () => connection.leaveForGood())

void connection.start()
