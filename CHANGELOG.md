# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.1] - 2026-11-11

### Added

- `/model` can select `apple/system`, which talks to a local `fm serve` on port 1976.
- `/fm serve` starts, checks, or stops that local completions server.
- `apple_fm_chat` and `/fm` send prompts to on-device Apple Foundation Models and can resume saved sessions.
  - Flags match `fm chat`: instructions, model, resume, continue, built-in tools, and set-default-model.
- `/fm` completes session names and flags, and can browse or resume sessions from `~/.fm/sessions/`.
- `apple_fm_respond` returns a one-shot answer, including JSON Schema output and image input for OCR or barcode.
- `apple_fm_count_tokens` and `/fm tokens` count tokens for a prompt.
- Prompts over the 4096-token on-device window are rejected before they are sent.
- `/fm status` reports model availability, server health, and whether the `fm` license has been agreed to.
- `/fm license show` prints the license text without agreeing to it.

[Unreleased]: https://github.com/zonuexe/pi-apple-fm/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/zonuexe/pi-apple-fm/releases/tag/v0.0.1
