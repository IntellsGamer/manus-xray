import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { ClientPolicyTemplate, clientPolicyTemplates, GatewayClient, InsertUser, ownerDevices, OwnerDevice, gatewayClients, subscriptionEvents, terminalLeases, VlessProfile, vlessProfiles, users } from "../drizzle/schema";
import type { OwnerDeviceObservation } from "./ownerDevices";
import { ENV } from './_core/env';
import { createGatewayCredential, createShadowsocks2022Key, createSubscriptionToken, createVlessUuid, normaliseGatewayPaths, normaliseWsPath } from "./vless";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getOwnerDeviceByToken(ownerOpenId: string, deviceToken: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const result = await db.select().from(ownerDevices).where(and(eq(ownerDevices.ownerOpenId, ownerOpenId), eq(ownerDevices.deviceToken, deviceToken))).limit(1);
  return result[0];
}

export async function observeOwnerDevice(ownerOpenId: string, deviceToken: string, observation: OwnerDeviceObservation) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const now = new Date();
  await db.insert(ownerDevices).values({ ownerOpenId, deviceToken, ...observation, firstSeenAt: now, lastSeenAt: now, revokedAt: null }).onDuplicateKeyUpdate({
    set: { ...observation, lastSeenAt: now, revokedAt: null },
  });
  return getOwnerDeviceByToken(ownerOpenId, deviceToken);
}

export async function listOwnerDevices(ownerOpenId: string): Promise<OwnerDevice[]> {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db.select().from(ownerDevices).where(and(eq(ownerDevices.ownerOpenId, ownerOpenId), isNull(ownerDevices.revokedAt))).orderBy(desc(ownerDevices.lastSeenAt));
}

export async function updateOwnerDeviceCountry(ownerOpenId: string, deviceToken: string, countryCode: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.update(ownerDevices).set({ countryCode }).where(and(eq(ownerDevices.ownerOpenId, ownerOpenId), eq(ownerDevices.deviceToken, deviceToken), isNull(ownerDevices.revokedAt)));
}

export async function revokeOwnerDevice(ownerOpenId: string, id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.update(ownerDevices).set({ revokedAt: new Date() }).where(and(eq(ownerDevices.ownerOpenId, ownerOpenId), eq(ownerDevices.id, id), isNull(ownerDevices.revokedAt)));
}

export async function revokeAllOwnerDevices(ownerOpenId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.update(ownerDevices).set({ revokedAt: new Date() }).where(and(eq(ownerDevices.ownerOpenId, ownerOpenId), isNull(ownerDevices.revokedAt)));
}

