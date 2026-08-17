import type { Express, Request, Response } from "express";
import { getVlessProfileByQuotaScheduleTaskUid } from "./db";
import { sdk } from "./_core/sdk";
import { enforceGatewayTrafficQuotas } from "./xrayRuntime";

export function registerQuotaEnforcementRoute(app: Express) {
  app.post("/api/scheduled/quota-enforcement", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });

      const profile = await getVlessProfileByQuotaScheduleTaskUid(user.taskUid);
      if (!profile) return res.json({ ok: true, skipped: "orphaned-or-unconfigured-schedule" });

      const result = await enforceGatewayTrafficQuotas(profile);
      return res.json({ ok: true, ...result, timestamp: new Date().toISOString() });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Quota] Scheduled enforcement failed:", message);
      return res.status(500).json({ error: message, timestamp: new Date().toISOString() });
    }
  });
}
