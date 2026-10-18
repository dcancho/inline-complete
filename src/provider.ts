import * as vscode from 'vscode'
import { Config, readConfig } from './config'
import { CompletionCache } from './cache'
import { cleanCompletion } from './postprocess'
import { fetchCompletion } from './ollama'

const WORD_CHARACTER = /[\w$]/

function slicePrefix(document: vscode.TextDocument, position: vscode.Position, limit: number): string {
  const start = document.positionAt(Math.max(0, document.offsetAt(position) - limit))
  return document.getText(new vscode.Range(start, position))
}

function sliceSuffix(document: vscode.TextDocument, position: vscode.Position, limit: number): string {
  const end = document.positionAt(document.offsetAt(position) + limit)
  return document.getText(new vscode.Range(position, end))
}

function insideIdentifier(document: vscode.TextDocument, position: vscode.Position): boolean {
  const line = document.lineAt(position.line).text
  const next = line.charAt(position.character)
  return next.length > 0 && WORD_CHARACTER.test(next)
}

function wait(ms: number, token: vscode.CancellationToken): Promise<boolean> {
  return new Promise((resolve) => {
    let subscription: vscode.Disposable
    const timer = setTimeout(() => {
      subscription.dispose()
      resolve(true)
    }, ms)
    subscription = token.onCancellationRequested(() => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}

export class InlineCompleteProvider implements vscode.InlineCompletionItemProvider {
  private readonly cache = new CompletionCache()
  private inFlight?: AbortController

  constructor(private readonly output: vscode.LogOutputChannel) {}

  invalidate(): void {
    this.cache.clear()
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    this.output.info(
      `invoked: scheme=${document.uri.scheme} lang=${document.languageId} ` +
        `pos=${position.line}:${position.character} trigger=${context.triggerKind}`
    )

    const config = readConfig()
    if (!config.enabled || token.isCancellationRequested) {
      return undefined
    }

    const prefix = slicePrefix(document, position, config.maxPrefixChars)
    const suffix = sliceSuffix(document, position, config.maxSuffixChars)

    const cached = this.cache.lookup(prefix)
    if (cached) {
      this.output.info(`cache hit, ${cached.length} chars`)
      return [this.toItem(cached, position)]
    }

    const automatic = context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic
    if (automatic && insideIdentifier(document, position)) {
      this.output.debug('skipped, cursor inside identifier')
      return undefined
    }
    if (automatic && !(await wait(config.debounceMs, token))) {
      this.output.debug('cancelled during debounce')
      return undefined
    }

    const budget = automatic
      ? { ...config, numPredict: config.automaticNumPredict }
      : config

    const text = await this.request(budget, prefix, suffix, token)
    if (!text) {
      return undefined
    }

    this.cache.store(prefix, text)
    return [this.toItem(text, position)]
  }

  private async request(
    config: Config,
    prefix: string,
    suffix: string,
    token: vscode.CancellationToken
  ): Promise<string | undefined> {
    this.inFlight?.abort()

    const controller = new AbortController()
    this.inFlight = controller

    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs)
    const subscription = token.onCancellationRequested(() => controller.abort())
    const started = Date.now()

    try {
      const raw = await fetchCompletion(config, { prefix, suffix }, controller.signal)
      if (token.isCancellationRequested) {
        return undefined
      }
      const text = cleanCompletion(raw, suffix, config.singleLine)
      this.output.info(
        `${Date.now() - started}ms prefix=${prefix.length} chars, ` +
          `raw ${raw.length} chars, suggestion ${text?.length ?? 0} chars, ` +
          `budget ${config.numPredict} tokens`
      )
      if (raw.length > 0 && text === undefined) {
        this.output.debug(`discarded by cleanup: ${JSON.stringify(raw)}`)
      }
      return text
    } catch (error) {
      if (!controller.signal.aborted) {
        this.output.error(String(error))
      }
      return undefined
    } finally {
      clearTimeout(timer)
      subscription.dispose()
      if (this.inFlight === controller) {
        this.inFlight = undefined
      }
    }
  }

  private toItem(text: string, position: vscode.Position): vscode.InlineCompletionItem {
    return new vscode.InlineCompletionItem(text, new vscode.Range(position, position))
  }
}
