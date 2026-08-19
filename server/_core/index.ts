import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { registerSubscriptionRoute } from "../subscription";
import { registerQuotaEnforcementRoute } from "../quotaEnforcement";
import { registerXhttpProxy } from "../xhttpProxy";
import { getVlessProfile } from "../db";
import { applyXrayProfile, stopXrayRuntime } from "../xrayRuntime";
import { registerVlessUpgradeProxy } from "../vlessUpgradeProxy";
import { registerTerminalWebSocket } from "../terminal";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

const pause = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

async function applyStoredXrayProfileAtStartup() {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const profile = await getVlessProfile();
      if (profile) {
        await applyXrayProfile(profile);
        return true;
      }
      console.warn(`[Xray] No stored profile on startup attempt ${attempt}; retrying.`);
    } catch (error) {
      console.error(`[Xray] Startup attempt ${attempt} could not apply the stored profile:`, error);
    }
    if (attempt < 5) await pause(attempt * 500);
  }
  console.error("[Xray] Private runtime did not start after five profile lookup attempts.");
  return false;
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  registerTerminalWebSocket(server);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerSubscriptionRoute(app);
  registerQuotaEnforcementRoute(app);
  registerXhttpProxy(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  if (process.env.XRAY_RUNTIME_ENABLED === "true") {
    registerVlessUpgradeProxy(server);
    await applyStoredXrayProfileAtStartup();
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  const stop = () => {
    stopXrayRuntime().finally(() => server.close());
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

startServer().catch(console.error);
