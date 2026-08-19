export type ClientRegistryView = "detailed" | "compact";

const CLIENT_REGISTRY_VIEW_KEY = "nginx-gateway-client-registry-view";

function viewStorage() {
  if (typeof localStorage === "undefined") return undefined;
  return localStorage;
}

export function readClientRegistryView(): ClientRegistryView {
  try {
    return viewStorage()?.getItem(CLIENT_REGISTRY_VIEW_KEY) === "compact" ? "compact" : "detailed";
  } catch {
    return "detailed";
  }
}

export function saveClientRegistryView(view: ClientRegistryView) {
  try {
    viewStorage()?.setItem(CLIENT_REGISTRY_VIEW_KEY, view);
  } catch {}
}
