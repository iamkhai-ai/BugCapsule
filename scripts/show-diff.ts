import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { diffCapsules } from '@bugcapsule/diff'
import { readCapsule, type CapsuleArchive } from '@bugcapsule/format'

function load(name: string): CapsuleArchive {
  const result = readCapsule(readFileSync(join(process.cwd(), 'fixtures', `${name}.bugcap`)))
  for (const warning of result.warnings) console.warn(`  warning: ${warning}`)
  if (!result.ok || result.value === undefined) {
    console.error(`Không đọc được ${name}.bugcap:`)
    for (const issue of result.issues) console.error(`  ${issue.code} tại ${issue.path}: ${issue.message}`)
    process.exit(1)
  }
  return result.value
}

const baseline = load('checkout-working')
const candidate = load('checkout-broken')
const diff = diffCapsules(baseline, candidate)

const rule = '-'.repeat(72)
console.log(rule)
console.log('BugCapsule diff')
console.log(`  baseline  ${baseline.manifest.id}  (${baseline.manifest.role ?? 'unknown'})`)
console.log(`  candidate ${candidate.manifest.id}  (${candidate.manifest.role ?? 'unknown'})`)
console.log(`  first anomaly at ${diff.firstAnomalyMs ?? 'n/a'}ms`)
console.log(rule)

console.log(`\nVisible signals (${diff.signals.length})`)
diff.signals.forEach((signal, index) => {
  const proximity = signal.proximityMs === undefined ? 'n/a' : `${signal.proximityMs >= 0 ? '+' : ''}${signal.proximityMs}ms`
  console.log(`\n  ${index + 1}. [w${signal.weight}] ${signal.target.padEnd(11)} ${signal.label}`)
  console.log(`     ${signal.summary}`)
  if (signal.before !== undefined || signal.after !== undefined) {
    const render = (value: unknown): string => (value === undefined ? '(absent)' : JSON.stringify(value))
    console.log(`     ${render(signal.before)} -> ${render(signal.after)}`)
  }
  console.log(`     confidence=${signal.confidence}  proximity=${proximity}  id=${signal.id}`)
  console.log(`     why: ${signal.reason}`)
})

console.log(`\nHidden by default (${diff.hidden.length})`)
for (const signal of diff.hidden) {
  console.log(`  - ${signal.summary}  [${JSON.stringify(signal.before)} -> ${JSON.stringify(signal.after)}]`)
}

console.log(`\nDropped as noise (${diff.dropped.length} kinds)`)
for (const entry of diff.dropped) console.log(`  - ${entry.kind}: ${entry.count}`)

console.log(`\nSuppressed (${diff.suppressedCount})`)
for (const entry of diff.suppressed) console.log(`  - ${entry.id}`)

console.log(`\n${rule}`)
