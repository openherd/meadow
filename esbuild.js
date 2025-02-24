import { build } from 'esbuild'

build({
  entryPoints: ['./src/index.js'],
  outfile: './src/index.out.js',
  sourcemap: 'inline',
  minify: false,
  bundle: true,
  define: {
    'process.env.NODE_DEBUG': 'false',
    global: 'globalThis'
  }
})
  .catch(() => process.exit(1))