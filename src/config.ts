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
    requestTimeoutMs: section.get('requestTimeoutMs', 3000)
  }
}
