import { describe, expect, it } from "vitest";
import { clientNotifications } from "./clientNotifications";

describe("client lifecycle notifications", () => {
  it("uses the concise creation and activation messages", () => {
    expect(clientNotifications).toEqual({
      created: "Client identity created",
      activated: "Client activated successfully",
    });
  });
});
