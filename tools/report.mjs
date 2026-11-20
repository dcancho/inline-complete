#!/usr/bin/env node
import * as fs from 'node:fs'
import * as path from 'node:path'

const SMALL_SAMPLE = 50

const target = process.argv[2]
if (!target) {
  console.error('usage: node tools/report.mjs <log file or directory>')
  console.error('the extension prints its log path on activation')
  process.exit(1)
}

function logFiles(input) {
  if (fs.statSync(input).isFile()) {
    return [input]
  }
  return fs
    .readdirSync(input)
    .filter((name) => name.startsWith('completions-') && name.endsWith('.jsonl'))
    .map((name) => path.join(input, name))
}

const events = []
for (const file of logFiles(target)) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.trim().length === 0) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      continue
    }
  }
}

if (events.length === 0) {
  console.log('no events recorded yet')
  process.exit(0)
}

const completions = events.filter((e) => e.event === 'completion')
const cacheHits = events.filter((e) => e.event === 'cache_hit')
const errors = events.filter((e) => e.event === 'error')

const sources = new Map([...completions, ...cacheHits].map((e) => [e.id, e]))
const offered = completions.filter((e) => e.suggestionChars > 0)
const offeredIds = new Set(offered.map((e) => e.id))

const acceptedOrigins = new Set()
for (const acceptance of events.filter((e) => e.event === 'accepted')) {
  const source = sources.get(acceptance.id)
  if (!source) continue
  const origin = source.event === 'cache_hit' ? source.origin : source.id
  if (origin && offeredIds.has(origin)) acceptedOrigins.add(origin)
}

const pct = (values, p) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}
const ratio = (part, whole) => `${part}/${whole} (${((part / Math.max(1, whole)) * 100).toFixed(0)}%)`

console.log(`requests          ${completions.length}`)
console.log(`suggestions       ${offered.length}`)
console.log(`typed-through     ${cacheHits.length} re-offers of existing suggestions`)
console.log(`empty results     ${ratio(completions.length - offered.length, completions.length)}`)
console.log(`errors            ${errors.length}`)
console.log(`accept rate       ${ratio(acceptedOrigins.size, offered.length)}`)
if (offered.length < SMALL_SAMPLE) {
  console.log(`\nsmall sample: below ${SMALL_SAMPLE} suggestions, treat percentages as noise`)
}

console.log('\nlatency (ms)')
console.table({
  wall: { p50: pct(completions.map((e) => e.wallMs), 50), p95: pct(completions.map((e) => e.wallMs), 95) },
  prefill: {
    p50: pct(completions.map((e) => e.prefillMs), 50),
    p95: pct(completions.map((e) => e.prefillMs), 95)
  },
  decode: {
    p50: pct(completions.map((e) => e.decodeMs), 50),
    p95: pct(completions.map((e) => e.decodeMs), 95)
  }
})

console.log(`kv cache warm (prefill under 50ms)  ${ratio(completions.filter((e) => e.prefillMs <= 50).length, completions.length)}`)

const withCode = completions.filter((e) => e.blockChars !== undefined)
const codeChars = withCode.map((e) => e.prefixChars - e.blockChars)
console.log(
  `code before cursor  p50 ${pct(codeChars, 50)} chars, ` +
    `under 250 chars in ${ratio(codeChars.filter((n) => n < 250).length, withCode.length)}`
)

const schemes = {}
for (const event of completions.filter((e) => e.scheme)) {
  schemes[event.scheme] = (schemes[event.scheme] ?? 0) + 1
}
if (Object.keys(schemes).length > 0) {
  console.log(`document schemes    ${Object.entries(schemes).map(([s, n]) => `${s} ${n}`).join(', ')}`)
}

const reasons = {}
for (const event of completions) {
  const reason = event.doneReason ?? 'unrecorded'
  reasons[reason] = (reasons[reason] ?? 0) + 1
}
console.log('\nhow generation ended')
for (const [reason, count] of Object.entries(reasons)) {
  console.log(`  ${reason.padEnd(12)} ${ratio(count, completions.length)}`)
}

function summarize(rows) {
  const shown = rows.filter((e) => e.suggestionChars > 0)
  return {
    requests: rows.length,
    suggestions: shown.length,
    'accept %': shown.length
      ? ((shown.filter((e) => acceptedOrigins.has(e.id)).length / shown.length) * 100).toFixed(0)
      : '-',
    'empty %': ((1 - shown.length / Math.max(1, rows.length)) * 100).toFixed(0),
    'wall p50': pct(rows.map((e) => e.wallMs), 50),
    'wall p95': pct(rows.map((e) => e.wallMs), 95)
  }
}

const languages = [...new Set(completions.map((e) => e.lang))]
console.log('\nby language')
console.table(Object.fromEntries(languages.map((lang) => [lang, summarize(completions.filter((e) => e.lang === lang))])))

console.log('\nsymbol context')
console.table({
  'with block': summarize(completions.filter((e) => e.blockChars > 0)),
  'without block': summarize(completions.filter((e) => !e.blockChars))
})
