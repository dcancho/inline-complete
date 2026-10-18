interface Entry {
  prefix: string
  completion: string
}

const MAX_ENTRIES = 20

export class CompletionCache {
  private entries: Entry[] = []

  lookup(prefix: string): string | undefined {
    for (const entry of this.entries) {
      if (prefix === entry.prefix) {
        return entry.completion.length > 0 ? entry.completion : undefined
      }
      if (!prefix.startsWith(entry.prefix)) {
        continue
      }
      const typed = prefix.slice(entry.prefix.length)
      if (entry.completion.startsWith(typed)) {
        const remainder = entry.completion.slice(typed.length)
        if (remainder.length > 0) {
          return remainder
        }
      }
    }
    return undefined
  }

  store(prefix: string, completion: string): void {
    this.entries = [{ prefix, completion }, ...this.entries.filter((e) => e.prefix !== prefix)]
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.length = MAX_ENTRIES
    }
  }

  clear(): void {
    this.entries = []
  }
}
