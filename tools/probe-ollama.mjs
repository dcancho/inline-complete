#!/usr/bin/env node
import { performance } from 'node:perf_hooks'

const host = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434'
const models = (process.env.OLLAMA_MODELS ?? 'qwen2.5-coder:1.5b-base,qwen2.5-coder:3b-base').split(',')
const rounds = Number(process.env.OLLAMA_ROUNDS ?? 8)
const numCtx = Number(process.env.OLLAMA_NUM_CTX ?? 8192)
const sizes = (process.env.OLLAMA_SIZES ?? '2000,6000,12000').split(',').map(Number)
const sweepSize = Number(process.env.OLLAMA_SWEEP_SIZE ?? 6000)

const tail = `[ApiController]
[Route("api/orders")]
public sealed class OrdersController : ControllerBase
{
    private readonly IOrderService _orders;

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetById(Guid id, CancellationToken ct)
    {
        var order = await _orders.`

const suffix = `
    }
}
`

const filler = (i) => `
// --- src/Services/Generated/Part${i}.cs ---
public interface IPart${i}Service
{
    Task<Part${i}> GetAsync(Guid id, CancellationToken ct);
    Task<IReadOnlyList<Part${i}>> ListAsync(int skip, int take, CancellationToken ct);
}

public sealed record Part${i}(Guid Id, string Name, decimal Amount, DateTimeOffset CreatedAt);
`

function buildPrefix(targetChars, bust) {
  const head = bust ? `// ${bust}\n` : ''
  let padding = ''
  for (let i = 0; head.length + padding.length + tail.length < targetChars; i++) padding += filler(i)
  return head + padding.slice(0, Math.max(0, targetChars - tail.length - head.length)) + tail
}

const ms = (ns) => (ns ?? 0) / 1e6
const FIM_STOPS = ['<|endoftext|>', '<|fim_pad|>', '<|file_sep|>', '<|fim_prefix|>']

async function generate(model, prefix, opts = {}) {
  const numPredict = opts.numPredict ?? 64
  const stops = opts.stops ?? FIM_STOPS
  const started = performance.now()
  let res
  try {
    res = await fetch(`${host}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: prefix,
        suffix,
        stream: false,
        keep_alive: -1,
        options: { num_ctx: numCtx, num_predict: numPredict, temperature: 0.2, stop: stops }
      })
    })
  } catch (err) {
    return { error: err.message }
  }
  const body = await res.text()
  const wall = performance.now() - started
  if (!res.ok) return { error: `HTTP ${res.status}: ${body.slice(0, 200)}` }
  const j = JSON.parse(body)
  return {
    wall,
    text: j.response ?? '',
    load: ms(j.load_duration),
    prefill: ms(j.prompt_eval_duration),
    decode: ms(j.eval_duration),
    promptTokens: j.prompt_eval_count ?? 0,
    outTokens: j.eval_count ?? 0
  }
}

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]
}

for (const model of models) {
  console.log(`=== ${model} ===`)

  const probe = await generate(model, buildPrefix(2000))
  if (probe.error) {
    console.log(`  unavailable: ${probe.error}\n`)
    continue
  }
  console.log(`  model load ${probe.load.toFixed(0)} ms, num_ctx=${numCtx}\n`)

  console.log('  context cost: cold prefill (cache miss) vs warm prefill (cache hit)')
  const ctxRows = []
  for (const size of sizes) {
    const cold = await generate(model, buildPrefix(size, `bust-${Date.now()}-${Math.random()}`))
    if (cold.error) continue

    const stable = buildPrefix(size)
    const warm = []
    for (let i = 0; i < rounds; i++) {
      const r = await generate(model, stable)
      if (!r.error) warm.push(r)
    }
    if (!warm.length) continue

    const prefills = warm.map((r) => r.prefill)
    const walls = warm.map((r) => r.wall)
    ctxRows.push({
      'prefix chars': size,
      'prompt tok': cold.promptTokens,
      'cold prefill': cold.prefill.toFixed(0),
      'warm prefill p50': pct(prefills, 50).toFixed(0),
      'warm prefill max': Math.max(...prefills).toFixed(0),
      'wall p95': pct(walls, 95).toFixed(0),
      'wall max': Math.max(...walls).toFixed(0)
    })
  }
  console.table(ctxRows)

  console.log(`  output budget sweep at ${sweepSize} prefix chars`)
  const sweepPrefix = buildPrefix(sweepSize)
  const variants = [
    { label: 'num_predict 8', numPredict: 8 },
    { label: 'num_predict 16', numPredict: 16 },
    { label: 'num_predict 32', numPredict: 32 },
    { label: 'num_predict 64', numPredict: 64 },
    { label: 'num_predict 64 + stop newline', numPredict: 64, stops: FIM_STOPS.concat(['\n']) }
  ]

  const sweepRows = []
  const samples = []
  for (const v of variants) {
    const runs = []
    for (let i = 0; i < rounds; i++) {
      const r = await generate(model, sweepPrefix, v)
      if (!r.error) runs.push(r)
    }
    if (!runs.length) continue
    const tps = runs.filter((r) => r.decode > 0).map((r) => (r.outTokens / r.decode) * 1000)
    sweepRows.push({
      variant: v.label,
      'wall p50': pct(runs.map((r) => r.wall), 50).toFixed(0),
      'wall p95': pct(runs.map((r) => r.wall), 95).toFixed(0),
      'decode p50': pct(runs.map((r) => r.decode), 50).toFixed(0),
      'out tok p50': pct(runs.map((r) => r.outTokens), 50),
      'tok/s': tps.length ? pct(tps, 50).toFixed(0) : 'n/a'
    })
    samples.push([v.label, runs[runs.length - 1].text])
  }
  console.table(sweepRows)

  for (const pair of samples) {
    console.log(`  ${pair[0]}:`)
    console.log(pair[1].split('\n').map((l) => `      ${l}`).join('\n'))
  }
  console.log()
}
