#!/usr/bin/env node
import * as fs from 'node:fs'
import * as path from 'node:path'

const target = process.argv[2]
if (!target) {
  console.error('usage: node tools/report.mjs <log file or directory>')
  console.error('the extension prints its log path on activation')
  process.exit(1)
}

function logFiles(input) {
  const stat = fs.statSync(input)
  if (stat.isFile()) {
    return [input]
  }
  return fs
    .readdirSync(input)
    .filter((name) => name.endsWith('.jsonl'))
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
const accepted = new Set(events.filter((e) => e.event === 'accepted').map((e) => e.id))
const errors = events.filter((e) => e.event === 'error')

const pct = (values, p) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]
}

const shown = completions.filter((e) => e.suggestionChars > 0)
const empty = completions.length - shown.length

console.log(`events        ${events.length}`)
console.log(`requests      ${completions.length}`)
console.log(`cache hits    ${cacheHits.length}`)
console.log(`empty results ${empty} (${((empty / Math.max(1, completions.length)) * 100).toFixed(0)}%)`)
console.log(`errors        ${errors.length}`)

const shownTotal = shown.length + cacheHits.length
const acceptedShown = [...shown, ...cacheHits].filter((e) => accepted.has(e.id)).length
console.log(
  `accept rate   ${acceptedShown}/${shownTotal} ` +
    `(${((acceptedShown / Math.max(1, shownTotal)) * 100).toFixed(1)}%)`
)

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

const warm = completions.filter((e) => e.prefillMs <= 50)
console.log(
  `kv cache hit rate (prefill under 50ms): ` +
    `${warm.length}/${completions.length} ` +
    `(${((warm.length / Math.max(1, completions.length)) * 100).toFixed(0)}%)`
)

const byLanguage = {}
for (const event of completions) {
  const row = (byLanguage[event.lang] ??= { requests: 0, empty: 0, shown: 0, acceptedCount: 0, wall: [] })
  row.requests++
  row.wall.push(event.wallMs)
  if (event.suggestionChars > 0) {
    row.shown++
    if (accepted.has(event.id)) row.acceptedCount++
  } else {
    row.empty++
  }
}

console.log('\nby language')
console.table(
  Object.fromEntries(
    Object.entries(byLanguage).map(([lang, row]) => [
      lang,
      {
        requests: row.requests,
        empty: row.empty,
        'accept %': row.shown > 0 ? ((row.acceptedCount / row.shown) * 100).toFixed(0) : '0',
        'wall p50': pct(row.wall, 50),
        'wall p95': pct(row.wall, 95)
      }
    ])
  )
)

const withBlock = completions.filter((e) => e.blockChars > 0)
const withoutBlock = completions.filter((e) => !e.blockChars)

const summarize = (rows) => ({
  requests: rows.length,
  'accept %':
    rows.filter((e) => e.suggestionChars > 0).length > 0
      ? (
          (rows.filter((e) => e.suggestionChars > 0 && accepted.has(e.id)).length /
            rows.filter((e) => e.suggestionChars > 0).length) *
          100
        ).toFixed(0)
      : '0',
  'empty %': ((rows.filter((e) => !e.suggestionChars).length / Math.max(1, rows.length)) * 100).toFixed(0),
  'wall p50': pct(rows.map((e) => e.wallMs), 50),
  'wall p95': pct(rows.map((e) => e.wallMs), 95)
})

console.log('\nsymbol context')
console.table({ 'with block': summarize(withBlock), 'without block': summarize(withoutBlock) })
