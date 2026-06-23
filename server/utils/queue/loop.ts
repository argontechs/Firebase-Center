import { runWorkerOnce } from './worker';
import { sweepStaleJobs } from './sweep';
import { sweepDueCampaigns } from './due';

export function startWorkerLoop(opts: { pollMs?: number; visibilityTimeoutMs?: number; dueMs?: number } = {}): () => void {
  const pollMs = opts.pollMs ?? 1000;
  const visibilityTimeoutMs = opts.visibilityTimeoutMs ?? 5 * 60 * 1000;
  const dueMs = opts.dueMs ?? 5000;
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

  const dueTick = async () => { if (stopped) return; try { await sweepDueCampaigns(); } catch {} if (!stopped) setTimeout(dueTick, dueMs); };

  setTimeout(tick, pollMs);
  setTimeout(sweepTick, visibilityTimeoutMs);
  setTimeout(dueTick, dueMs);
  return () => { stopped = true; };
}