export async function acquireTerminalLease(input: {
  leaseId: string;
  ownerOpenId: string;
  instanceId: string;
  expiresAt: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");

  await db.execute(sql`
    INSERT INTO terminal_leases (slot, leaseId, ownerOpenId, instanceId, expiresAt)
    VALUES ('owner-terminal', ${input.leaseId}, ${input.ownerOpenId}, ${input.instanceId}, ${input.expiresAt})
    ON DUPLICATE KEY UPDATE
      leaseId = IF(expiresAt < NOW(), VALUES(leaseId), leaseId),
      ownerOpenId = IF(expiresAt < NOW(), VALUES(ownerOpenId), ownerOpenId),
      instanceId = IF(expiresAt < NOW(), VALUES(instanceId), instanceId),
      expiresAt = IF(expiresAt < NOW(), VALUES(expiresAt), expiresAt)
  `);

  const lease = await db.select({ leaseId: terminalLeases.leaseId })
    .from(terminalLeases)
    .where(eq(terminalLeases.slot, "owner-terminal"))
    .limit(1);
  return lease[0]?.leaseId === input.leaseId;
}

export async function releaseTerminalLease(leaseId: string, instanceId: string) {
  const db = await getDb();
  if (!db) return;
  await db.delete(terminalLeases).where(and(
    eq(terminalLeases.slot, "owner-terminal"),
    eq(terminalLeases.leaseId, leaseId),
    eq(terminalLeases.instanceId, instanceId),
  ));
}

export async function getVlessProfile() {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");

  const result = await db.select().from(vlessProfiles).where(eq(vlessProfiles.id, 1)).limit(1);
  return result[0];
}

export async function getVlessProfileBySubscriptionToken(subscriptionToken: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");

  const result = await db
    .select()
    .from(vlessProfiles)
    .where(eq(vlessProfiles.subscriptionToken, subscriptionToken))
    .limit(1);
  return result[0];
}

export async function ensureVlessProfile(defaultServerAddress: string): Promise<VlessProfile> {
  const existing = await getVlessProfile();
  if (existing) {
    const missingProtocolCredentials = {
      vmessUuid: existing.vmessUuid || createVlessUuid(),
      trojanPassword: existing.trojanPassword || createGatewayCredential(),
      socksUsername: existing.socksUsername || "gateway",
      socksPassword: existing.socksPassword || createGatewayCredential(),
      shadowsocksServerKey: existing.shadowsocksServerKey || createShadowsocks2022Key(),
      shadowsocksUserKey: existing.shadowsocksUserKey || createShadowsocks2022Key(),
    };
    const needsBackfill = !existing.vmessUuid || !existing.trojanPassword || !existing.socksUsername || !existing.socksPassword || !existing.shadowsocksServerKey || !existing.shadowsocksUserKey;
    const clients = await listGatewayClients();
    const clientsNeedingShadowsocksBackfill = clients.filter(client => !client.shadowsocksUserKey);
    if (!needsBackfill && !clientsNeedingShadowsocksBackfill.length) return existing;

    const db = await getDb();
    if (!db) throw new Error("Database is unavailable");
    if (needsBackfill) await db.update(vlessProfiles).set(missingProtocolCredentials).where(eq(vlessProfiles.id, 1));
    await Promise.all(clientsNeedingShadowsocksBackfill.map(client => db.update(gatewayClients).set({ shadowsocksUserKey: createShadowsocks2022Key() }).where(eq(gatewayClients.id, client.id))));
    const hydrated = await getVlessProfile();
    if (!hydrated) throw new Error("Failed to hydrate multi-protocol gateway profile");
    return hydrated;
  }

  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");

  const initialProfile = {
    id: 1,
    uuid: createVlessUuid(),
    serverAddress: defaultServerAddress,
    port: 443,
    wsPath: "/vless",
    tlsEnabled: true,
    subscriptionToken: createSubscriptionToken(),
    vmessUuid: createVlessUuid(),
    vmessWsPath: "/vmess",
    trojanPassword: createGatewayCredential(),
    trojanWsPath: "/trojan",
    socksUsername: "gateway",
    socksPassword: createGatewayCredential(),
    socksWsPath: "/socks",
    shadowsocksServerKey: createShadowsocks2022Key(),
    shadowsocksUserKey: createShadowsocks2022Key(),
    shadowsocksWsPath: "/shadowsocks",
  };

  try {
    await db.insert(vlessProfiles).values(initialProfile);
  } catch (error) {
    // Two initial dashboard requests may race; the fixed primary key makes the
    // winning row authoritative and safe to re-read.
    const profileAfterRace = await getVlessProfile();
    if (profileAfterRace) return profileAfterRace;
    throw error;
  }

  const created = await getVlessProfile();
  if (!created) throw new Error("Failed to create VLESS profile");
  return created;
}

export async function updateVlessProfile(
  changes: Pick<VlessProfile, "serverAddress" | "port" | "wsPath" | "tlsEnabled">
) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");

  await db
    .update(vlessProfiles)
    .set({ ...changes, wsPath: normaliseWsPath(changes.wsPath) })
    .where(eq(vlessProfiles.id, 1));

  const profile = await getVlessProfile();
  if (!profile) throw new Error("VLESS profile was not found");
  return profile;
}

export async function updateGatewayPathsAndGlobalProfile(changes: Pick<VlessProfile, "wsPath" | "vmessWsPath" | "trojanWsPath" | "socksWsPath" | "shadowsocksWsPath" | "globalProfileEnabled">) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");

  const normalized = { ...normaliseGatewayPaths(changes), globalProfileEnabled: changes.globalProfileEnabled };
  await db.update(vlessProfiles).set(normalized).where(eq(vlessProfiles.id, 1));
  const profile = await getVlessProfile();
  if (!profile) throw new Error("VLESS profile was not found");
  return profile;
}

export async function regenerateVlessUuid() {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");

  await db.update(vlessProfiles).set({ uuid: createVlessUuid() }).where(eq(vlessProfiles.id, 1));
  const profile = await getVlessProfile();
  if (!profile) throw new Error("VLESS profile was not found");
  return profile;
}

export async function regenerateSubscriptionToken() {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");

  await db
    .update(vlessProfiles)
    .set({ subscriptionToken: createSubscriptionToken() })
    .where(eq(vlessProfiles.id, 1));
  const profile = await getVlessProfile();
  if (!profile) throw new Error("VLESS profile was not found");
  return profile;
}

