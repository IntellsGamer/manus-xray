export function parseCloudflareTraceCountry(trace: string): string | null {
  const loc = trace.split("\n").find(line => line.startsWith("loc="))?.slice(4).trim().toUpperCase();
  if (!loc || !/^[A-Z]{2}$/.test(loc) || loc === "XX" || loc === "T1") return null;
  return loc;
}
