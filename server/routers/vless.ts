import { z } from "zod";
import {
  createGatewayClient,
  deleteGatewayClient,
  ensureVlessProfile,
  getGatewayClientById,
  listGatewayClients,
  listSubscriptionEventsForClient,
  regenerateGatewayProtocolCredential,
  regenerateSubscriptionToken,
  regenerateVlessUuid,
  resetGatewayClientTrafficUsage,
  revokeGatewayClient,
  rotateGatewayClientCredentials,
  setGatewayClientEnabled,
  updateGatewayPathsAndGlobalProfile,
  updateGatewayClientPolicy,
  updateVlessProfile,
} from "../db";
import { adminProcedure, router } from "../_core/trpc";
import { buildClientConnectionDetails, buildGatewayConnectionDetails, normaliseWsPath } from "../vless";
import { applyXrayProfile, enforceGatewayTrafficQuotas, getXrayRuntimeStatus } from "../xrayRuntime";

const profileInput = z.object({
  serverAddress: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  wsPath: z.string().trim().min(1).max(255),
  tlsEnabled: z.boolean(),
});

const pathsInput = z.object({
  wsPath: z.string().trim().min(1).max(255),
  vmessWsPath: z.string().trim().min(1).max(255),
  trojanWsPath: z.string().trim().min(1).max(255),
  socksWsPath: z.string().trim().min(1).max(255),
  globalProfileEnabled: z.boolean(),
});

const speedLimitInput = z.number().int().min(-1).max(100_000).refine(value => value === -1 || value >= 1, "Speed limit must be -1 or at least 1 Mbps");

function requestHost(headers: Record<string, string | string[] | undefined>) {
  const forwarded = headers["x-forwarded-host"];
  const host = Array.isArray(forwarded) ? forwarded[0] : forwarded ?? headers.host;
  const firstHost = Array.isArray(host) ? host[0] : host;
  return (firstHost?.split(",")[0]?.trim().replace(/:\d+$/, "") || "localhost").toLowerCase();
}

async function profileForRequest(headers: Record<string, string | string[] | undefined>) {
  return ensureVlessProfile(requestHost(headers));
}

function presentProfile(profile: Awaited<ReturnType<typeof ensureVlessProfile>>) {
  const connection = buildGatewayConnectionDetails(profile);
  return {
    uuid: profile.uuid,
    serverAddress: profile.serverAddress,
    port: profile.port,
    wsPath: profile.wsPath,
    vmessWsPath: profile.vmessWsPath,
    trojanWsPath: profile.trojanWsPath,
    socksWsPath: profile.socksWsPath,
    tlsEnabled: profile.tlsEnabled,
    globalProfileEnabled: profile.globalProfileEnabled,
    vlessUri: connection.vlessUri,
    vmess: { uuid: profile.vmessUuid, wsPath: profile.vmessWsPath, uri: connection.vmessUri },
    trojan: { wsPath: profile.trojanWsPath, uri: connection.trojanUri },
    socks5: { username: profile.socksUsername, wsPath: profile.socksWsPath, clientConfig: connection.socksClientConfig },
    subscriptionPath: `/sub/${profile.subscriptionToken}`,
    updatedAt: profile.updatedAt,
  };
}

function presentClient(profile: Awaited<ReturnType<typeof ensureVlessProfile>>, client: Awaited<ReturnType<typeof listGatewayClients>>[number], trafficUsageAvailable = false) {
  return {
    id: client.id,
    name: client.name,
    enabled: client.enabled,
    expiresAt: client.expiresAt,
    trafficLimitBytes: Number(client.trafficLimitBytes),
    trafficUsedBytes: Number(client.trafficUsedBytes),
    remainingTrafficBytes: client.trafficLimitBytes < 0 ? null : Math.max(0, Number(client.trafficLimitBytes) - Number(client.trafficUsedBytes)),
    trafficUsageAvailable,
    dayLimit: client.dayLimit,
    speedLimitMbps: client.speedLimitMbps,
    subscriptionPath: `/sub/${client.subscriptionToken}`,
    subscriptionDeliveryCount: client.subscriptionDeliveryCount,
    lastSubscriptionAt: client.lastSubscriptionAt,
    quotaExhaustedAt: client.quotaExhaustedAt,
    createdAt: client.createdAt,
    connection: buildClientConnectionDetails(profile, client),
  };
}