export async function regenerateGatewayProtocolCredential(protocol: "vmess" | "trojan" | "socks" | "shadowsocks") {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");

  const changes = protocol === "vmess"
    ? { vmessUuid: createVlessUuid() }
    : protocol === "trojan"
      ? { trojanPassword: createGatewayCredential() }
      : protocol === "socks"
        ? { socksPassword: createGatewayCredential() }
        : { shadowsocksUserKey: createShadowsocks2022Key() };
  await db.update(vlessProfiles).set(changes).where(eq(vlessProfiles.id, 1));
  const profile = await getVlessProfile();
  if (!profile) throw new Error("VLESS profile was not found");
  return profile;
}

function clientSocksUsername() {
  return `client-${createGatewayCredential().slice(0, 12)}`;
}

export async function listGatewayClients() {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db.select().from(gatewayClients).orderBy(desc(gatewayClients.createdAt));
}

export type ClientPolicyTemplateInput = {
  name: string;
  trafficLimitBytes: number;
  dayLimit: number;
  speedLimitMbps: number;
  connectionLimit: number;
};

export async function listClientPolicyTemplates(): Promise<ClientPolicyTemplate[]> {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db.select().from(clientPolicyTemplates).orderBy(desc(clientPolicyTemplates.updatedAt));
}

export async function createClientPolicyTemplate(input: ClientPolicyTemplateInput) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const result = await db.insert(clientPolicyTemplates).values({ ...input, name: input.name.trim() });
  const created = await db.select().from(clientPolicyTemplates).where(eq(clientPolicyTemplates.id, Number(result[0].insertId))).limit(1);
  if (!created[0]) throw new Error("Failed to create client policy template");
  return created[0];
}

export async function updateClientPolicyTemplate(id: number, input: ClientPolicyTemplateInput) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.update(clientPolicyTemplates).set({ ...input, name: input.name.trim() }).where(eq(clientPolicyTemplates.id, id));
  const updated = await db.select().from(clientPolicyTemplates).where(eq(clientPolicyTemplates.id, id)).limit(1);
  if (!updated[0]) throw new Error("Client policy template was not found");
  return updated[0];
}

export async function deleteClientPolicyTemplate(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.delete(clientPolicyTemplates).where(eq(clientPolicyTemplates.id, id));
}

export type GatewayRecoverySnapshot = {
  schemaVersion: 1;
  exportedAt: string;
  profile: Pick<VlessProfile, "uuid" | "serverAddress" | "port" | "wsPath" | "tlsEnabled" | "subscriptionToken" | "vmessUuid" | "vmessWsPath" | "trojanPassword" | "trojanWsPath" | "socksUsername" | "socksPassword" | "socksWsPath" | "shadowsocksServerKey" | "shadowsocksUserKey" | "shadowsocksWsPath" | "globalProfileEnabled">;
  templates: Array<Pick<ClientPolicyTemplate, "name" | "trafficLimitBytes" | "dayLimit" | "speedLimitMbps" | "connectionLimit">>;
  clients: Array<Pick<GatewayClient, "name" | "enabled" | "vlessUuid" | "vmessUuid" | "trojanPassword" | "socksUsername" | "socksPassword" | "shadowsocksUserKey" | "subscriptionToken" | "connectionToken" | "trafficLimitBytes" | "trafficUsedBytes" | "dayLimit" | "speedLimitMbps" | "connectionLimit" | "expiresAt" | "quotaExhaustedAt">>;
};

