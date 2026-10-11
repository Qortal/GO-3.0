import { afterEach, describe, expect, it } from 'vitest';
import {
  APP_ERROR_MESSAGE_MAX,
  APP_ERROR_RING_MAX,
  clearAppErrorsForTests,
  collectAppErrorDiagnostics,
  componentNames,
  formatAppErrorLines,
  getRecentAppErrors,
  noteAppErrorHealed,
  recordAppError,
  scrubAppErrorText,
  stackFrames,
  type AppErrorEntry,
} from './appErrorRing';

const CHROME_STACK = [
  "TypeError: Cannot read properties of null (reading '👍')",
  '    at MessageItemComponent (https://localhost/assets/MessageItem-Bx12abCD.js:345:24)',
  '    at Object.react_stack_bottom_frame (https://localhost/assets/vendor-9kLmQz1A.js:1:9999)',
  '    at renderWithHooks (https://localhost/assets/vendor-9kLmQz1A.js:2:100)',
  '    at https://localhost/assets/index-AAAABBBB.js:4:5',
].join('\n');

const typeError = (message = 'x', stack = CHROME_STACK) => {
  const error = new TypeError(message);
  error.stack = stack;
  return error;
};

afterEach(() => {
  clearAppErrorsForTests();
  localStorage.clear();
});

describe('scrubAppErrorText', () => {
  it('keeps short quoted tokens and drops quoted content', () => {
    expect(
      scrubAppErrorText("Cannot read properties of null (reading '👍')")
    ).toBe("Cannot read properties of null (reading '👍')");
    expect(
      scrubAppErrorText(
        'Unexpected token \'h\', "hello worl"... is not valid JSON'
      )
    ).toBe('Unexpected token \'h\', "…"... is not valid JSON');
    expect(
      scrubAppErrorText("A message 'with a long quoted sentence' here")
    ).toBe("A message '…' here");
    expect(scrubAppErrorText('a `template ${x}` b')).toBe('a `…` b');
  });

  it('redacts URLs and API keys', () => {
    expect(
      scrubAppErrorText('Failed to fetch https://node.example.com/x?apiKey=abc')
    ).toBe('Failed to fetch <url>');
    expect(scrubAppErrorText('bad apiKey=abc123 here')).not.toContain('abc123');
  });

  it('caps the length at 160 characters', () => {
    const out = scrubAppErrorText('x'.repeat(400));
    expect(Array.from(out).length).toBeLessThanOrEqual(APP_ERROR_MESSAGE_MAX);
    expect(out.endsWith('…')).toBe(true);
  });

  it('copes with non-strings', () => {
    expect(scrubAppErrorText(null)).toBe('');
    expect(scrubAppErrorText(undefined)).toBe('');
    expect(scrubAppErrorText(42)).toBe('42');
  });
});

describe('stackFrames and componentNames', () => {
  it('keeps only bundle file:line:col frames, at most 3', () => {
    const frames = stackFrames(CHROME_STACK);
    expect(frames).toEqual([
      'MessageItemComponent@MessageItem-Bx12abCD.js:345:24',
      'Object.react_stack_bottom_frame@vendor-9kLmQz1A.js:1:9999',
      'renderWithHooks@vendor-9kLmQz1A.js:2:100',
    ]);
    expect(frames.join(' ')).not.toContain('https://');
    expect(stackFrames(CHROME_STACK, 10)).toContain('index-AAAABBBB.js:4:5');
  });

  it('reads Gecko stacks and ignores non-strings', () => {
    expect(
      stackFrames('render@https://localhost/assets/App-AbCdEf12.js:10:20')
    ).toEqual(['render@App-AbCdEf12.js:10:20']);
    expect(stackFrames(undefined)).toEqual([]);
    expect(stackFrames({})).toEqual([]);
  });

  it('lists component names, with frames when the line has one', () => {
    expect(
      componentNames(
        [
          '',
          '    at MessageItemComponent (https://localhost/assets/a.js:1:2)',
          '    at div',
          '    at Box (x)',
          '    at ChatList (y)',
          '    at Extra',
        ].join('\n')
      )
    ).toEqual(['MessageItemComponent@a.js:1:2', 'div', 'Box', 'ChatList']);
    expect(componentNames(null)).toEqual([]);
  });
});

