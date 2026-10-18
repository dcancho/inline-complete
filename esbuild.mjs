import * as esbuild from 'esbuild'

const watch = process.argv.includes('--watch')
const smoke = process.argv.includes('--smoke')

const shared = {
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  logLevel: 'info'
}

const extension = {
  ...shared,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  external: ['vscode'],
  sourcemap: true
}

if (smoke) {
  await esbuild.build({
    ...shared,
    entryPoints: ['tools/smoke.ts'],
    outfile: 'dist/smoke.cjs',
    logLevel: 'error'
  })
} else if (watch) {
  const ctx = await esbuild.context(extension)
  await ctx.watch()
} else {
  await esbuild.build(extension)
}
