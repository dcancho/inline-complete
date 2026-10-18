import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as vscode from 'vscode'

const FLUSH_INTERVAL_MS = 2000

export type TelemetryEvent = Record<string, unknown>

export class Telemetry implements vscode.Disposable {
  private queue: string[] = []
  private timer: NodeJS.Timeout | undefined
  private enabled: boolean

  constructor(private readonly directory: string, enabled: boolean) {
    this.enabled = enabled
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  get logPath(): string {
    const day = new Date().toISOString().slice(0, 10)
    return path.join(this.directory, `completions-${day}.jsonl`)
  }

  record(event: TelemetryEvent): void {
    if (!this.enabled) {
      return
    }
    this.queue.push(JSON.stringify({ at: new Date().toISOString(), ...event }))
    if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), FLUSH_INTERVAL_MS)
    }
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (this.queue.length === 0) {
      return
    }
    const batch = this.queue.join('\n') + '\n'
    this.queue = []
    try {
      await fs.mkdir(this.directory, { recursive: true })
      await fs.appendFile(this.logPath, batch, 'utf8')
    } catch {
      return
    }
  }

  dispose(): void {
    void this.flush()
  }
}
