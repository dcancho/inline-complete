# Inline Complete

Inline code completion backed by a local Ollama model, using fill-in-the-middle.

## Requirements

Ollama running locally with a base (non-instruct) code model:

```bash
ollama pull qwen2.5-coder:3b-base
```

The instruct variants are trained to converse and perform noticeably worse at
fill-in-the-middle. Use the `-base` tags.

## How it works

Each request sends the text before the cursor as `prefix` and the text after it
as `suffix` to Ollama's `/api/generate`, which applies the model's own FIM
template.

Signatures of symbols near the cursor are resolved through the language server
and injected at the head of the prefix as comments. That block is built in the
background and frozen per enclosing symbol, because any change to the head of
the prefix invalidates the KV cache and turns a 15 ms prefill into a 600 ms one.

Automatic triggers use a smaller token budget than explicit invocations, since
decode time dominates total latency.

## Settings

All settings live under `inlineComplete`. The ones worth tuning:

| Setting | Default | Notes |
| --- | --- | --- |
| `model` | `qwen2.5-coder:3b-base` | Must be a base model for FIM |
| `automaticNumPredict` | `32` | Output budget while typing; the main latency lever |
| `maxPrefixChars` | `6000` | Context sent before the cursor |
| `singleLine` | `false` | Cuts suggestions at the first newline |
| `symbols.enabled` | `true` | Signature injection |
| `priming.enabled` | `true` | Warms the KV cache on navigation |
| `telemetry.enabled` | `true` | Local JSONL log, never leaves the machine |

## Telemetry

Completion latency, token counts and acceptance are appended to a JSONL file in
the extension's global storage. Nothing is sent anywhere.

Run `Inline Complete: Open Telemetry Log` to see the raw file, or summarize it:

```bash
node tools/report.mjs <log directory>
```

The report breaks down accept rate and latency by language and by whether the
symbol block was present.

## Development

```bash
npm install
npm test
npm run build
```

Press F5 to launch an Extension Development Host. The isolated launch
configuration disables other extensions, which is the only reliable way to tell
this extension's suggestions from another provider's.