describe('recordAppError', () => {
  it('folds repeats of the same fault into one entry', () => {
    recordAppError({ kind: 'caught', error: typeError(), boundary: 'b' }, 1000);
    recordAppError({ kind: 'caught', error: typeError(), boundary: 'b' }, 2000);
    const entries = getRecentAppErrors();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      count: 2,
      firstAt: 1000,
      lastAt: 2000,
      kind: 'caught',
      boundary: 'b',
      name: 'TypeError',
      message: 'x',
    });
  });

  it('keeps faults from different boundaries apart', () => {
    recordAppError({ kind: 'caught', error: typeError(), boundary: 'a' });
    recordAppError({ kind: 'caught', error: typeError(), boundary: 'b' });
    expect(getRecentAppErrors()).toHaveLength(2);
  });

  it('merges the boundary report of the same catch into the root report', () => {
    const error = typeError();
    recordAppError({
      kind: 'caught',
      error,
      componentStack: '\n    at Row',
    });
    recordAppError({
      kind: 'caught',
      error,
      boundary: 'chat-row',
      shape: 's',
    });
    const entries = getRecentAppErrors();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      count: 1,
      boundary: 'chat-row',
      shape: 's',
      components: ['Row'],
    });
  });

  it('counts the same error object again after the merge slot is used', () => {
    const error = typeError();
    recordAppError({ kind: 'caught', error });
    recordAppError({ kind: 'caught', error, boundary: 'x' });
    recordAppError({ kind: 'caught', error, boundary: 'x' });
    expect(getRecentAppErrors()).toHaveLength(1);
    expect(getRecentAppErrors()[0].count).toBe(2);
  });

  it('notes a heal exactly once, and ignores unknown errors', () => {
    const error = typeError();
    recordAppError({ kind: 'caught', error, boundary: 'b' });
    noteAppErrorHealed(error);
    noteAppErrorHealed(error);
    noteAppErrorHealed(new Error('unknown'));
    noteAppErrorHealed(null);
    noteAppErrorHealed('text');
    expect(getRecentAppErrors()[0].healed).toBe(1);
  });

  it('keeps the newest 20 entries', () => {
    for (let i = 0; i < 25; i += 1) {
      recordAppError({ kind: 'caught', error: new Error(`e${i}`) });
    }
    const messages = getRecentAppErrors().map((entry) => entry.message);
    expect(messages).toHaveLength(APP_ERROR_RING_MAX);
    expect(messages[0]).toBe('e5');
    expect(messages).not.toContain('e4');
    expect(messages[19]).toBe('e24');
  });

  it('records non-Error throws', () => {
    recordAppError({ kind: 'recovered', error: 'plain text' });
    recordAppError({ kind: 'recovered', error: null });
    const entries = getRecentAppErrors();
    expect(entries[0]).toMatchObject({
      name: 'thrown string',
      message: 'plain text',
    });
    expect(entries[1]).toMatchObject({ name: 'thrown object' });
  });

  it('never throws on a hostile error object', () => {
    const hostile = {};
    Object.defineProperty(hostile, 'message', {
      get() {
        throw new Error('nope');
      },
    });
    expect(() =>
      recordAppError({ kind: 'caught', error: hostile })
    ).not.toThrow();
    expect(getRecentAppErrors()).toHaveLength(0);
  });

  it('hands out copies', () => {
    recordAppError({ kind: 'caught', error: typeError() });
    const copy = getRecentAppErrors();
    copy[0].frames.push('extra');
    copy[0].count = 99;
    expect(getRecentAppErrors()[0].frames).toHaveLength(3);
    expect(getRecentAppErrors()[0].count).toBe(1);
  });
});

describe('formatAppErrorLines', () => {
  it('prints none on a healthy session', () => {
    expect(formatAppErrorLines(null)).toEqual([
      'This session: none',
      'Saved crash log: none',
    ]);
  });

  it('does not throw on garbage crash records', () => {
    expect(() =>
      formatAppErrorLines({ recent: [], fatal: [null, 'x', {}] as never })
    ).not.toThrow();
    expect(
      formatAppErrorLines({ recent: [null] as never, fatal: null as never })
    ).toEqual(['This session: none', 'Saved crash log: none']);
  });

  it('prints entries and the saved crash log without URLs or quoted text', () => {
    const entry: AppErrorEntry = {
      firstAt: Date.UTC(2026, 9, 11, 10, 0, 0),
      lastAt: Date.UTC(2026, 9, 11, 10, 1, 0),
      count: 3,
      healed: 1,
      kind: 'caught',
      boundary: 'chat-row',
      name: 'TypeError',
      message: "Cannot read properties of null (reading 'map')",
      frames: ['MessageItemComponent@MessageItem-Bx12abCD.js:345:24'],
      components: ['MessageItemComponent', 'ErrorBoundary'],
      shape: 'surface:group last:yes fromEnd:0',
    };
    const lines = formatAppErrorLines({
      recent: [entry],
      fatal: [
        {
          at: '2026-10-10T10:00:00.000Z',
          kind: 'unhandledrejection',
          message: 'boom "secret text" https://node.example.com/x',
          stack: CHROME_STACK,
        },
      ],
    });
    expect(lines).toEqual([
      'This session, newest last:',
      "2026-10-11T10:00:00.000Z caught in chat-row, 3x until 2026-10-11T10:01:00.000Z, healed 1x: TypeError: Cannot read properties of null (reading 'map')",
      '  at MessageItemComponent@MessageItem-Bx12abCD.js:345:24',
      '  components: MessageItemComponent < ErrorBoundary',
      '  row: surface:group last:yes fromEnd:0',
      'Saved crash log (kept across restarts), newest first:',
      '2026-10-10T10:00:00.000Z unhandledrejection: boom "…" <url>',
      '  at MessageItemComponent@MessageItem-Bx12abCD.js:345:24 < Object.react_stack_bottom_frame@vendor-9kLmQz1A.js:1:9999 < renderWithHooks@vendor-9kLmQz1A.js:2:100',
    ]);
    const text = lines.join('\n');
    expect(text).not.toContain('https://');
    expect(text).not.toContain('secret text');
  });

  it('omits the boundary when there is none', () => {
    recordAppError(
      { kind: 'recovered', error: new Error('once') },
      Date.UTC(2026, 9, 11)
    );
    const lines = formatAppErrorLines(collectAppErrorDiagnostics());
    expect(lines[1]).toBe('2026-10-11T00:00:00.000Z recovered: Error: once');
  });
});

describe('collectAppErrorDiagnostics', () => {
  it('adds the saved crash log', () => {
    localStorage.setItem(
      'qgo:fatal-errors',
      JSON.stringify([{ at: 'a', kind: 'render', message: 'm' }])
    );
    recordAppError({ kind: 'caught', error: new Error('e') });
    const diag = collectAppErrorDiagnostics();
    expect(diag.recent).toHaveLength(1);
    expect(diag.fatal).toEqual([{ at: 'a', kind: 'render', message: 'm' }]);
  });
});
