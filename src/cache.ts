interface Entry {
  prefix: string
  completion: string
  origin: string
}

export interface CacheHit {
  text: string
  origin: string
}

const MAX_ENTRIES = 20

export class CompletionCache {
  private entries: Entry[] = []

  lookup(prefix: string): CacheHit | undefined {
    for (const entry of this.entries) {
      if (prefix === entry.prefix) {
        return entry.completion.length > 0
          ? { text: entry.completion, origin: entry.origin }
          : undefined
      }
      if (!prefix.startsWith(entry.prefix)) {
        continue
      }
      const typed = prefix.slice(entry.prefix.length)
      if (entry.completion.startsWith(typed)) {
        const remainder = entry.completion.slice(typed.length)
        if (remainder.length > 0) {
          return { text: remainder, origin: entry.origin }
        }
      }
    }
    return undefined
  }

  store(prefix: string, completion: string, origin: string): void {
    this.entries = [
      { prefix, completion, origin },
      ...this.entries.filter((entry) => entry.prefix !== prefix)
    ]
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.length = MAX_ENTRIES
    }
  }

  clear(): void {
    this.entries = []
  }
}
