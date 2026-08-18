import { describe, expect, it } from "vitest";
import { createOwnerDeviceToken, isOwnerDeviceToken, observeOwnerDeviceRequest } from "./ownerDevices";

describe("owner device observation", () => {
  it("uses Cloudflare location headers and recognizes a mobile browser", () => {
    const observation = observeOwnerDeviceRequest({
      headers: {
        "cf-connecting-ip": "198.51.100.12",
        "cf-ipcountry": "de",
        "cf-ipcity": "Berlin",
        "cf-region": "Berlin",
        "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
      },
      socket: { remoteAddress: "127.0.0.1" },
    } as never);

    expect(observation).toMatchObject({
      ipAddress: "198.51.100.12",
      countryCode: "DE",
      city: "Berlin",
      region: "Berlin",
      deviceKind: "mobile",
      browser: "Safari",
      operatingSystem: "iPhone",
    });
  });

  it("creates opaque device identifiers and does not treat the Cloudflare unknown-country sentinel as a location", () => {
    const token = createOwnerDeviceToken();
    const observation = observeOwnerDeviceRequest({ headers: { "cf-ipcountry": "XX" }, socket: {} } as never);

    expect(isOwnerDeviceToken(token)).toBe(true);
    expect(observation.countryCode).toBeNull();
    expect(observation.city).toBeNull();
  });
});
