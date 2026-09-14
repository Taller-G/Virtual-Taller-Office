// Bundles the server into a single ESM file for Node 22.
// Our own code (@vto/shared included) goes into the bundle; the rest of the
// node_modules dependencies stay external and are installed on deployment.
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
