import { z } from "zod";
import {
  ensureVlessProfile,
  regenerateGatewayProtocolCredential,
  regenerateSubscriptionToken,
  regenerateVlessUuid,
  updateVlessProfile,
} from "../db";
import { adminProcedure, router } from "../_core/trpc";
import { buildSocksClientConfig, buildTrojanUri, buildVlessUri, buildVmessUri, normaliseWsPath } from "../vless";
import { applyXrayProfile } from "../xrayRuntime";

const profileInput = z.object({
  serverAddress: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  wsPath: z.string().trim().min(1).max(255),
  tlsEnabled: z.boolean(),
});

function requestHost(headers: Record<string, string | string[] | undefined>) {
  const forwarded = headers["x-forwarded-host"];
  const host = Array.isArray(forwarded) ? forwarded[0] : forwarded ?? headers.host;
  const firstHost = Array.isArray(host) ? host[0] : host;
  return (firstHost?.split(",")[0]?.trim().replace(/:\d+$/, "") || "localhost").toLowerCase();
}

function presentProfile(profile: Awaited<ReturnType<typeof ensureVlessProfile>>) {
  return {
    uuid: profile.uuid,
    serverAddress: profile.serverAddress,
    port: profile.port,
    wsPath: profile.wsPath,
    tlsEnabled: profile.tlsEnabled,
    vlessUri: buildVlessUri(profile),
    vmess: {
      uuid: profile.vmessUuid,
      wsPath: profile.vmessWsPath,
      uri: buildVmessUri(profile),
    },
    trojan: {
      wsPath: profile.trojanWsPath,
      uri: buildTrojanUri(profile),
    },
    socks5: {
      username: profile.socksUsername,
      wsPath: profile.socksWsPath,
      clientConfig: buildSocksClientConfig(profile),
    },
    subscriptionPath: `/sub/${profile.subscriptionToken}`,
    updatedAt: profile.updatedAt,
  };
}

export const vlessRouter = router({
  get: adminProcedure.query(async ({ ctx }) => {
    const profile = await ensureVlessProfile(requestHost(ctx.req.headers));
    await applyXrayProfile(profile);
    return presentProfile(profile);
  }),
  update: adminProcedure.input(profileInput).mutation(async ({ ctx, input }) => {
    await ensureVlessProfile(requestHost(ctx.req.headers));
    const profile = await updateVlessProfile({ ...input, wsPath: normaliseWsPath(input.wsPath) });
    await applyXrayProfile(profile);
    return presentProfile(profile);
  }),
  regenerateUuid: adminProcedure.mutation(async ({ ctx }) => {
    await ensureVlessProfile(requestHost(ctx.req.headers));
    const profile = await regenerateVlessUuid();
    await applyXrayProfile(profile);
    return presentProfile(profile);
  }),
  regenerateToken: adminProcedure.mutation(async ({ ctx }) => {
    await ensureVlessProfile(requestHost(ctx.req.headers));
    const profile = await regenerateSubscriptionToken();
    await applyXrayProfile(profile);
    return presentProfile(profile);
  }),
  regenerateProtocolCredential: adminProcedure.input(z.object({ protocol: z.enum(["vmess", "trojan", "socks"]) })).mutation(async ({ ctx, input }) => {
    await ensureVlessProfile(requestHost(ctx.req.headers));
    const profile = await regenerateGatewayProtocolCredential(input.protocol);
    await applyXrayProfile(profile);
    return presentProfile(profile);
  }),
});
