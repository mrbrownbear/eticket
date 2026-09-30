import fs from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const packedDir = path.join(root, 'src', '.packed')
const target = path.join(root, 'src', 'main.jsx')

const entries = (await fs.readdir(packedDir))
  .filter(name => /^main\.jsx\.gz\.b64\.part\d+$/.test(name))
  .sort((a, b) => Number(a.match(/\d+$/)[0]) - Number(b.match(/\d+$/)[0]))

if (!entries.length) {
  throw new Error('Packed cinematic scene source is missing.')
}

const encoded = (
  await Promise.all(entries.map(name => fs.readFile(path.join(packedDir, name), 'utf8')))
).join('').replace(/\s+/g, '')

const source = zlib.gunzipSync(Buffer.from(encoded, 'base64'))
await fs.writeFile(target, source)
console.log(`[FACF] restored cinematic scene: ${source.length} bytes from ${entries.length} packed parts`)
