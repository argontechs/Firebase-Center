import { startWorkerLoop } from '../utils/queue/loop';

export default defineNitroPlugin(() => {
  // Tests drive runWorkerOnce manually; never auto-start the loop under Vitest.
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return;
  const stop = startWorkerLoop();
  if (import.meta.hot) import.meta.hot.dispose(stop); // clean up on dev HMR
});
