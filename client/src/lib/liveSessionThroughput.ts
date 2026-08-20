export type LiveThroughputSample = {
  totalBytes: number;
  sampledAt: number;
};

export type LiveThroughputReading = {
  mbps: number;
  sampledAt: number;
};

export function measureLiveThroughput(previous: LiveThroughputSample | undefined, totalBytes: number, sampledAt: number) {
  const sample = { totalBytes: Math.max(0, totalBytes), sampledAt } satisfies LiveThroughputSample;
  if (!previous || sampledAt <= previous.sampledAt || sample.totalBytes < previous.totalBytes) {
    return { sample, reading: { mbps: 0, sampledAt } satisfies LiveThroughputReading };
  }

  const elapsedMilliseconds = sampledAt - previous.sampledAt;
  const transferredBytes = sample.totalBytes - previous.totalBytes;
  return {
    sample,
    reading: { mbps: (transferredBytes * 8) / elapsedMilliseconds / 1_000, sampledAt } satisfies LiveThroughputReading,
  };
}

export function formatLiveMbps(reading: LiveThroughputReading | undefined, now: number) {
  const mbps = !reading || now - reading.sampledAt > 4_000 ? 0 : Math.max(0, reading.mbps);
  if (mbps === 0) return "0 Mbps";
  if (mbps >= 100) return `${Math.round(mbps)} Mbps`;
  if (mbps >= 10) return `${mbps.toFixed(1)} Mbps`;
  return `${mbps.toFixed(2)} Mbps`;
}
