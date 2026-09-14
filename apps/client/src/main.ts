import Phaser from 'phaser'
import { DEFAULT_WORLD_ID, getWorld } from '@vto/shared'
import { config } from './config'
import { OfficeConnection } from './network/connection'
import { BootScene } from './game/BootScene'
import { OfficeScene } from './game/OfficeScene'
import { installTypingGuard } from './game/typingGuard'
import { showEntry } from './ui/entry'
import { mountHud } from './ui/hud'
import { mountPresence } from './ui/presence'
import { mountBubble } from './ui/bubble'
import { mountChat } from './ui/chat'

/** World the office is entered through (the First Office). */
const startWorld = getWorld(DEFAULT_WORLD_ID)!

const connection = new OfficeConnection(config.serverUrl)
mountHud(connection)
mountPresence(connection)
mountBubble(connection)
mountChat(connection)

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#1b1f2a',
  // Pixel art: no smoothing when scaling and rounded positions.
  pixelArt: true,
  // The canvas fills the whole container and adapts to the window size.
  scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
  physics: { default: 'arcade', arcade: { debug: config.debug } },
  // In debug mode the loop uses setTimeout instead of requestAnimationFrame:
  // that way the game keeps running with the tab in the background (automated
  // tests).
  fps: { forceSetTimeOut: config.debug },
  scene: [
    new BootScene(startWorld, config.avatarsUrl, config.logoUrl),
    new OfficeScene(connection, { debug: config.debug }),
  ],
})

// While typing in a text field, key presses do not reach the game.
game.events.once(Phaser.Core.Events.READY, () => installTypingGuard(game))

// With `?debug`, game and connection are reachable from the browser console.
if (config.debug) Object.assign(window, { __vto: { game, connection } })

// Closing or refreshing the tab: a consented leave so the server removes us
// instantly (no ghost and no duplicate when joining again).
window.addEventListener('pagehide', () => connection.leaveForGood())

// Name and avatar are chosen first; only then is the room joined.
void showEntry().then((identity) => connection.start(identity))
