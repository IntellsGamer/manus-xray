import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { exportGatewayRecoverySnapshot, GatewayRecoverySnapshot, replaceGatewayRecoverySnapshot } from "../db";
import { closeActiveGatewayTunnels } from "../gatewayTunnels";
import { applyXrayProfile } from "../xrayRuntime";

const nullableTimestamp = z.string().datetime().nullable().transform(value => value ? new Date(value) : null);
const policyInput = {
  trafficLimitBytes: z.number().int().min(-1).max(Number.MAX_SAFE_INTEGER),
  dayLimit: z.number().int().min(-1).max(3650),
  speedLimitMbps: z.number().int().min(-1).max(100_000).refine(value => value === -1 || value >= 1),
  connectionLimit: z.number().int().min(-1).max(10_000).refine(value => value === -1 || value >= 1),
};

const recoverySnapshotInput = z.object({
  schemaVersion: z.literal(1),
  exportedAt: z.string().datetime(),
  profile: z.object({
    uuid: z.string().uuid(),
    serverAddress: z.string().trim().min(1).max(255),
    port: z.number().int().min(1).max(65535),
    wsPath: z.string().trim().min(1).max(255),
    tlsEnabled: z.boolean(),
    subscriptionToken: z.string().min(1).max(96),
    vmessUuid: z.string().uuid(),
    vmessWsPath: z.string().trim().min(1).max(255),
    trojanPassword: z.string().min(1).max(64),
    trojanWsPath: z.string().trim().min(1).max(255),
    socksUsername: z.string().min(1).max(64),
    socksPassword: z.string().min(1).max(64),
    socksWsPath: z.string().trim().min(1).max(255),
    shadowsocksServerKey: z.string().max(128).optional().default(""),
    shadowsocksUserKey: z.string().max(128).optional().default(""),
    shadowsocksWsPath: z.string().trim().max(255).optional().default("/shadowsocks"),
    globalProfileEnabled: z.boolean(),
  }),
  templates: z.array(z.object({ name: z.string().trim().min(1).max(120), ...policyInput })).max(500),
  clients: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    enabled: z.boolean(),
    vlessUuid: z.string().uuid(),
    vmessUuid: z.string().uuid(),
    trojanPassword: z.string().min(1).max(64),
    socksUsername: z.string().min(1).max(64),
    socksPassword: z.string().min(1).max(64),
    shadowsocksUserKey: z.string().max(128).optional().default(""),
    subscriptionToken: z.string().min(1).max(96),
    connectionToken: z.string().min(1).max(64),
    trafficUsedBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    expiresAt: nullableTimestamp,
    quotaExhaustedAt: nullableTimestamp,
    ...policyInput,
  })).max(1_000),
}).superRefine((snapshot, context) => {
  const assertUnique = (values: string[], field: string) => {
    if (new Set(values).size !== values.length) context.addIssue({ code: z.ZodIssueCode.custom, message: `Recovery payload contains duplicate ${field} values` });
  };
  assertUnique(snapshot.templates.map(template => template.name.toLowerCase()), "template name");
  assertUnique(snapshot.clients.map(client => client.vlessUuid), "VLESS UUID");
  assertUnique(snapshot.clients.map(client => client.vmessUuid), "VMess UUID");
  assertUnique(snapshot.clients.map(client => client.trojanPassword), "Trojan password");
  assertUnique(snapshot.clients.map(client => client.socksUsername), "SOCKS username");
  assertUnique(snapshot.clients.filter(client => client.shadowsocksUserKey).map(client => client.shadowsocksUserKey), "Shadowsocks user key");
  assertUnique(snapshot.clients.map(client => client.subscriptionToken), "subscription token");
  assertUnique(snapshot.clients.map(client => client.connectionToken), "connection token");
});

export const recoveryRouter = router({
  exportSnapshot: adminProcedure.query(() => exportGatewayRecoverySnapshot()),
  importSnapshot: adminProcedure.input(recoverySnapshotInput).mutation(async ({ input }) => {
    const previous = await exportGatewayRecoverySnapshot();
    try {
      const restored = await replaceGatewayRecoverySnapshot(input as GatewayRecoverySnapshot);
      await applyXrayProfile(restored);
      const closedTunnels = closeActiveGatewayTunnels();
      return { success: true as const, clientCount: input.clients.length, templateCount: input.templates.length, closedTunnels };
    } catch (error) {
      try {
        const rolledBack = await replaceGatewayRecoverySnapshot(previous);
        await applyXrayProfile(rolledBack);
      } catch (rollbackError) {
        console.error("[Recovery] Rollback failed after import error", rollbackError);
      }
      throw error;
    }
  }),
});
