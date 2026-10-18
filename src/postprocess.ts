import { FIM_STOPS } from './ollama'

const TRIMMABLE_TAIL = /^[\s)\]}>;,]*$/
const TRAILING_SPACE = /\s+$/

function stripControlTokens(text: string): string {
  let result = text
  for (const token of FIM_STOPS) {
    const index = result.indexOf(token)
    if (index !== -1) {
      result = result.slice(0, index)
    }
  }
  return result
}

function dropSuffixOverlap(completion: string, suffix: string): string {
  const target = suffix.trimStart()
  if (target.length === 0) {
    return completion
  }
  for (let length = Math.min(completion.length, target.length); length > 0; length--) {
    const tail = completion.slice(completion.length - length)
    if (TRIMMABLE_TAIL.test(tail) && target.startsWith(tail)) {
      return completion.slice(0, completion.length - length)
    }
  }
  return completion
}

export function cleanCompletion(
  raw: string,
  suffix: string,
  singleLine: boolean
): string | undefined {
  let text = stripControlTokens(raw)

  if (singleLine) {
    const newline = text.indexOf('\n')
    if (newline !== -1) {
      text = text.slice(0, newline)
    }
  }

  text = text.replace(TRAILING_SPACE, '')
  text = dropSuffixOverlap(text, suffix).replace(TRAILING_SPACE, '')

  return text.trim().length > 0 ? text : undefined
}
