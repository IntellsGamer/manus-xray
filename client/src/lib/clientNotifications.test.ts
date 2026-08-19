import { describe, expect, it } from "vitest";
import { claimClientActivationNotification } from "./clientActivationNotifications";
import { clientNotifications } from "./clientNotifications";

describe("client lifecycle notifications", () => {
  it("uses the concise creation and activation messages", () => {
    expect(clientNotifications).toEqual({
      created: "Client identity created",
      activated: "Client activated successfully",
    });
  });

  it("claims each successful delayed activation notification only once", () => {
    const notifiedClientIds = new Set<number>();
    const activated = { id: 42, activated: true, activationPending: false };

    expect(claimClientActivationNotification(notifiedClientIds, activated)).toBe(true);
    expect(claimClientActivationNotification(notifiedClientIds, activated)).toBe(false);
    expect(claimClientActivationNotification(notifiedClientIds, { id: 43, activated: false, activationPending: true })).toBe(false);
    expect(claimClientActivationNotification(notifiedClientIds, { id: 44, activated: false, activationPending: false, activationFailed: true })).toBe(false);
  });
});
