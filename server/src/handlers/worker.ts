import type { ScheduledHandler } from 'aws-lambda';

import { runAllTasks } from '@/worker/tasks';

/**
 * Worker Lambda entrypoint, invoked by EventBridge Scheduler.
 *
 * Every task reports independently and a failure in one does not abort the others, so a
 * transient problem escalating wakes cannot also stop message retention from running.
 * The report is logged as one structured line for CloudWatch.
 */
export const handler: ScheduledHandler = async () => {
  const started = Date.now();
  const report = await runAllTasks();
  console.log('[worker] run complete', { durationMs: Date.now() - started, ...report });
};
