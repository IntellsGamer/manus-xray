# HTTPS WebSocket Gateway Deployment

The application can host both the control plane and the VLESS WebSocket entry point on its public HTTPS domain. Incoming requests are handled by the application server. Only WebSocket upgrades whose path exactly matches the persisted VLESS path are forwarded over loopback to Xray; Xray is never exposed on a second public port.

The client configuration therefore uses the application domain, the public HTTPS port (normally `443`), `security=tls`, and the configured WebSocket path. TLS terminates at the managed HTTPS gateway. The internally supervised Xray process listens on `127.0.0.1` with `security=none`, because its inbound traffic has already crossed the trusted local bridge.

The managed hosting platform supports WebSockets, but the streams remain request-scoped and are subject to request-timeout and scaling behavior. Clients must reconnect when their WebSocket is closed. The official Cloud Run guidance also recommends not using end-to-end HTTP/2 for WebSocket services. [1]

The Dockerfile downloads the pinned Xray binary, and application startup launches it only after loading the database-backed profile. Every upgrade request refreshes the profile state before it is bridged, so UUID, token, and listener-path changes are picked up by active instances without a manual container restart.

## Reference

[1] [Using WebSockets — Cloud Run](https://docs.cloud.google.com/run/docs/triggering/websockets)
