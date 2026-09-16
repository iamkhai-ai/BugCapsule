import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateJsonSchemas } from '@bugcapsule/format'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(repoRoot, 'spec', '0.1')
const checkOnly = process.argv.includes('--check')

mkdirSync(outDir, { recursive: true })

const schemas = generateJsonSchemas()
let drifted = 0

for (const [fileName, schema] of Object.entries(schemas)) {
  const serialized = `${JSON.stringify(schema, null, 2)}\n`
  const target = join(outDir, fileName)

  if (!checkOnly) {
    writeFileSync(target, serialized, 'utf8')
    console.log(`wrote  spec/0.1/${fileName}`)
    continue
  }

  let committed = ''
  try {
    committed = readFileSync(target, 'utf8')
  } catch {
    committed = ''
  }

  if (committed !== serialized) {
    drifted += 1
    console.error(`drift  spec/0.1/${fileName}`)
  } else {
    console.log(`ok     spec/0.1/${fileName}`)
  }
}

if (checkOnly) {
  if (drifted > 0) {
    console.error(`\n${drifted} file lệch. Chạy: pnpm gen:schemas`)
    process.exit(1)
  }
  console.log('\nJSON Schema khớp với nguồn zod.')
}
