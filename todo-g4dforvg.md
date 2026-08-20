# Project TODO

- [x] No separate-host replacement is required after clarifying that the terminal must share the published application's Unix user.
- [x] Run the terminal as the real user on the same actual machine that owns the target files.
- [x] Verify that the terminal uses the same Unix user and working directory as the published application process.
- [x] Clarified that the application must remain the app user; a whole-runtime root switch is not requested.
- [x] Superseded the whole-runtime root validation after narrowing the requirement to the terminal only.
- [x] Preserve the published application as the app user while launching only Terminal sessions as root.
- [ ] Validate and publish the root-terminal-only execution path.
