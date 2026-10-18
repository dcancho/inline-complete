import * as vscode from 'vscode'
import { firstSignatureLine, formatBlock } from './blockFormat'

const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]{2,}/g
const SYMBOL_TREE_TTL_MS = 3000

const NOISE = new Set([
  'abstract', 'async', 'await', 'base', 'bool', 'break', 'case', 'catch', 'char', 'class',
  'const', 'continue', 'def', 'default', 'delegate', 'elif', 'else', 'enum', 'event', 'export',
  'extern', 'false', 'finally', 'float', 'for', 'foreach', 'from', 'function', 'get', 'goto',
  'import', 'int', 'interface', 'internal', 'into', 'lambda', 'let', 'lock', 'long', 'module',
  'mutable', 'namespace', 'new', 'null', 'object', 'open', 'operator', 'out', 'override',
  'params', 'pass', 'private', 'protected', 'public', 'raise', 'readonly', 'record', 'ref',
  'return', 'sealed', 'self', 'set', 'short', 'static', 'string', 'struct', 'switch', 'this',
  'throw', 'true', 'try', 'type', 'typeof', 'using', 'val', 'var', 'virtual', 'void', 'while',
  'with', 'yield'
])

export interface SymbolOptions {
  lookbackLines: number
  maxSymbols: number
  maxChars: number
}

interface Candidate {
  name: string
  position: vscode.Position
}

function candidates(
  document: vscode.TextDocument,
  position: vscode.Position,
  lookbackLines: number,
  limit: number
): Candidate[] {
  const start = new vscode.Position(Math.max(0, position.line - lookbackLines), 0)
  const range = new vscode.Range(start, position)
  const text = document.getText(range)
  const base = document.offsetAt(start)

  const latest = new Map<string, vscode.Position>()
  for (const match of text.matchAll(IDENTIFIER)) {
    if (match.index === undefined || NOISE.has(match[0])) {
      continue
    }
    latest.set(match[0], document.positionAt(base + match.index))
  }

  return [...latest.entries()].map(([name, at]) => ({ name, position: at })).slice(-limit)
}

async function signatureAt(
  uri: vscode.Uri,
  position: vscode.Position
): Promise<string | undefined> {
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
    'vscode.executeHoverProvider',
    uri,
    position
  )
  for (const hover of hovers ?? []) {
    for (const content of hover.contents) {
      const value = typeof content === 'string' ? content : content.value
      const line = firstSignatureLine(value)
      if (line) {
        return line
      }
    }
  }
  return undefined
}

function enclosingName(
  symbols: vscode.DocumentSymbol[],
  position: vscode.Position
): string | undefined {
  for (const symbol of symbols) {
    if (!symbol.range.contains(position)) {
      continue
    }
    return enclosingName(symbol.children, position) ?? symbol.name
  }
  return undefined
}

export class SymbolContextStore {
  private readonly blocks = new Map<string, string>()
  private readonly building = new Set<string>()
  private readonly trees = new Map<string, { at: number; symbols: vscode.DocumentSymbol[] }>()

  epochFor(document: vscode.TextDocument, position: vscode.Position): string {
    const key = document.uri.toString()
    const cached = this.trees.get(key)
    if (!cached || Date.now() - cached.at > SYMBOL_TREE_TTL_MS) {
      void this.refreshTree(document)
    }
    const scope = cached
      ? enclosingName(cached.symbols, position) ?? `line${Math.floor(position.line / 25)}`
      : `line${Math.floor(position.line / 25)}`
    return `${key}#${scope}`
  }

  get(epoch: string): string | undefined {
    return this.blocks.get(epoch)
  }

  ensure(
    epoch: string,
    document: vscode.TextDocument,
    position: vscode.Position,
    options: SymbolOptions,
    onReady: (block: string) => void
  ): void {
    if (this.blocks.has(epoch) || this.building.has(epoch)) {
      return
    }
    this.building.add(epoch)
    void this.build(document, position, options)
      .then((block) => {
        this.blocks.set(epoch, block)
        if (block.length > 0) {
          onReady(block)
        }
      })
      .catch(() => this.blocks.set(epoch, ''))
      .finally(() => this.building.delete(epoch))
  }

  clear(): void {
    this.blocks.clear()
    this.trees.clear()
  }

  private async build(
    document: vscode.TextDocument,
    position: vscode.Position,
    options: SymbolOptions
  ): Promise<string> {
    const list = candidates(document, position, options.lookbackLines, options.maxSymbols)
    const resolved = await Promise.all(
      list.map((candidate) => signatureAt(document.uri, candidate.position).catch(() => undefined))
    )
    const signatures = resolved.filter((value): value is string => value !== undefined)
    return formatBlock(signatures, document.languageId, options.maxChars)
  }

  private async refreshTree(document: vscode.TextDocument): Promise<void> {
    try {
      const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider',
        document.uri
      )
      if (symbols) {
        this.trees.set(document.uri.toString(), { at: Date.now(), symbols })
      }
    } catch {
      return
    }
  }
}
