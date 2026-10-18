#!/usr/bin/env node
import { performance } from 'node:perf_hooks'

const base = (process.env.AZ_BASE ?? '').replace(/\/+$/, '')
const key = process.env.AZ_KEY
const model = process.env.AZ_MODEL

if (!base || !key || !model) {
  console.error('Required:')
  console.error('  AZ_BASE   https://<resource>.services.ai.azure.com/openai/v1')
  console.error('  AZ_KEY    resource key')
  console.error('  AZ_MODEL  deployment name')
  process.exit(1)
}

const prefix = `[ApiController]
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

const variants = [
  {
    name: 'completions + prompt/suffix',
    path: '/completions',
    body: { model, prompt: prefix, suffix, max_tokens: 64, temperature: 0.2 }
  },
  {
    name: 'completions + fim tokens (plain)',
    path: '/completions',
    body: {
      model,
      prompt: `<fim_begin>${prefix}<fim_hole>${suffix}<fim_end>`,
      max_tokens: 64,
      temperature: 0.2
    }
  },
  {
    name: 'completions + fim tokens (fullwidth)',
    path: '/completions',
    body: {
      model,
      prompt: `<｜fim▁begin｜>${prefix}<｜fim▁hole｜>${suffix}<｜fim▁end｜>`,
      max_tokens: 64,
      temperature: 0.2
    }
  },
  {
    name: 'chat + fim tokens',
    path: '/chat/completions',
    body: {
      model,
      messages: [{ role: 'user', content: `<fim_begin>${prefix}<fim_hole>${suffix}<fim_end>` }],
      max_tokens: 64,
      temperature: 0.2
    }
  },
  {
    name: 'chat + instructed pseudo-fim',
    path: '/chat/completions',
    body: {
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are a code completion engine. Output only the code that belongs at <CURSOR>. ' +
            'No explanation, no markdown fences, no repetition of the surrounding code.'
        },
        { role: 'user', content: `${prefix}<CURSOR>${suffix}` }
      ],
      max_tokens: 64,
      temperature: 0.2
    }
  }
]

async function attempt(v) {
  const started = performance.now()
  let res
  try {
    res = await fetch(`${base}${v.path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
        'api-key': key
      },
      body: JSON.stringify(v.body)
    })
  } catch (err) {
    return { ms: performance.now() - started, status: 'network', detail: err.message }
  }
  const raw = await res.text()
  const ms = performance.now() - started
  if (!res.ok) return { ms, status: res.status, detail: raw.slice(0, 400) }

  let text = ''
  let usage = null
  try {
    const json = JSON.parse(raw)
    const first = json.choices?.[0]
    text = first?.text ?? first?.message?.content ?? ''
    usage = json.usage
  } catch {
    return { ms, status: 'unparsable', detail: raw.slice(0, 200) }
  }
  return { ms, status: res.status, text, usage }
}

console.log(`base=${base}\nmodel=${model}\n`)

for (const v of variants) {
  const r = await attempt(v)
  console.log(`${v.name}`)
  console.log(`  status ${r.status}  ${r.ms.toFixed(0)} ms`)
  if (r.usage) {
    const reasoning = r.usage.completion_tokens_details?.reasoning_tokens
    console.log(
      `  tokens in=${r.usage.prompt_tokens} out=${r.usage.completion_tokens}` +
        (reasoning ? `  reasoning=${reasoning}` : '')
    )
  }
  if (r.detail) console.log(`  ${r.detail.replace(/\n/g, ' ').slice(0, 300)}`)
  if (r.text !== undefined && r.text !== '') {
    console.log('  output:')
    console.log(
      r.text
        .split('\n')
        .map((l) => `    ${l}`)
        .join('\n')
    )
  }
  console.log()
}
