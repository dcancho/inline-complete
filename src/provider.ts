import * as path from 'node:path'
import * as vscode from 'vscode'
import { Config, readConfig } from './config'
import { CompletionCache } from './cache'
import { cleanCompletion, suffixStop } from './postprocess'
import { fetchCompletion, prime } from './ollama'
import { SymbolContextStore } from './symbols'
import { Telemetry } from './telemetry'

const WORD_CHARACTER = /[\w$]/
const SAMPLE_PREFIX_CHARS = 2000
const SAMPLE_SUFFIX_CHARS = 500

interface Call {
  id: string
  prefix: string
  suffix: string
  block: string
  automatic: boolean
  line: number
}

function documentFacts(document: vscode.TextDocument): Record<string, unknown> {
  const end = document.lineAt(document.lineCount - 1).range.end
  return {
    scheme: document.uri.scheme,
    ext: path.extname(document.fileName),
    docChars: document.offsetAt(end),
    docLines: document.lineCount
  }
}

function slicePrefix(document: vscode.TextDocument, position: vscode.Position, limit: number): string {
  const start = document.positionAt(Math.max(0, document.offsetAt(position) - limit))
  return document.getText(new vscode.Range(start, position))
}

function sliceSuffix(document: vscode.TextDocument, position: vscode.Position, limit: number): string {
  const end = document.positionAt(document.offsetAt(position) + limit)
  return document.getText(new vscode.Range(position, end))
}

function insideIdentifier(document: vscode.TextDocument, position: vscode.Position): boolean {
  const next = document.lineAt(position.line).text.charAt(position.character)
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
  private readonly symbols = new SymbolContextStore()
  private inFlight: AbortController | undefined
  private priming: AbortController | undefined
  private counter = 0

  constructor(
    private readonly output: vscode.LogOutputChannel,
    private readonly telemetry: Telemetry
  ) {}

  invalidate(): void {
    this.cache.clear()
    this.symbols.clear()
  }

  recordAcceptance(id: string): void {
    this.output.info(`accepted ${id}`)
    this.telemetry.record({ event: 'accepted', id })
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const config = readConfig()
    if (!config.enabled || token.isCancellationRequested) {
      return undefined
    }

    const block = this.symbolBlock(config, document, position)
    const prefix = block + slicePrefix(document, position, config.maxPrefixChars)
    const suffix = sliceSuffix(document, position, config.maxSuffixChars)
    const id = `c${++this.counter}`

    const cached = this.cache.lookup(prefix)
    if (cached) {
      this.output.info(`cache hit, ${cached.text.length} chars from ${cached.origin}`)
      this.telemetry.record({
        event: 'cache_hit',
        id,
        origin: cached.origin,
        lang: document.languageId,
        suggestionChars: cached.text.length
      })
      return [this.toItem(cached.text, position, cached.origin)]
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

    const budget = automatic ? { ...config, numPredict: config.automaticNumPredict } : config
    const call: Call = { id, prefix, suffix, block, automatic, line: position.line }
    const text = await this.request(budget, document, call, token)
    if (!text) {
      return undefined
    }

    this.cache.store(prefix, text, id)
    return [this.toItem(text, position, id)]
  }

  private symbolBlock(
    config: Config,
    document: vscode.TextDocument,
    position: vscode.Position
  ): string {
    if (!config.symbolsEnabled) {
      return ''
    }
    const epoch = this.symbols.epochFor(document, position)
    this.symbols.ensure(
      epoch,
      document,
      position,
      {
        lookbackLines: config.symbolsLookbackLines,
        maxSymbols: config.symbolsMaxCount,
        maxChars: config.symbolsMaxChars
      },
      (built) => {
        this.output.info(`symbol block ready, ${built.length} chars`)
        this.warm(config, document, position, built)
      }
    )
    return this.symbols.get(epoch) ?? ''
  }

  private warm(
    config: Config,
    document: vscode.TextDocument,
    position: vscode.Position,
    block: string
  ): void {
    if (!config.primingEnabled || block.length === 0) {
      return
    }
    this.priming?.abort()
    const controller = new AbortController()
    this.priming = controller

    const prefix = block + slicePrefix(document, position, config.maxPrefixChars)
    const suffix = sliceSuffix(document, position, config.maxSuffixChars)
    const started = Date.now()

    void prime(config, { prefix, suffix }, controller.signal).then(() => {
      if (!controller.signal.aborted) {
        this.output.debug(`primed kv cache in ${Date.now() - started}ms`)
      }
      if (this.priming === controller) {
        this.priming = undefined
      }
    })
  }

  private async request(
    config: Config,
    document: vscode.TextDocument,
    call: Call,
    token: vscode.CancellationToken
  ): Promise<string | undefined> {
    this.inFlight?.abort()

    const controller = new AbortController()
    this.inFlight = controller

    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs)
    const subscription = token.onCancellationRequested(() => controller.abort())
    const started = Date.now()

    try {
      const stop = suffixStop(call.suffix)
      const result = await fetchCompletion(
        config,
        { prefix: call.prefix, suffix: call.suffix, stops: stop ? [stop] : [] },
        controller.signal
      )
      if (token.isCancellationRequested) {
        return undefined
      }

      const truncated = result.doneReason === 'length'
      const text = cleanCompletion(result.text, call.suffix, config.singleLine, truncated)
      const wallMs = Date.now() - started

      this.output.info(
        `${wallMs}ms prefix=${call.prefix.length} chars (${call.block.length} symbols), ` +
          `raw ${result.text.length} chars, suggestion ${text?.length ?? 0} chars, ` +
          `prefill ${result.prefillMs}ms decode ${result.decodeMs}ms, done ${result.doneReason}`
      )
      if (result.text.length > 0 && text === undefined) {
        this.output.debug(`discarded by cleanup: ${JSON.stringify(result.text)}`)
      }

      this.telemetry.record({
        event: 'completion',
        id: call.id,
        lang: document.languageId,
        ...documentFacts(document),
        line: call.line,
        automatic: call.automatic,
        budget: config.numPredict,
        prefixChars: call.prefix.length,
        blockChars: call.block.length,
        rawChars: result.text.length,
        suggestionChars: text?.length ?? 0,
        doneReason: result.doneReason,
        truncated,
        wallMs,
        promptTokens: result.promptTokens,
        outputTokens: result.outputTokens,
        prefillMs: result.prefillMs,
        decodeMs: result.decodeMs
      })

      if (config.captureContent) {
        this.telemetry.sample({
          id: call.id,
          lang: document.languageId,
          file: path.basename(document.fileName),
          line: call.line,
          block: call.block,
          prefixTail: call.prefix.slice(call.block.length).slice(-SAMPLE_PREFIX_CHARS),
          suffixHead: call.suffix.slice(0, SAMPLE_SUFFIX_CHARS),
          raw: result.text,
          suggestion: text ?? null,
          doneReason: result.doneReason
        })
      }

      return text
    } catch (error) {
      if (!controller.signal.aborted) {
        this.output.error(String(error))
        this.telemetry.record({ event: 'error', id: call.id, message: String(error) })
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

  private toItem(text: string, position: vscode.Position, id: string): vscode.InlineCompletionItem {
    const item = new vscode.InlineCompletionItem(text, new vscode.Range(position, position))
    item.command = { command: 'inlineComplete.accepted', title: 'Accepted', arguments: [id] }
    return item
  }
}
