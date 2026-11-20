import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as vscode from 'vscode'

const FLUSH_INTERVAL_MS = 2000

export type TelemetryEvent = Record<string, unknown>
type Stream = 'completions' | 'samples'

export class Telemetry implements vscode.Disposable {
  private queues: Record<Stream, string[]> = { completions: [], samples: [] }
  private timer: NodeJS.Timeout | undefined
  private enabled: boolean

  constructor(private readonly directory: string, enabled: boolean) {
    this.enabled = enabled
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  get logPath(): string {
    return this.pathFor('completions')
  }

  record(event: TelemetryEvent): void {
    this.enqueue('completions', event)
  }

  sample(event: TelemetryEvent): void {
    this.enqueue('samples', event)
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    for (const stream of Object.keys(this.queues) as Stream[]) {
      const queue = this.queues[stream]
      if (queue.length === 0) {
        continue
      }
      this.queues[stream] = []
      try {
        await fs.mkdir(this.directory, { recursive: true })
        await fs.appendFile(this.pathFor(stream), queue.join('\n') + '\n', 'utf8')
      } catch {
        continue
      }
    }
  }

  dispose(): void {
    void this.flush()
  }

  private pathFor(stream: Stream): string {
    const day = new Date().toISOString().slice(0, 10)
    return path.join(this.directory, `${stream}-${day}.jsonl`)
  }

  private enqueue(stream: Stream, event: TelemetryEvent): void {
    if (!this.enabled) {
      return
    }
    this.queues[stream].push(JSON.stringify({ at: new Date().toISOString(), ...event }))
    if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), FLUSH_INTERVAL_MS)
    }
  }
}
