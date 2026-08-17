import type { Express, Request, Response } from "express";
import { getVlessProfileBySubscriptionToken } from "./db";
import { buildSubscriptionPayload } from "./vless";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32}$/;

async function serveSubscription(req: Request, res: Response) {
  const token = req.params.token;
  if (!TOKEN_PATTERN.test(token)) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }

  const profile = await getVlessProfileBySubscriptionToken(token);
  if (!profile) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }

  res
    .status(200)
    .set({
      "Cache-Control": "no-store, max-age=0",
      "Content-Disposition": 'inline; filename="subscription.txt"',
      "X-Content-Type-Options": "nosniff",
    })
    .type("text/plain; charset=utf-8")
    .send(buildSubscriptionPayload(profile));
}

export function registerSubscriptionRoute(app: Express) {
  app.get("/sub/:token", (req, res, next) => {
    serveSubscription(req, res).catch(next);
  });
}
