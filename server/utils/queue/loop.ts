import { runWorkerOnce } from './worker';
import { sweepStaleJobs } from './sweep';

export function startWorkerLoop(opts: { pollMs?: number; visibilityTimeoutMs?: number } = {}): () => void {
  const pollMs = opts.pollMs ?? 1000;
  const visibilityTimeoutMs = opts.visibilityTimeoutMs ?? 5 * 60 * 1000;
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      // Drain whatever is due, then idle for pollMs.
      let processed = true;
      while (processed && !stopped) processed = await runWorkerOnce();
    } catch { /* logged inside worker; keep looping */ }
    if (!stopped) setTimeout(tick, pollMs);
  };

  const sweepTick = async () => {
    if (stopped) return;
    try { await sweepStaleJobs(visibilityTimeoutMs); } catch { /* keep looping */ }
    if (!stopped) setTimeout(sweepTick, visibilityTimeoutMs);
  };

  setTimeout(tick, pollMs);
  setTimeout(sweepTick, visibilityTimeoutMs);
  return () => { stopped = true; };
}
