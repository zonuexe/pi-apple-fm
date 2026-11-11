# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-11

### Added
- Model Provider registration: `apple/system` is now selectable via `/model` and `--model apple/system`.
- Background server integration with `fm serve` (`http://127.0.0.1:1976/v1`).
- `/fm serve` command to check status, start, or stop the local completions server.
- Initial release of `@zonuexe/pi-apple-fm`.
- `apple_fm_chat` tool for calling Apple Foundation Models on macOS via `fm chat`.
- Support for all `fm chat --help` parameters:
  - `-i, --instructions <t>`: System instructions for on-device models.
  - `-m, --model <model>`: Specify model target (default: `system`).
  - `-r, --resume <name>`: Resume a saved chat transcript from `~/.fm/sessions/`.
  - `--continue`: Continue the most recently active session.
  - `--tool <name>`: Built-in tools enablement (such as `barcode` and `ocr`).
  - `--set-default-model <m>`: Persist default model configuration.
- Streaming token rendering via `onUpdate` as model responses are emitted.
- Custom Pi TUI tool call and result renderers with Apple Foundation Models badges.
- `/fm` slash command with argument autocompletion for flags and saved session names.
- Interactive TUI dialog for browsing, resuming, and continuing sessions without typing terminal commands.
- Diagnostic check `checkFmAvailability()` for validating macOS Apple Silicon environment and `fm available`.
