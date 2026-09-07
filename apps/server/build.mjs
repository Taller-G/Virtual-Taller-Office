// Empaqueta el servidor en un único archivo ESM para Node 22.
// El código propio (incluido @vto/shared) se incluye en el bundle; el resto de
// dependencias de node_modules queda externo y se instala en el despliegue.
import { build } from 'esbuild'
import { rm } from 'node:fs/promises'

await rm('build', { recursive: true, force: true })

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'build/index.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  logLevel: 'info',
  plugins: [
    {
      name: 'externalize-node-modules',
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^[^./]/ }, (args) => {
          if (args.path.startsWith('@vto/')) return undefined
          return { path: args.path, external: true }
        })
      },
    },
  ],
})
