/** `os` stand-in for the engine worker (resource store uses tmpdir only). */

export function tmpdir(): string {
  return '/qgo/temp';
}

export function platform(): string {
  return 'android';
}

export function cpus(): unknown[] {
  const count =
    typeof navigator !== 'undefined' && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 4;
  return new Array(count).fill({ model: 'mobile', speed: 0 });
}

export default { tmpdir, platform, cpus };
