import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { GatewayClient, InsertUser, gatewayClients, subscriptionEvents, VlessProfile, vlessProfiles, users } from "../drizzle/schema";
import { ENV } from './_core/env';
import { createGatewayCredential, createSubscriptionToken, createVlessUuid, normaliseGatewayPaths, normaliseWsPath } from "./vless";

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
    };
    const needsBackfill = !existing.vmessUuid || !existing.trojanPassword || !existing.socksUsername || !existing.socksPassword;
    if (!needsBackfill) return existing;

    const db = await getDb();
    if (!db) throw new Error("Database is unavailable");
    await db.update(vlessProfiles).set(missingProtocolCredentials).where(eq(vlessProfiles.id, 1));
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

export async function updateGatewayPathsAndGlobalProfile(changes: Pick<VlessProfile, "wsPath" | "vmessWsPath" | "trojanWsPath" | "socksWsPath" | "globalProfileEnabled">) {
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

export async function regenerateGatewayProtocolCredential(protocol: "vmess" | "trojan" | "socks") {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");

  const changes = protocol === "vmess"
    ? { vmessUuid: createVlessUuid() }
    : protocol === "trojan"
      ? { trojanPassword: createGatewayCredential() }
      : { socksPassword: createGatewayCredential() };
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

export async function createGatewayClient(input: { name: string; trafficLimitBytes?: number; dayLimit?: number }): Promise<GatewayClient> {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const dayLimit = input.dayLimit ?? 0;
  const result = await db.insert(gatewayClients).values({
    name: input.name.trim(),
    enabled: true,
    vlessUuid: createVlessUuid(),
    vmessUuid: createVlessUuid(),
    trojanPassword: createGatewayCredential(),
    socksUsername: clientSocksUsername(),
    socksPassword: createGatewayCredential(),
    subscriptionToken: createSubscriptionToken(),
    trafficLimitBytes: input.trafficLimitBytes ?? 0,
    dayLimit,
    expiresAt: dayLimit > 0 ? new Date(Date.now() + dayLimit * 86_400_000) : null,
  });
  const created = await getGatewayClientById(Number(result[0].insertId));
  if (!created) throw new Error("Failed to create gateway client");
  return created;
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

export async function updateGatewayClientPolicy(id: number, input: { trafficLimitBytes: number; dayLimit: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  await db.update(gatewayClients).set({
    trafficLimitBytes: input.trafficLimitBytes,
    dayLimit: input.dayLimit,
    expiresAt: input.dayLimit > 0 ? new Date(Date.now() + input.dayLimit * 86_400_000) : null,
  }).where(eq(gatewayClients.id, id));
  const client = await getGatewayClientById(id);
  if (!client) throw new Error("Gateway client was not found");
  return client;
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
