import { FIM_STOPS } from './ollama'

const TRIMMABLE_TAIL = /^[\s)\]}>;,]*$/
const TRAILING_SPACE = /\s+$/
const LINE_BREAK = /\r?\n/

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

function dropCurrentLineOverlap(completion: string, suffix: string): string {
  const remainder = suffix.split(LINE_BREAK)[0].trimStart()
  if (remainder.length === 0) {
    return completion
  }
  const lastLine = completion.slice(completion.lastIndexOf('\n') + 1)
  for (let length = Math.min(lastLine.length, remainder.length); length > 0; length--) {
    const tail = lastLine.slice(lastLine.length - length)
    if (TRIMMABLE_TAIL.test(tail) && remainder.startsWith(tail)) {
      return completion.slice(0, completion.length - length)
    }
  }
  return completion
}

export function suffixStop(suffix: string): string | undefined {
  const lines = suffix.split(LINE_BREAK)
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index].replace(TRAILING_SPACE, '')
    if (line.trim().length > 0) {
      return `\n${line}`
    }
  }
  return undefined
}

export function dropIncompleteLine(text: string): string {
  const newline = text.lastIndexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

export function cleanCompletion(
  raw: string,
  suffix: string,
  singleLine: boolean,
  truncated = false
): string | undefined {
  let text = stripControlTokens(raw)

  const stop = suffixStop(suffix)
  const stopIndex = stop ? text.indexOf(stop) : -1
  if (stopIndex !== -1) {
    text = text.slice(0, stopIndex)
  } else if (truncated) {
    text = dropIncompleteLine(text)
  }

  if (singleLine) {
    const newline = text.indexOf('\n')
    if (newline !== -1) {
      text = text.slice(0, newline)
    }
  }

  text = text.replace(TRAILING_SPACE, '')
  text = dropCurrentLineOverlap(text, suffix).replace(TRAILING_SPACE, '')

  return text.trim().length > 0 ? text : undefined
}