export async function exportGatewayRecoverySnapshot(): Promise<GatewayRecoverySnapshot> {
  const profile = await getVlessProfile();
  if (!profile) throw new Error("Gateway profile was not found");
  const [clients, templates] = await Promise.all([listGatewayClients(), listClientPolicyTemplates()]);
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    profile: {
      uuid: profile.uuid,
      serverAddress: profile.serverAddress,
      port: profile.port,
      wsPath: profile.wsPath,
      tlsEnabled: profile.tlsEnabled,
      subscriptionToken: profile.subscriptionToken,
      vmessUuid: profile.vmessUuid,
      vmessWsPath: profile.vmessWsPath,
      trojanPassword: profile.trojanPassword,
      trojanWsPath: profile.trojanWsPath,
      socksUsername: profile.socksUsername,
      socksPassword: profile.socksPassword,
      socksWsPath: profile.socksWsPath,
      shadowsocksServerKey: profile.shadowsocksServerKey,
      shadowsocksUserKey: profile.shadowsocksUserKey,
      shadowsocksWsPath: profile.shadowsocksWsPath,
      globalProfileEnabled: profile.globalProfileEnabled,
    },
    templates: templates.map(template => ({
      name: template.name,
      trafficLimitBytes: Number(template.trafficLimitBytes),
      dayLimit: template.dayLimit,
      speedLimitMbps: template.speedLimitMbps,
      connectionLimit: template.connectionLimit,
    })),
    clients: clients.map(client => ({
      name: client.name,
      enabled: client.enabled,
      vlessUuid: client.vlessUuid,
      vmessUuid: client.vmessUuid,
      trojanPassword: client.trojanPassword,
      socksUsername: client.socksUsername,
      socksPassword: client.socksPassword,
      shadowsocksUserKey: client.shadowsocksUserKey,
      subscriptionToken: client.subscriptionToken,
      connectionToken: client.connectionToken,
      trafficLimitBytes: Number(client.trafficLimitBytes),
      trafficUsedBytes: Number(client.trafficUsedBytes),
      dayLimit: client.dayLimit,
      speedLimitMbps: client.speedLimitMbps,
      connectionLimit: client.connectionLimit,
      expiresAt: client.expiresAt,
      quotaExhaustedAt: client.quotaExhaustedAt,
    })),
  };
}

export async function replaceGatewayRecoverySnapshot(snapshot: GatewayRecoverySnapshot) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const normalizedSnapshot: GatewayRecoverySnapshot = {
    ...snapshot,
    profile: {
      ...snapshot.profile,
      shadowsocksServerKey: snapshot.profile.shadowsocksServerKey || createShadowsocks2022Key(),
      shadowsocksUserKey: snapshot.profile.shadowsocksUserKey || createShadowsocks2022Key(),
      shadowsocksWsPath: snapshot.profile.shadowsocksWsPath || "/shadowsocks",
    },
    clients: snapshot.clients.map(client => ({ ...client, shadowsocksUserKey: client.shadowsocksUserKey || createShadowsocks2022Key() })),
  };
  await db.transaction(async tx => {
    await tx.delete(subscriptionEvents);
    await tx.delete(gatewayClients);
    await tx.delete(clientPolicyTemplates);
    await tx.delete(vlessProfiles).where(eq(vlessProfiles.id, 1));
    await tx.insert(vlessProfiles).values({ id: 1, ...normalizedSnapshot.profile });
    if (normalizedSnapshot.templates.length) await tx.insert(clientPolicyTemplates).values(normalizedSnapshot.templates);
    if (normalizedSnapshot.clients.length) {
      await tx.insert(gatewayClients).values(normalizedSnapshot.clients.map(client => ({
        ...client,
        trafficStatsSnapshotBytes: 0,
        creationRequestId: null,
        activationDueAt: null,
        activationFailedAt: null,
        lastSubscriptionAt: null,
        subscriptionDeliveryCount: 0,
      })));
    }
  });
  const restored = await getVlessProfile();
  if (!restored) throw new Error("Gateway recovery restore did not produce a profile");
  return restored;
}

export async function getGatewayClientById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const result = await db.select().from(gatewayClients).where(eq(gatewayClients.id, id)).limit(1);
  return result[0];
}

export async function getGatewayClientBySubscriptionToken(subscriptionToken: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const result = await db.select().from(gatewayClients).where(eq(gatewayClients.subscriptionToken, subscriptionToken)).limit(1);
  return result[0];
}

export async function createGatewayClient(input: { name: string; trafficLimitBytes?: number; dayLimit?: number; speedLimitMbps?: number; connectionLimit?: number; creationRequestId?: string }): Promise<GatewayClient> {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  if (input.creationRequestId) {
    const existing = await db.select().from(gatewayClients).where(eq(gatewayClients.creationRequestId, input.creationRequestId)).limit(1);
    if (existing[0]) return existing[0];
  }
  const dayLimit = input.dayLimit ?? -1;
  const speedLimitMbps = input.speedLimitMbps ?? -1;
  const connectionLimit = input.connectionLimit ?? -1;
  const activationDueAt = input.creationRequestId ? new Date(Date.now() + 12_000) : null;
  let result;
  try {
    result = await db.insert(gatewayClients).values({
      name: input.name.trim(),
      enabled: !activationDueAt,
      vlessUuid: createVlessUuid(),
      vmessUuid: createVlessUuid(),
      trojanPassword: createGatewayCredential(),
      socksUsername: clientSocksUsername(),
      socksPassword: createGatewayCredential(),
      shadowsocksUserKey: createShadowsocks2022Key(),
      subscriptionToken: createSubscriptionToken(),
      connectionToken: createGatewayCredential(),
      creationRequestId: input.creationRequestId ?? null,
      activationDueAt,
      activationFailedAt: null,
      trafficLimitBytes: input.trafficLimitBytes ?? -1,
      dayLimit,
      speedLimitMbps,
      connectionLimit,
      expiresAt: dayLimit > 0 ? new Date(Date.now() + dayLimit * 86_400_000) : null,
    });
  } catch (error) {
    if (input.creationRequestId) {
      const existing = await db.select().from(gatewayClients).where(eq(gatewayClients.creationRequestId, input.creationRequestId)).limit(1);
      if (existing[0]) return existing[0];
    }
    throw error;
  }
  const created = await getGatewayClientById(Number(result[0].insertId));
  if (!created) throw new Error("Failed to create gateway client");
  return created;
}

