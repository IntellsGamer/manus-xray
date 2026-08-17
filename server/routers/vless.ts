import { z } from "zod";
import {
  createGatewayClient,
  ensureVlessProfile,
  listGatewayClients,
  listSubscriptionEventsForClient,
  regenerateGatewayProtocolCredential,
  regenerateSubscriptionToken,
  regenerateVlessUuid,
  revokeGatewayClient,
  rotateGatewayClientCredentials,
  setGatewayClientEnabled,
  updateGatewayPathsAndGlobalProfile,
  updateVlessProfile,
} from "../db";
import { adminProcedure, router } from "../_core/trpc";
import { buildClientConnectionDetails, buildSocksClientConfig, buildTrojanUri, buildVlessUri, buildVmessUri, normaliseWsPath } from "../vless";
import { applyXrayProfile } from "../xrayRuntime";

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
    vlessUri: buildVlessUri(profile),
    vmess: { uuid: profile.vmessUuid, wsPath: profile.vmessWsPath, uri: buildVmessUri(profile) },
    trojan: { wsPath: profile.trojanWsPath, uri: buildTrojanUri(profile) },
    socks5: { username: profile.socksUsername, wsPath: profile.socksWsPath, clientConfig: buildSocksClientConfig(profile) },
    subscriptionPath: `/sub/${profile.subscriptionToken}`,
    updatedAt: profile.updatedAt,
  };
}

function presentClient(profile: Awaited<ReturnType<typeof ensureVlessProfile>>, client: Awaited<ReturnType<typeof listGatewayClients>>[number]) {
  return {
    id: client.id,
    name: client.name,
    enabled: client.enabled,
    expiresAt: client.expiresAt,
    subscriptionPath: `/sub/${client.subscriptionToken}`,
    subscriptionDeliveryCount: client.subscriptionDeliveryCount,
    lastSubscriptionAt: client.lastSubscriptionAt,
    createdAt: client.createdAt,
    connection: buildClientConnectionDetails(profile, client),
  };
}

export const vlessRouter = router({
  get: adminProcedure.query(async ({ ctx }) => {
    const profile = await profileForRequest(ctx.req.headers);
    await applyXrayProfile(profile);
    return presentProfile(profile);
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
    const clients = await listGatewayClients();
    return Promise.all(clients.map(async client => ({
      ...presentClient(profile, client),
      recentDeliveries: await listSubscriptionEventsForClient(client.id),
    })));
  }),
  createClient: adminProcedure.input(z.object({ name: z.string().trim().min(1).max(120) })).mutation(async ({ ctx, input }) => {
    const profile = await profileForRequest(ctx.req.headers);
    const client = await createGatewayClient(input.name);
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
});
