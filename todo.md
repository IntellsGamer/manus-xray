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
- [ ] Create a final project checkpoint and provide the deployment prerequisite for a live VLESS endpoint.
