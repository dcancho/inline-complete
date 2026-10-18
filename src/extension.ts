import * as vscode from 'vscode'
import { readConfig } from './config'
import { InlineCompleteProvider } from './provider'
import { Telemetry } from './telemetry'

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Inline Complete', { log: true })
  const telemetry = new Telemetry(context.globalStorageUri.fsPath, readConfig().telemetryEnabled)
  const provider = new InlineCompleteProvider(output, telemetry)

  output.info(`Inline Complete activated, telemetry at ${telemetry.logPath}`)

  context.subscriptions.push(
    output,
    telemetry,
    vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, provider),
    vscode.commands.registerCommand('inlineComplete.accepted', (id: string) => {
      provider.recordAcceptance(id)
    }),
    vscode.commands.registerCommand('inlineComplete.toggle', async () => {
      const section = vscode.workspace.getConfiguration('inlineComplete')
      const next = !section.get('enabled', true)
      await section.update('enabled', next, vscode.ConfigurationTarget.Global)
      vscode.window.setStatusBarMessage(`Inline Complete ${next ? 'on' : 'off'}`, 2000)
    }),
    vscode.commands.registerCommand('inlineComplete.openLog', async () => {
      await telemetry.flush()
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(telemetry.logPath))
      await vscode.window.showTextDocument(document)
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('inlineComplete')) {
        telemetry.setEnabled(readConfig().telemetryEnabled)
        provider.invalidate()
      }
    })
  )
}

export function deactivate(): void {}
