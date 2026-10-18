const COMMENT_PREFIX: Record<string, string> = {
  python: '#',
  ruby: '#',
  shellscript: '#',
  powershell: '#',
  yaml: '#',
  r: '#',
  sql: '--',
  lua: '--',
  haskell: '--'
}

export function commentPrefix(languageId: string): string {
  return COMMENT_PREFIX[languageId] ?? '//'
}

export function firstSignatureLine(value: string): string | undefined {
  const fenced = /```[a-zA-Z]*\s*\n([\s\S]*?)```/.exec(value)
  const body = (fenced ? fenced[1] : value).trim()
  const line = body.split('\n')[0]?.trim()
  return line && line.length > 1 ? line : undefined
}

export function formatBlock(
  signatures: string[],
  languageId: string,
  maxChars: number
): string {
  const prefix = commentPrefix(languageId)
  const unique: string[] = []
  const seen = new Set<string>()
  for (const signature of signatures) {
    if (!seen.has(signature)) {
      seen.add(signature)
      unique.push(signature)
    }
  }

  let kept = unique
  while (kept.length > 0) {
    const block = [
      `${prefix} --- context ---`,
      ...kept.map((signature) => `${prefix} ${signature}`),
      `${prefix} --- current file ---`,
      ''
    ].join('\n')
    if (block.length <= maxChars) {
      return block
    }
    kept = kept.slice(1)
  }
  return ''
}
