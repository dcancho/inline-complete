import * as vscode from 'vscode'

export interface Config {
  enabled: boolean
  endpoint: string
  model: string
  debounceMs: number
  numCtx: number
  numPredict: number
  automaticNumPredict: number
  temperature: number
  maxPrefixChars: number
  maxSuffixChars: number
  singleLine: boolean
  requestTimeoutMs: number
  symbolsEnabled: boolean
  symbolsMaxChars: number
  symbolsMaxCount: number
  symbolsLookbackLines: number
  primingEnabled: boolean
  telemetryEnabled: boolean
  captureContent: boolean
}

export function readConfig(): Config {
  const section = vscode.workspace.getConfiguration('inlineComplete')
  return {
    enabled: section.get('enabled', true),
    endpoint: section.get('endpoint', 'http://127.0.0.1:11434').replace(/\/+$/, ''),
    model: section.get('model', 'qwen2.5-coder:3b-base'),
    debounceMs: section.get('debounceMs', 150),
    numCtx: section.get('numCtx', 8192),
    numPredict: section.get('numPredict', 64),
    automaticNumPredict: section.get('automaticNumPredict', 32),
    temperature: section.get('temperature', 0.2),
    maxPrefixChars: section.get('maxPrefixChars', 6000),
    maxSuffixChars: section.get('maxSuffixChars', 1500),
    singleLine: section.get('singleLine', false),
    requestTimeoutMs: section.get('requestTimeoutMs', 3000),
    symbolsEnabled: section.get('symbols.enabled', true),
    symbolsMaxChars: section.get('symbols.maxChars', 1200),
    symbolsMaxCount: section.get('symbols.maxCount', 12),
    symbolsLookbackLines: section.get('symbols.lookbackLines', 40),
    primingEnabled: section.get('priming.enabled', true),
    telemetryEnabled: section.get('telemetry.enabled', true),
    captureContent: section.get('telemetry.captureContent', false)
  }
}
