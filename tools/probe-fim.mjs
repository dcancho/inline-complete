#!/usr/bin/env node
import { performance } from 'node:perf_hooks'

const endpoint = process.env.FIM_ENDPOINT
const key = process.env.FIM_KEY
const model = process.env.FIM_MODEL ?? 'codestral-2501'
const rounds = Number(process.env.FIM_ROUNDS ?? 12)
const maxTokens = Number(process.env.FIM_MAX_TOKENS ?? 64)
const sizes = (process.env.FIM_SIZES ?? '2000,6000,12000,24000').split(',').map(Number)

const usdIn = Number(process.env.FIM_USD_IN ?? 0.3)
const usdOut = Number(process.env.FIM_USD_OUT ?? 0.9)
const usdCached = Number(process.env.FIM_USD_CACHED ?? usdIn)

if (!endpoint || !key) {
  console.error('Required: FIM_ENDPOINT, FIM_KEY')
  console.error('Optional: FIM_MODEL, FIM_ROUNDS, FIM_MAX_TOKENS, FIM_SIZES')
  console.error('Pricing:  FIM_USD_IN, FIM_USD_OUT, FIM_USD_CACHED (per 1M tokens)')
  process.exit(1)
}

const tail = `namespace Shop.Api.Controllers;

[ApiController]
[Route("api/orders")]
public sealed class OrdersController : ControllerBase
{
    private readonly IOrderService _orders;
    private readonly ILogger<OrdersController> _logger;

    public OrdersController(IOrderService orders, ILogger<OrdersController> logger)
    {
        _orders = orders;
        _logger = logger;
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> GetById(Guid id, CancellationToken ct)
    {
        var order = await _orders.`

const suffix = `
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateOrderRequest request, CancellationToken ct)
    {
        var created = await _orders.CreateAsync(request, ct);
        return CreatedAtAction(nameof(GetById), new { id = created.Id }, created);
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

function buildPrefix(targetChars) {
  let padding = ''
  for (let i = 0; padding.length + tail.length < targetChars; i++) padding += filler(i)
  return padding.slice(0, Math.max(0, targetChars - tail.length)) + tail
}

async function call(prefix) {
  const started = performance.now()
  let res
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, prompt: prefix, suffix, max_tokens: maxTokens, temperature: 0.2 })
    })
  } catch (err) {
    return { ms: performance.now() - started, error: err.message }
  }
  const body = await res.text()
  const ms = performance.now() - started
  if (!res.ok) return { ms, error: `HTTP ${res.status}: ${body.slice(0, 300)}` }
  const parsed = JSON.parse(body)
  const first = parsed.choices?.[0]
  return { ms, text: first?.message?.content ?? first?.text ?? '', usage: parsed.usage }
}

const percentile = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]
}

function costOf(usage) {
  if (!usage) return null
  const total = usage.prompt_tokens ?? 0
  const cached = usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0
  const fresh = usage.prompt_cache_miss_tokens ?? Math.max(0, total - cached)
  const out = usage.completion_tokens ?? 0
  return {
    cached,
    fresh,
    out,
    usd: (cached * usdCached + fresh * usdIn + out * usdOut) / 1e6
  }
}

console.log(`host=${new URL(endpoint).host} model=${model} rounds=${rounds} max_tokens=${maxTokens}`)

const cold = await call(buildPrefix(sizes[0]))
if (cold.error) {
  console.error(`\nfirst call failed: ${cold.error}`)
  process.exit(1)
}
console.log(`cold start: ${cold.ms.toFixed(0)} ms (excluded from stats)\n`)

const rows = []
let sample = null

for (const size of sizes) {
  const prefix = buildPrefix(size)
  const times = []
  let firstCost = null
  let warmCost = null
  let failures = 0

  for (let i = 0; i < rounds; i++) {
    const r = await call(prefix)
    if (r.error) {
      failures++
      if (failures === 1) console.error(`  ${size}: ${r.error}`)
      continue
    }
    times.push(r.ms)
    const c = costOf(r.usage)
    if (!firstCost) firstCost = c
    else warmCost = c
    if (!sample && r.text) sample = r.text
  }

  const warm = warmCost ?? firstCost
  rows.push({
    'prefix chars': size,
    'tokens in': warm ? warm.cached + warm.fresh : '?',
    'cached': warm ? warm.cached : '?',
    'p50 ms': times.length ? percentile(times, 50).toFixed(0) : 'n/a',
    'p95 ms': times.length ? percentile(times, 95).toFixed(0) : 'n/a',
    'max ms': times.length ? Math.max(...times).toFixed(0) : 'n/a',
    'usd cold': firstCost ? firstCost.usd.toFixed(6) : '?',
    'usd warm': warm ? warm.usd.toFixed(6) : '?',
    failures
  })
}

console.table(rows)
if (sample) console.log(`sample completion:\n${sample}`)
