# Project TODO

- [x] Inspect the current application shell, authentication, reverse-proxy controls, and deployment configuration.
- [x] Add an owner-only Terminal sidebar entry and route, with no terminal UI rendered for other users.
- [x] Implement an authenticated, single-session interactive terminal transport with explicit origin and owner checks.
- [x] Spawn an isolated non-login shell with PTY semantics, terminal resize support, bounded I/O, and automatic cleanup.
- [x] Build the responsive xterm-style client terminal with Shift+Ctrl+V / Shift+Ctrl+C extra controls, clipboard safety, reconnect, resize, and terminate actions.
- [x] Add Vitest coverage for owner authorization and terminal session safeguards.
- [x] Verify TypeScript, tests, development preview, desktop/mobile layout, and save a published checkpoint.
- [x] Preserve the current Autoscale hosting mode and make the terminal safely reconnectable when a request-scoped session is closed.
- [x] Add isolated tests for terminal lease exclusivity, authorization decisions, and cleanup behavior.
- [x] Repair the production image so node-pty’s native binding is built and loadable at application startup.
- [ ] Validate the repaired deployment build and save a corrected published checkpoint.
