import { describe, expect, it } from "vitest";
import { parseCloudflareTraceCountry } from "./cloudflareTrace";

describe("Cloudflare trace country parser", () => {
  it("reads the same-origin trace location without touching the visitor IP", () => {
    expect(parseCloudflareTraceCountry("ip=34.34.234.69\ncolo=FRA\nloc=DE\n")).toBe("DE");
  });

  it("rejects unknown and malformed country values", () => {
    expect(parseCloudflareTraceCountry("loc=XX\n")).toBeNull();
    expect(parseCloudflareTraceCountry("loc=Berlin\n")).toBeNull();
  });
});
