const UNITS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Converts values like "15m", "12h" or "7d" to milliseconds. */
export function parseDurationMs(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) {
    throw new Error(
      `Invalid duration "${value}". Use formats like 30s, 15m, 12h or 7d`,
    );
  }
  return Number(match[1]) * UNITS[match[2]];
}