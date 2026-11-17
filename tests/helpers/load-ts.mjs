// Loads a TypeScript module from src/ for node --test by bundling it with esbuild (shipped with vite).
import { build } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'people-fe-test-'))
process.on('exit', () => {
  try {
    fs.rmSync(outRoot, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
})

export async function loadTs(relativeToSrc) {
  const entry = path.join(frontendDir, 'src', relativeToSrc)
  const outfile = path.join(outRoot, relativeToSrc.replace(/[\\/]/g, '_').replace(/\.tsx?$/, '.mjs'))
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    alias: { '@': path.join(frontendDir, 'src') },
    // Bundled CommonJS dependencies (axios) call require() for node builtins; give the ESM output a require.
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  })
  return import(pathToFileURL(outfile).href)
}

export function readSrc(relative) {
  return fs.readFileSync(path.join(frontendDir, 'src', relative), 'utf8')
}

export function listSrc(dir, ext = ['.tsx', '.ts']) {
  const root = path.join(frontendDir, 'src', dir)
  const out = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (ext.some((x) => e.name.endsWith(x))) out.push(p)
    }
  }
  walk(root)
  return out
}
