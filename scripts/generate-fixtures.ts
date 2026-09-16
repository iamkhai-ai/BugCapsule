import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeCapsule } from '@bugcapsule/format'
import { FIXTURES } from '@bugcapsule/fixtures'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(repoRoot, 'fixtures')

mkdirSync(outDir, { recursive: true })

let total = 0
for (const fixture of FIXTURES) {
  const bytes = writeCapsule(fixture.archive)
  writeFileSync(join(outDir, `${fixture.name}.bugcap`), bytes)
  total += bytes.byteLength
  console.log(`wrote  fixtures/${fixture.name}.bugcap  ${bytes.byteLength} byte`)
}

console.log(`\n${FIXTURES.length} fixture, tổng ${total} byte`)
