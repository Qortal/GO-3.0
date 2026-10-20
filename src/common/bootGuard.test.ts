import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_UNLOCKED_SESSION_STORAGE_KEY } from '../lib/appLock';
import { readFatalErrors } from './fatalErrorLog';

/** public/boot-guard.js runs before the bundle, as a plain script. */
const source = readFileSync(
  resolve(__dirname, '../../public/boot-guard.js'),
  'utf8'
);
const appLockSource = readFileSync(
  resolve(__dirname, '../lib/appLock.ts'),
  'utf8'
);

type GuardWindow = EventTarget & {
  __goBootDone?: () => void;
  location: { reload: ReturnType<typeof vi.fn> };
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
};

const AUTO_SELECT_KEY =
  'qortal:last-authenticated-wallet-auto-select-attempted';

let win: GuardWindow;

const runGuard = () => {
  win = Object.assign(new EventTarget(), {
    location: { reload: vi.fn() },
    setTimeout: ((fn: () => void, ms: number) =>
      setTimeout(fn, ms)) as typeof setTimeout,
    clearTimeout: ((id: ReturnType<typeof setTimeout>) =>
      clearTimeout(id)) as typeof clearTimeout,
  });
  new Function('window', source)(win);
};

const splash = () => document.getElementById('app-splash') as HTMLElement;
const restartButton = () =>
  splash().querySelector<HTMLButtonElement>('.app-splash__trouble button');

const throwDuringBoot = (message: string) => {
  const error = new Error(message);
  win.dispatchEvent(new ErrorEvent('error', { error, message }));
};

describe('boot guard (public/boot-guard.js)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    sessionStorage.clear();
    document.body.innerHTML =
      '<div id="root"></div><div id="app-splash" aria-hidden="true"></div>';
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('offers a restart when the bundle throws while it loads', () => {
    runGuard();
    throwDuringBoot('ctx is null');
    expect(restartButton()).toBeNull();
    vi.advanceTimersByTime(3000);
    expect(restartButton()?.textContent).toBe('Restart');
    expect(splash().hasAttribute('aria-hidden')).toBe(false);
    expect(readFatalErrors()[0].message).toBe('GO did not start: ctx is null');
  });

  it('stays out of the way once main.tsx reports in', () => {
    runGuard();
    throwDuringBoot('a hiccup the app got past');
    win.__goBootDone?.();
    vi.advanceTimersByTime(60_000);
    expect(restartButton()).toBeNull();
    expect(readFatalErrors()).toEqual([]);
  });

  it('offers a restart after a very long start, and notes when it made it', () => {
    runGuard();
    vi.advanceTimersByTime(24_999);
    expect(restartButton()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(restartButton()).not.toBeNull();
    expect(readFatalErrors()[0].message).toBe('GO still starting after 25 s');
    vi.advanceTimersByTime(5000);
    win.__goBootDone?.();
    expect(readFatalErrors()[0].message).toBe('GO started after 30 s');
  });

  it('notices an app script that did not load', () => {
    runGuard();
    const script = document.createElement('script');
    document.body.appendChild(script);
    // Resource errors do not bubble; the guard listens in the capture phase.
    const event = new Event('error');
    Object.defineProperty(event, 'target', { value: script });
    win.dispatchEvent(event);
    vi.advanceTimersByTime(3000);
    expect(restartButton()).not.toBeNull();
  });

  it('restarts locked: the reload never resumes the wallet', () => {
    sessionStorage.setItem(APP_UNLOCKED_SESSION_STORAGE_KEY, 'QAddress');
    sessionStorage.setItem(AUTO_SELECT_KEY, '1');
    runGuard();
    throwDuringBoot('boom');
    vi.advanceTimersByTime(3000);
    restartButton()?.click();
    expect(sessionStorage.getItem(APP_UNLOCKED_SESSION_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(AUTO_SELECT_KEY)).toBeNull();
    expect(win.location.reload).toHaveBeenCalledTimes(1);
  });

  it('speaks the saved language', () => {
    localStorage.setItem('i18nextLng', 'de');
    runGuard();
    vi.advanceTimersByTime(25_000);
    expect(restartButton()?.textContent).toBe('Neu starten');
  });

  it('keeps its storage keys in step with the app', () => {
    expect(source).toContain(`'${APP_UNLOCKED_SESSION_STORAGE_KEY}'`);
    expect(appLockSource).toContain(`'${AUTO_SELECT_KEY}'`);
    expect(source).toContain(`'${AUTO_SELECT_KEY}'`);
    expect(
      readFileSync(resolve(__dirname, './fatalErrorLog.ts'), 'utf8')
    ).toContain("'qgo:fatal-errors'");
    expect(source).toContain("'qgo:fatal-errors'");
  });
});
