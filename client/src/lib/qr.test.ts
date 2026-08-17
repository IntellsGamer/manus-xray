import { describe, expect, it } from "vitest";
import { buildQrDataUrl } from "./qr";

describe("QR import data", () => {
  it("creates a PNG data URI for a protocol import payload", async () => {
    const dataUrl = await buildQrDataUrl("vless://test-user@gateway.example.com:443?security=tls&type=ws&path=%2Fvless");
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });
});
