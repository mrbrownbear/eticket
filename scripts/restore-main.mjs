import fs from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const packed = path.join(root, 'src', 'main.jsx.gz')
const target = path.join(root, 'src', 'main.jsx')

const compressed = await fs.readFile(packed)
const source = zlib.gunzipSync(compressed)
await fs.writeFile(target, source)
console.log(`[FACF] restored cinematic scene: ${source.length} bytes`)
