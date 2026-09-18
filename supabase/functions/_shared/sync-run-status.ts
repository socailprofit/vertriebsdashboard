// Operational status only: never replay data commits or KPI calculations.
export const ABANDONED_SYNC_AFTER_MS = 10 * 60_000;
type StatusError = { code?: string; message?: string } | null;
export async function writeSyncStatus(
  write: (signal: AbortSignal) => PromiseLike<{ error: StatusError }>,
  options: { timeoutMs?: number; sleep?: (ms: number) => Promise<void> } = {},
) {
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  for (let attempt = 0; ; attempt++) {
    const signal = AbortSignal.timeout(options.timeoutMs ?? 3000);
    try {
      const result = await write(signal);
      const error = result.error;
      const transient = signal.aborted || error && (
        ["57014", "40001", "40P01", "PGRST003"].includes(error.code ?? "") ||
        error.code === "PGRST303" && /^JWT issued at future\.?$/.test(error.message ?? "") ||
        !error.code && /fetch|network|timeout|abort/i.test(error.message ?? ""));
      if (!error || !transient || attempt >= 1) return result;
    } catch (error) {
      if ((!signal.aborted && !(error instanceof TypeError)) || attempt >= 1) throw error;
    }
    await sleep(300);
  }
}
