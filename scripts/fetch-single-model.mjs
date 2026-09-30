import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const target = path.join(root, 'public', 'assets', 'facf-787-single.glb')
const source = process.env.AIRCRAFT_MODEL_URL || process.env.VITE_AIRCRAFT_MODEL_URL || ''

async function existsGood() {
  try {
    const stat = await fs.stat(target)
    return stat.size > 1_000_000
  } catch { return false }
}

if (await existsGood()) {
  console.log('[FACF] single integrated aircraft already cached')
  process.exit(0)
}

if (!source) throw new Error('FACF aircraft is missing. Set AIRCRAFT_MODEL_URL or VITE_AIRCRAFT_MODEL_URL for the build, or place the GLB at public/assets/facf-787-single.glb.')

await fs.mkdir(path.dirname(target), { recursive: true })
console.log('[FACF] downloading one integrated aircraft model...')
const response = await fetch(source)
if (!response.ok) throw new Error(`FACF aircraft download failed: ${response.status} ${response.statusText}`)
const bytes = Buffer.from(await response.arrayBuffer())
if (bytes.length < 1_000_000) throw new Error(`FACF aircraft download was unexpectedly small: ${bytes.length} bytes`)
await fs.writeFile(target, bytes)
console.log(`[FACF] cached single aircraft: ${(bytes.length / 1024 / 1024).toFixed(1)} MB`)
