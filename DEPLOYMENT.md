# Production Deployment Boundary

The WebDev application is suitable for the **owner-only configuration panel** and the public HTTP subscription route. The default managed runtime accepts traffic only through its assigned HTTP `PORT` and can scale to zero; it cannot expose a separate public TCP listener for Xray VLESS traffic. A VLESS service therefore cannot be operated end-to-end from a deployed WebDev container, even if a child process is included in its image.

The project includes an Xray configuration generator and local verification coverage. For a live VLESS listener, run the generated Xray configuration on a host that supports externally reachable TCP/WebSocket ports and a persistent process, such as a privately administered Linux server or a compatible persistent virtual machine. The application database settings and generated client URI can then be pointed at that listener's domain and port.

This separation prevents accidental publication of a subscription that appears valid but targets an unreachable listener.
