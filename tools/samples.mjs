#!/usr/bin/env node
import * as fs from 'node:fs'
import * as path from 'node:path'

const [dir, filter = 'rejected', countArg = '10'] = process.argv.slice(2)
if (!dir || !['rejected', 'accepted', 'all'].includes(filter)) {
  console.error('usage: node tools/samples.mjs <log directory> [rejected|accepted|all] [count]')
  console.error('needs inlineComplete.telemetry.captureContent enabled')
  process.exit(1)
}

const BEFORE_LINES = 12
const AFTER_LINES = 4

function read(prefix) {
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.jsonl'))
    .sort()
    .flatMap((name) => fs.readFileSync(path.join(dir, name), 'utf8').split('\n'))
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return undefined
      }
    })
    .filter(Boolean)
}

const events = read('completions-')
const origins = new Map(events.filter((e) => e.event === 'cache_hit').map((e) => [e.id, e.origin]))
const accepted = new Set(
  events.filter((e) => e.event === 'accepted').map((e) => origins.get(e.id) ?? e.id)
)

const samples = read('samples-').filter((s) => s.suggestion)
if (samples.length === 0) {
  console.log('no samples yet: enable inlineComplete.telemetry.captureContent and use the editor')
  process.exit(0)
}

const selected = samples
  .filter((s) => filter === 'all' || (filter === 'accepted') === accepted.has(s.id))
  .slice(-Number(countArg))

const lastLines = (text, n) => text.split('\n').slice(-n).join('\n')
const firstLines = (text, n) => text.split('\n').slice(0, n).join('\n')

for (const s of selected) {
  const status = accepted.has(s.id) ? 'ACCEPTED' : 'REJECTED'
  console.log(`\n=== ${s.id}  ${s.lang}  ${s.file}:${s.line + 1}  ${status}  (${s.doneReason}) ===`)
  console.log(s.block ? `--- symbols ---\n${s.block.trimEnd()}` : '--- symbols: none ---')
  console.log(`--- before cursor ---\n${lastLines(s.prefixTail, BEFORE_LINES)}<<<`)
  console.log(`${s.suggestion}`)
  console.log(`>>>${firstLines(s.suffixHead, AFTER_LINES)}`)
}

console.log(
  `\n${selected.length} shown, ${samples.length} samples total, ` +
    `${samples.filter((s) => accepted.has(s.id)).length} accepted`
)
