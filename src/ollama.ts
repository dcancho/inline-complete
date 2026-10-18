import { Config } from './config'

export const FIM_STOPS = ['<|endoftext|>', '<|fim_pad|>', '<|file_sep|>', '<|fim_prefix|>']

export interface FimRequest {
  prefix: string
  suffix: string
}

interface GenerateResponse {
  response?: string
}

export class OllamaError extends Error {}

export async function fetchCompletion(
  config: Config,
  request: FimRequest,
  signal: AbortSignal
): Promise<string> {
  const stop = config.singleLine ? FIM_STOPS.concat(['\n']) : FIM_STOPS

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
  return body.response ?? ''
}
