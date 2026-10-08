import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from 'react';

/**
 * Render timing for measurement builds only (`VITE_GO_PERF=1`, which also
 * switches React to its profiling build): each wrapped subtree's commits go
 * to `window.__goPerf` for reading over the debugger. Ordinary builds render
 * the children as they are, with no Profiler at all.
 */
const enabled = import.meta.env.VITE_GO_PERF === '1';

type PerfEntry = [
  id: string,
  phase: string,
  actualMs: number,
  baseMs: number,
  startMs: number,
  commitMs: number,
];

const record: ProfilerOnRenderCallback = (
  id,
  phase,
  actualDuration,
  baseDuration,
  startTime,
  commitTime
) => {
  const w = window as unknown as { __goPerf?: PerfEntry[] };
  const log = (w.__goPerf ??= []);
  log.push([
    id,
    phase,
    Math.round(actualDuration * 10) / 10,
    Math.round(baseDuration * 10) / 10,
    Math.round(startTime),
    Math.round(commitTime),
  ]);
  if (log.length > 4000) log.splice(0, log.length - 4000);
};

export function PerfProfiler({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <Profiler id={id} onRender={record}>
      {children}
    </Profiler>
  );
}