export const vlessRouter = router({
  get: adminProcedure.query(async ({ ctx }) => {
    const profile = await profileForRequest(ctx.req.headers);
    await enforceGatewayTrafficQuotas(profile);
    await applyXrayProfile(profile);
    return { ...presentProfile(profile), runtime: getXrayRuntimeStatus() };
  }),
  update: adminProcedure.input(profileInput).mutation(async ({ ctx, input }) => {
    await profileForRequest(ctx.req.headers);
    const profile = await updateVlessProfile({ ...input, wsPath: normaliseWsPath(input.wsPath) });
    await applyXrayProfile(profile);
    return presentProfile(profile);
  }),
  updatePaths: adminProcedure.input(pathsInput).mutation(async ({ ctx, input }) => {
    await profileForRequest(ctx.req.headers);
    const profile = await updateGatewayPathsAndGlobalProfile(input);
    await applyXrayProfile(profile);
    return presentProfile(profile);
  }),
  regenerateUuid: adminProcedure.mutation(async ({ ctx }) => {
    await profileForRequest(ctx.req.headers);
    const profile = await regenerateVlessUuid();
    await applyXrayProfile(profile);
    return presentProfile(profile);
  }),
  regenerateToken: adminProcedure.mutation(async ({ ctx }) => {
    await profileForRequest(ctx.req.headers);
    const profile = await regenerateSubscriptionToken();
    await applyXrayProfile(profile);
    return presentProfile(profile);
  }),
  regenerateProtocolCredential: adminProcedure.input(z.object({ protocol: z.enum(["vmess", "trojan", "socks"]) })).mutation(async ({ ctx, input }) => {
    await profileForRequest(ctx.req.headers);
    const profile = await regenerateGatewayProtocolCredential(input.protocol);
    await applyXrayProfile(profile);
    return presentProfile(profile);
  }),
  clients: adminProcedure.query(async ({ ctx }) => {
    const profile = await profileForRequest(ctx.req.headers);
    const quotaCheck = await enforceGatewayTrafficQuotas(profile);
    const clients = await listGatewayClients();
    return Promise.all(clients.map(async client => ({
      ...presentClient(profile, client, quotaCheck.trafficUsageAvailable),
      recentDeliveries: await listSubscriptionEventsForClient(client.id),
    })));
  }),
  createClient: adminProcedure.input(z.object({ name: z.string().trim().min(1).max(120), trafficLimitBytes: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER).default(-1), dayLimit: z.number().int().min(-1).max(3650).default(-1), speedLimitMbps: speedLimitInput.default(-1) })).mutation(async ({ ctx, input }) => {
    const profile = await profileForRequest(ctx.req.headers);
    const client = await createGatewayClient(input);
    await applyXrayProfile(profile);
    return presentClient(profile, client);
  }),
  setClientEnabled: adminProcedure.input(z.object({ id: z.number().int().positive(), enabled: z.boolean() })).mutation(async ({ ctx, input }) => {
    const profile = await profileForRequest(ctx.req.headers);
    const client = await setGatewayClientEnabled(input.id, input.enabled);
    await applyXrayProfile(profile);
    return presentClient(profile, client);
  }),
  rotateClient: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const profile = await profileForRequest(ctx.req.headers);
    const client = await rotateGatewayClientCredentials(input.id);
    await applyXrayProfile(profile);
    return presentClient(profile, client);
  }),
  revokeClient: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const profile = await profileForRequest(ctx.req.headers);
    const client = await revokeGatewayClient(input.id);
    await applyXrayProfile(profile);
    return presentClient(profile, client);
  }),
  deleteClient: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const profile = await profileForRequest(ctx.req.headers);
    await deleteGatewayClient(input.id);
    await applyXrayProfile(profile);
    return { success: true } as const;
  }),
  updateClientPolicy: adminProcedure.input(z.object({ id: z.number().int().positive(), trafficLimitBytes: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER), dayLimit: z.number().int().min(-1).max(3650), speedLimitMbps: speedLimitInput })).mutation(async ({ ctx, input }) => {
    const profile = await profileForRequest(ctx.req.headers);
    const client = await updateGatewayClientPolicy(input.id, input);
    await applyXrayProfile(profile);
    return presentClient(profile, client);
  }),
  resetClientUsage: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const profile = await profileForRequest(ctx.req.headers);
    const client = await getGatewayClientById(input.id);
    if (!client) throw new Error("Gateway client was not found");
    const reset = await resetGatewayClientTrafficUsage(input.id);
    return presentClient(profile, reset, true);
  }),
});
