# Project TODO

- [x] Document the WebDev hosting boundary for a production VLESS/Xray TCP listener and the required deployment target.
- [x] Add database storage for the owner-managed VLESS profile, including the UUID, listener details, WebSocket path, TLS mode, and subscription token.
- [x] Implement server-side owner-only tRPC procedures to read and regenerate the VLESS UUID and subscription token.
- [x] Implement a public tokenized subscription endpoint that returns Base64-encoded VLESS URI content.
- [x] Replace the public home route with a faithful Nginx default welcome page.
- [x] Build the protected owner-only /admin dashboard using the supplied dashboard layout and secure loading states.
- [x] Display copyable VLESS and subscription configuration details in the admin dashboard.
- [x] Add a deployable Xray configuration generator and child-process supervisor for a compatible persistent host.
- [x] Verify configuration generation, protected procedures, subscription payload delivery, and the rendered public and admin routes.
- [x] Create a final project checkpoint and provide the deployment prerequisite for a live VLESS endpoint.
- [x] Revise the Xray inbound so it binds only to a private loopback port behind the application HTTPS entry point.
- [x] Add an HTTP upgrade handler that forwards only the configured VLESS WebSocket path to the private Xray listener.
- [x] Ensure Xray starts or restarts with the current profile before the application accepts proxied upgrade traffic.
- [x] Add automated coverage and a loopback end-to-end test for the WebSocket proxy architecture.
- [x] Replace the outdated deployment boundary documentation and checkpoint the revised implementation.
- [x] Diagnose the timeout of the supplied `nginxadmin-kw4zek2d.manus.space` VLESS URI against the published first revision.
- [ ] Validate the supplied public VLESS URI after the WebSocket bridge revision is published.