export async function activateGatewayClientIfDue(id: number, now = new Date(), force = false) {
  const client = await getGatewayClientById(id);
  if (!client) throw new Error("Gateway client was not found");
  if (!force && !client.activationDueAt) return { client, activated: false, activationPending: false };
  if (!force && client.activationDueAt && client.activationDueAt.getTime() > now.getTime()) return { client, activated: false, activationPending: true };

  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.update(gatewayClients).set({ enabled: true, activationDueAt: null, activationFailedAt: null }).where(eq(gatewayClients.id, id));
  const activated = await getGatewayClientById(id);
  if (!activated) throw new Error("Gateway client was not found after activation");
  return { client: activated, activated: true, activationPending: false };
}

export async function markGatewayClientActivationFailed(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.update(gatewayClients).set({ enabled: false, activationDueAt: null, activationFailedAt: new Date() }).where(eq(gatewayClients.id, id));
  const client = await getGatewayClientById(id);
  if (!client) throw new Error("Gateway client was not found after activation failure");
  return client;
}

export async function activateDueGatewayClients(now = new Date()) {
  const clients = await listGatewayClients();
  const due = clients.filter(client => client.activationDueAt && client.activationDueAt.getTime() <= now.getTime());
  const results = await Promise.all(due.map(client => activateGatewayClientIfDue(client.id, now)));
  return results.filter(result => result.activated).map(result => result.client.id);
}

export async function setGatewayClientEnabled(id: number, enabled: boolean) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.update(gatewayClients).set({ enabled }).where(eq(gatewayClients.id, id));
  const client = await getGatewayClientById(id);
  if (!client) throw new Error("Gateway client was not found");
  return client;
}

export async function rotateGatewayClientCredentials(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.update(gatewayClients).set({
    vlessUuid: createVlessUuid(),
    vmessUuid: createVlessUuid(),
    trojanPassword: createGatewayCredential(),
    socksUsername: clientSocksUsername(),
    socksPassword: createGatewayCredential(),
    shadowsocksUserKey: createShadowsocks2022Key(),
    subscriptionToken: createSubscriptionToken(),
  }).where(eq(gatewayClients.id, id));
  const client = await getGatewayClientById(id);
  if (!client) throw new Error("Gateway client was not found");
  return client;
}

export async function revokeGatewayClient(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.update(gatewayClients).set({
    enabled: false,
    vlessUuid: createVlessUuid(),
    vmessUuid: createVlessUuid(),
    trojanPassword: createGatewayCredential(),
    socksUsername: clientSocksUsername(),
    socksPassword: createGatewayCredential(),
    shadowsocksUserKey: createShadowsocks2022Key(),
    subscriptionToken: createSubscriptionToken(),
  }).where(eq(gatewayClients.id, id));
  const client = await getGatewayClientById(id);
  if (!client) throw new Error("Gateway client was not found");
  return client;
}

export async function deleteGatewayClient(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.delete(subscriptionEvents).where(eq(subscriptionEvents.clientId, id));
  await db.delete(gatewayClients).where(eq(gatewayClients.id, id));
}

