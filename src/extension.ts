import * as vscode from 'vscode'
import { InlineCompleteProvider } from './provider'

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Inline Complete', { log: true })
  const provider = new InlineCompleteProvider(output)
  output.info('Inline Complete activated, provider registered for pattern **')

  context.subscriptions.push(
    output,
    vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, provider),
    vscode.commands.registerCommand('inlineComplete.toggle', async () => {
      const section = vscode.workspace.getConfiguration('inlineComplete')
      const next = !section.get('enabled', true)
      await section.update('enabled', next, vscode.ConfigurationTarget.Global)
      vscode.window.setStatusBarMessage(`Inline Complete ${next ? 'on' : 'off'}`, 2000)
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('inlineComplete')) {
        provider.invalidate()
      }
    })
  )
}

export function deactivate(): void {}
