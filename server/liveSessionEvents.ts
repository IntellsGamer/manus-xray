import type { Express, Request, Response } from "express";
import { listGatewayLiveSessionGroups } from "./db";
import { sdk } from "./_core/sdk";

const STREAM_INTERVAL_MS = 1_500;

function writeEvent(res: Response, event: string, payload: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export function registerLiveSessionEventRoute(app: Express) {
  app.get("/api/live-sessions/events", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req, res);
      if (user.role !== "admin") {
        res.status(403).json({ error: "Owner access required" });
        return;
      }
    } catch {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    res.status(200).set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    let closed = false;
    let sending = false;
    let lastPayload = "";
    const publish = async () => {
      if (closed || sending) return;
      sending = true;
      try {
        const groups = await listGatewayLiveSessionGroups();
        const payload = JSON.stringify(groups);
        if (payload !== lastPayload) {
          lastPayload = payload;
          writeEvent(res, "sessions", groups);
        } else {
          res.write(": keep-alive\n\n");
        }
      } catch {
        if (!closed) writeEvent(res, "error", { message: "Live session stream is temporarily unavailable" });
      } finally {
        sending = false;
      }
    };

    await publish();
    const timer = setInterval(() => { void publish(); }, STREAM_INTERVAL_MS);
    timer.unref?.();
    req.on("close", () => {
      closed = true;
      clearInterval(timer);
      res.end();
    });
  });
}