export async function updateGatewayClientPolicy(id: number, input: { trafficLimitBytes: number; dayLimit: number; speedLimitMbps: number; connectionLimit: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const existing = await getGatewayClientById(id);
  if (!existing) throw new Error("Gateway client was not found");
  await db.update(gatewayClients).set({
    trafficLimitBytes: input.trafficLimitBytes,
    dayLimit: input.dayLimit,
    speedLimitMbps: input.speedLimitMbps,
    connectionLimit: input.connectionLimit,
    expiresAt: input.dayLimit > 0 ? new Date(Date.now() + input.dayLimit * 86_400_000) : null,
    quotaExhaustedAt: input.trafficLimitBytes < 0 || input.trafficLimitBytes > existing.trafficUsedBytes ? null : existing.quotaExhaustedAt,
  }).where(eq(gatewayClients.id, id));
  const client = await getGatewayClientById(id);
  if (!client) throw new Error("Gateway client was not found");
  return client;
}

/**
 * Persists deltas from Xray's monotonic per-client counters. When Xray restarts
 * its counters reset, so a smaller observed value begins a new counter epoch.
 */
export async function synchronizeGatewayClientTrafficStats(clients: GatewayClient[], counters: Map<number, number>) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  for (const client of clients) {
    const observed = Math.max(0, Math.min(Math.floor(counters.get(client.id) ?? 0), Number.MAX_SAFE_INTEGER));
    await db.update(gatewayClients).set({
      trafficUsedBytes: sql`LEAST(${gatewayClients.trafficUsedBytes} + CASE WHEN ${observed} >= ${gatewayClients.trafficStatsSnapshotBytes} THEN ${observed} - ${gatewayClients.trafficStatsSnapshotBytes} ELSE ${observed} END, ${Number.MAX_SAFE_INTEGER})`,
      trafficStatsSnapshotBytes: observed,
    }).where(eq(gatewayClients.id, client.id));
  }
  return listGatewayClients();
}

/** Atomically adds backend-observed bidirectional bridge bytes for one named client. */
export async function recordGatewayClientTunnelTraffic(id: number, observedBytes: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const delta = Math.max(0, Math.min(Math.floor(observedBytes), Number.MAX_SAFE_INTEGER));
  if (delta === 0) {
    const unchanged = await getGatewayClientById(id);
    if (!unchanged) throw new Error("Gateway client was not found");
    return unchanged;
  }
  await db.update(gatewayClients).set({
    trafficUsedBytes: sql`LEAST(${gatewayClients.trafficUsedBytes} + ${delta}, ${Number.MAX_SAFE_INTEGER})`,
  }).where(eq(gatewayClients.id, id));
  const updated = await getGatewayClientById(id);
  if (!updated) throw new Error("Gateway client was not found");
  return updated;
}

export async function resetGatewayClientTrafficUsage(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.update(gatewayClients).set({
    trafficUsedBytes: 0,
    trafficStatsSnapshotBytes: 0,
    quotaExhaustedAt: null,
  }).where(eq(gatewayClients.id, id));
  const client = await getGatewayClientById(id);
  if (!client) throw new Error("Gateway client was not found");
  return client;
}

export async function disableGatewayClientForQuota(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.update(gatewayClients).set({ enabled: false, quotaExhaustedAt: new Date() }).where(eq(gatewayClients.id, id));
  const client = await getGatewayClientById(id);
  if (!client) throw new Error("Gateway client was not found");
  return client;
}

export async function getVlessProfileByQuotaScheduleTaskUid(taskUid: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const result = await db.select().from(vlessProfiles).where(eq(vlessProfiles.quotaScheduleTaskUid, taskUid)).limit(1);
  return result[0];
}

export async function setVlessProfileQuotaScheduleTaskUid(taskUid: string | null) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.update(vlessProfiles).set({ quotaScheduleTaskUid: taskUid }).where(eq(vlessProfiles.id, 1));
}

export async function recordSubscriptionDelivery(input: { profileKind: "global" | "client"; clientId?: number; deliveryKind: "browser" | "proxy"; userAgent?: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.insert(subscriptionEvents).values({
    profileKind: input.profileKind,
    clientId: input.clientId,
    deliveryKind: input.deliveryKind,
    userAgent: input.userAgent?.slice(0, 512),
  });
  if (input.profileKind === "client" && input.clientId) {
    const client = await getGatewayClientById(input.clientId);
    if (client) {
      await db.update(gatewayClients).set({
        lastSubscriptionAt: new Date(),
        subscriptionDeliveryCount: client.subscriptionDeliveryCount + 1,
      }).where(eq(gatewayClients.id, input.clientId));
    }
  }
}

export async function listSubscriptionEventsForClient(clientId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  return db.select().from(subscriptionEvents).where(eq(subscriptionEvents.clientId, clientId)).orderBy(desc(subscriptionEvents.requestedAt)).limit(10);
}
