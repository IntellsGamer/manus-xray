import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, VlessProfile, vlessProfiles, users } from "../drizzle/schema";
import { ENV } from './_core/env';
import { createSubscriptionToken, createVlessUuid, normaliseWsPath } from "./vless";

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
  if (existing) return existing;

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
