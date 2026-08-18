import { describe, expect, it } from "vitest";
import { clientActivationState } from "./ClientRegistry";

describe("client activation state presentation", () => {
  it("shows a disabled Activating control while a new client is waiting for activation", () => {
    expect(clientActivationState({ enabled: false, activationPending: true, activationFailed: false, quotaExhaustedAt: null })).toMatchObject({ label: "Activating", action: "Activating", actionDisabled: true });
  });

  it("shows Failed with a manual Activate retry after a delayed refresh fails", () => {
    expect(clientActivationState({ enabled: false, activationPending: false, activationFailed: true, quotaExhaustedAt: null })).toMatchObject({ label: "Failed", action: "Activate", actionDisabled: false, retry: true });
  });
});
