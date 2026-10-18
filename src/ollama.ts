import { Config } from './config'

export const FIM_STOPS = ['<|endoftext|>', '<|fim_pad|>', '<|file_sep|>', '<|fim_prefix|>']

export interface FimRequest {
  prefix: string
  suffix: string
  stops?: string[]
}

export interface FimResult {
  text: string
  doneReason: string
  promptTokens: number
  outputTokens: number
  prefillMs: number
  decodeMs: number
}

interface GenerateResponse {
  response?: string
  done_reason?: string
  prompt_eval_count?: number
  prompt_eval_duration?: number
  eval_count?: number
  eval_duration?: number
}

export class OllamaError extends Error {}

const toMs = (nanoseconds: number | undefined): number => Math.round((nanoseconds ?? 0) / 1e6)

export async function fetchCompletion(
  config: Config,
  request: FimRequest,
  signal: AbortSignal
): Promise<FimResult> {
  const stop = [
    ...FIM_STOPS,
    ...(config.singleLine ? ['\n'] : []),
    ...(request.stops ?? [])
  ]

  const response = await fetch(`${config.endpoint}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal,
    body: JSON.stringify({
      model: config.model,
      prompt: request.prefix,
      suffix: request.suffix,
      stream: false,
      keep_alive: -1,
      options: {
        num_ctx: config.numCtx,
        num_predict: config.numPredict,
        temperature: config.temperature,
        stop
      }
    })
  })

  if (!response.ok) {
    throw new OllamaError(`${response.status} ${await response.text()}`)
  }

  const body = (await response.json()) as GenerateResponse
  return {
    text: body.response ?? '',
    doneReason: body.done_reason ?? 'unknown',
    promptTokens: body.prompt_eval_count ?? 0,
    outputTokens: body.eval_count ?? 0,
    prefillMs: toMs(body.prompt_eval_duration),
    decodeMs: toMs(body.eval_duration)
  }
}

export async function prime(
  config: Config,
  request: FimRequest,
  signal: AbortSignal
): Promise<void> {
  await fetchCompletion({ ...config, numPredict: 1 }, request, signal).catch(() => undefined)
}
