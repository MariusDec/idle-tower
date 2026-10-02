/**
 * Seeds in parallel (T4): a tool's per-seed job runs in worker threads, one
 * per core, so a gate can read 8 seeds in the time one took. Every job is
 * deterministic, so the order the workers finish in changes nothing.
 *
 * A tool registers its jobs by name with `workerJobs` (in the worker, the
 * bundle's own entry calls it); `parallel` posts `[name, args]` to a worker
 * running the same bundle and collects the results in order.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

type Job = (...args: never[]) => unknown;

/** True inside one of `parallel`'s workers. */
export const IN_WORKER = !isMainThread && (workerData as { tower?: boolean } | null)?.tower === true;

/** In a worker: run the named job on its args and post the result back. */
export function workerJobs(jobs: Readonly<Record<string, Job>>): void {
  if (!IN_WORKER) return;
  const { name, args } = workerData as { name: string; args: never[] };
  parentPort!.postMessage(jobs[name](...args));
}

/** Run `name` once per argument list, in workers, at most one per core; results in input order. */
export function parallel<T>(script: string, name: string, argLists: readonly unknown[][], jobs = availableParallelism()): Promise<T[]> {
  const out: T[] = new Array(argLists.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < argLists.length) {
      const i = next++;
      out[i] = await new Promise<T>((resolve, reject) => {
        const w = new Worker(script, { workerData: { tower: true, name, args: argLists[i] } });
        w.once('message', (v: T) => {
          resolve(v);
          void w.terminate();
        });
        w.once('error', reject);
      });
    }
  };
  return Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, argLists.length)) }, lane)).then(() => out);
}
