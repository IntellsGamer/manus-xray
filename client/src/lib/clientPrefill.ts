export type ClientDraftPrefill = { name: string; source: "device" };

const CLIENT_DRAFT_PREFILL_KEY = "nginx-gateway-client-draft-prefill";

function draftStorage() {
  if (typeof sessionStorage === "undefined") return undefined;
  return sessionStorage;
}

export function saveClientDraftPrefill(prefill: ClientDraftPrefill) {
  draftStorage()?.setItem(CLIENT_DRAFT_PREFILL_KEY, JSON.stringify(prefill));
}

export function takeClientDraftPrefill(): ClientDraftPrefill | undefined {
  const storage = draftStorage();
  const raw = storage?.getItem(CLIENT_DRAFT_PREFILL_KEY);
  if (!raw) return undefined;
  storage?.removeItem(CLIENT_DRAFT_PREFILL_KEY);
  try {
    const parsed = JSON.parse(raw) as Partial<ClientDraftPrefill>;
    if (parsed.source !== "device" || typeof parsed.name !== "string" || !parsed.name.trim()) return undefined;
    return { source: "device", name: parsed.name.trim().slice(0, 120) };
  } catch {
    return undefined;
  }
}
