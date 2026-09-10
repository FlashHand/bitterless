# Maestro manual verification gates

The automated parity and Electron baseline are deliberately offline. The following checks require
real credentials, user media, platform packaging, or remote mutation and remain release gates:

- Sign in to the production Codex/LLM providers; send, stream, abort, and resume a chat.
- Attach and upload a real file through the configured media-upload endpoint.
- Capture, replay, and inject controls on an authenticated customer page.
- Download and install a real Bitterless update through the Maestro update affordance.
- Smoke-test signed/native packages on macOS arm64/x64, Windows x64, and Linux x64/arm64.

Do not add real credentials or remote writes to `yarn check:maestro` or the Playwright baseline.
