import { describe, expect, it } from "vitest";
import { clientActivationState, clientDeleteDialogCopy, clientQuotaProgress, clientResetUsageDialogCopy, nextExpandedCompactClientId } from "./ClientRegistry";

describe("client activation state presentation", () => {
  it("shows a disabled Activating control while a new client is waiting for activation", () => {
    expect(clientActivationState({ enabled: false, activationPending: true, activationFailed: false, quotaExhaustedAt: null })).toMatchObject({ label: "Activating", action: "Activating", actionDisabled: true });
  });

  it("shows Failed with a manual Activate retry after a delayed refresh fails", () => {
    expect(clientActivationState({ enabled: false, activationPending: false, activationFailed: true, quotaExhaustedAt: null })).toMatchObject({ label: "Failed", action: "Activate", actionDisabled: false, retry: true });
  });

  it("uses explicit permanent-delete language in the styled client confirmation", () => {
    expect(clientDeleteDialogCopy("Example client")).toEqual({
      title: "Permanently delete Example client?",
      description: "This removes the client identity, all protocol credentials, its subscription token, and recorded delivery history. This cannot be undone.",
      action: "Delete permanently",
    });
  });

  it("uses an explicit non-destructive reset confirmation that preserves access and policies", () => {
    expect(clientResetUsageDialogCopy("Example client")).toEqual({
      title: "Reset usage for Example client?",
      description: "This sets the recorded data usage to 0 and establishes a fresh accounting baseline. Credentials, subscription access, and every policy limit remain unchanged.",
      action: "Reset usage",
    });
  });

  it("maps finite quota usage to a compact remaining-capacity bar without overflow", () => {
    expect(clientQuotaProgress(100, 25)).toMatchObject({ remainingBytes: 75, remainingPercent: 75, usedPercent: 25, toneClass: "bg-primary" });
    expect(clientQuotaProgress(100, 95)).toMatchObject({ remainingPercent: 5, usedPercent: 95, toneClass: "bg-destructive" });
    expect(clientQuotaProgress(100, 120)).toMatchObject({ remainingBytes: 0, remainingPercent: 0, usedPercent: 100 });
    expect(clientQuotaProgress(-1, 500)).toBeNull();
  });

  it("allows only one compact client card to be expanded at a time", () => {
    expect(nextExpandedCompactClientId(null, 7)).toBe(7);
    expect(nextExpandedCompactClientId(7, 8)).toBe(8);
    expect(nextExpandedCompactClientId(8, 8)).toBeNull();
  });
});
