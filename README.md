# @zonuexe/pi-apple-fm 

> Apple Foundation Models (`fm chat`) extension for [Pi](https://pi.dev) coding agent harness on macOS.

[![Pi Package](https://img.shields.io/badge/pi--package-ready-green.svg)](https://pi.dev/packages)
[![Platform: macOS](https://img.shields.io/badge/platform-macOS%2015%2B-lightgrey.svg)](https://developer.apple.com/foundation-models-framework/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

`@zonuexe/pi-apple-fm` connects Pi directly with Apple's native on-device Foundation Models framework through macOS's built-in `/usr/bin/fm` CLI.

It exposes `fm chat` for saved sessions, `fm respond` for one-shot answers (JSON schema and images), and `fm count-tokens` against the 4096-token on-device window. `/fm status` also reports whether the `fm` license has been agreed to. It does not agree to the license for you.

---

## Requirements

- **Operating System:** macOS 15 (Sequoia) or later
- **Hardware:** Apple Silicon Mac with Apple Intelligence enabled
- **CLI Utility:** Native `/usr/bin/fm` (verify with `fm available` in your terminal)
- **Harness:** [Pi coding agent](https://pi.dev) (`>= 1.5.0`)

---

## Installation

### Via Pi Package Manager

Install globally in your user settings:

```bash
# From npm
pi install npm:@zonuexe/pi-apple-fm

# Or directly from GitHub
pi install git:github.com/zonuexe/pi-apple-fm
```

### Try Without Installing

Run Pi with the extension for a single session:

```bash
pi -e git:github.com/zonuexe/pi-apple-fm
```

### Local Development / Project-level

Clone this repository and point Pi to it:

```bash
git clone https://github.com/zonuexe/pi-apple-fm.git
cd pi-apple-fm
npm install
npm test

# Try locally
pi -e .
```

---

## Features

### 1. Model Provider: `apple/system` (Selectable via `/model`)

`@zonuexe/pi-apple-fm` registers an OpenAI-compatible provider `apple` that connects directly to `fm serve` (`http://127.0.0.1:1976/v1`):

- **Select in Pi:** Open `/model` and choose `apple / system` (or run `pi --model apple/system`).
- **Server Control:** Start the background server anytime using `/fm serve start` (or through the interactive `/fm` menu).

---

### 2. Tool: `apple_fm_chat`

The AI agent inside Pi can invoke `apple_fm_chat` to leverage local on-device Apple Foundation Models.

#### Parameters (1:1 with `fm chat --help`):

| Parameter | Type | Description |
|---|---|---|
| `prompt` | `string` (required) | The message or prompt to send |
| `instructions` | `string` (optional) | `-i, --instructions <t>` Instructions for the model |
| `model` | `string` (optional) | `-m, --model <model>` Model to use (default: `system`) |
| `resume` | `string` (optional) | `-r, --resume <name>` Resume a saved session from `~/.fm/sessions/` |
| `continue` | `boolean` (optional) | `--continue` Continue the most recent session |
| `tools` | `string[]` (optional) | `--tool <name>` Built-in tools to enable (`barcode`, `ocr`) |
| `setDefaultModel` | `string` (optional) | `--set-default-model <m>` Persist default model |

#### Key Capabilities:
- **Real-time token streaming:** Emits live partial responses in the TUI as tokens are generated on-device.
- **Custom UI Rendering:** Custom TUI headers displaying ` Apple FM [chat]`, active tools, session IDs, and execution latency.
- **Graceful Cancellation:** Cancels the underlying `fm` process immediately if the user stops the agent.
- **Window check:** Rejects the call when `fm count-tokens` reports more than 4096 tokens.

`fm chat` cannot attach images. OCR and barcode belong on `apple_fm_respond`.

---

### 3. Tool: `apple_fm_respond`

One-shot `fm respond`. It does not write a session under `~/.fm/sessions/`.

| Parameter | Type | Description |
|---|---|---|
| `prompt` | `string` | Prompt sent on stdin |
| `instructions` | `string` (optional) | `-i, --instructions` |
| `schema` | `object` or JSON `string` (optional) | Structured output. Missing `title` and `x-order` are filled in |
| `images` | `{ path, label? }[]` (optional) | `--image` / `--label` |
| `texts` | `string[]` (optional) | Extra `--text` segments |
| `tools` | `("barcode" \| "ocr")[]` (optional) | Built-in vision tools. Pass an image with them |
| `useCase` | `"general" \| "content-tagging"` (optional) | `--use-case` |

### 4. Tool: `apple_fm_count_tokens`

Counts tokens with `fm count-tokens --quiet`. The same count is available as `/fm tokens <prompt>`.

---

### 5. Slash Command: `/fm`

Use `/fm` inside Pi's interactive terminal to converse with Apple Foundation Models directly.

#### Interactive Mode (No Arguments)
Type `/fm` and press Enter to launch the interactive selector:
- 💬 **New chat message:** Prompt input modal
- ⏩ **Continue last session (`--continue`):** Seamlessly continue conversation
- 📂 **Resume saved session (`--resume`):** Pick from your saved sessions with previews
- 📋 **List saved sessions:** Browse all transcripts saved in `~/.fm/sessions/`
- ℹ️ **Check model availability:** Validates Apple Foundation Models status

#### CLI Flags Mode
You can also supply flags directly on the command line:

```text
/fm What are the new APIs in Swift 6?
/fm -i "You are an expert compiler engineer" Why does actor isolation matter?
/fm --continue Can you show an example?
/fm --resume my-session Explain in more detail
/fm --tool ocr Read the text in this image
/fm sessions
/fm status
/fm tokens What is Swift?
/fm license
/fm license show
```

#### Autocompletion:
- Typing `/fm -r ` or `/fm --resume ` dynamically reads `~/.fm/sessions/` and auto-completes session names with message counts and dates.
- Typing `/fm --` auto-completes available flags.

---

## Session Storage

Sessions generated by `fm chat` are automatically persisted by macOS into:

```text
~/.fm/sessions/<session-name>.json
```

Transcripts follow the Apple Foundation Models schema (`FoundationModels.Transcript`), enabling seamless switching between Pi's extension and macOS's native `fm` CLI in your shell.

---

## Development & Testing

```bash
# Install development dependencies
npm install

# Run typecheck
npm run check

# Build TypeScript to dist/
npm run build

# Run unit & live integration tests
npm test
```

---

## References

- [Pi Extensions Documentation](https://pi.dev/docs/latest/extensions)
- [Apple Foundation Models Framework](https://developer.apple.com/foundation-models-framework/)
- [Pi Packages Specification](https://pi.dev/docs/latest/packages)

---

## Copyright

[MIT](./LICENSE) 

> Copyright 2026 USAMI Kenta
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

