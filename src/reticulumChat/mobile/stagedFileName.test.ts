import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildStagedResourcePath,
  cleanStagedFileName,
  newStagingId,
} from './stagedFileName';

/**
 * The fixture ChatResourceStagingPolicyTest (JVM) checks Kotlin against:
 * `input <TAB> expected`, with \uXXXX and \\ escapes.
 */
function loadSharedCases(): Array<[string, string]> {
  const text = readFileSync(
    resolve(
      __dirname,
      '../../../android/app/src/test/resources/chat-resource-staged-names.tsv'
    ),
    'utf8'
  );
  const unescape = (s: string) =>
    s.replace(/\\u([0-9A-Fa-f]{4})|\\\\/g, (match, hex: string | undefined) =>
      hex ? String.fromCharCode(parseInt(hex, 16)) : '\\'
    );
  return text
    .split('\n')
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => {
      const tab = line.indexOf('\t');
      return [unescape(line.slice(0, tab)), unescape(line.slice(tab + 1))];
    });
}

describe('staged resource file names', () => {
  const cases = loadSharedCases();

  it('reads the shared fixture', () => {
    expect(cases.length).toBeGreaterThanOrEqual(30);
  });

  it('cleans every name exactly like Kotlin (shared fixture)', () => {
    const mismatches = cases
      .map(([input, expected]) => ({
        input,
        expected,
        actual: cleanStagedFileName(input),
      }))
      .filter((c) => c.actual !== c.expected);
    expect(mismatches).toEqual([]);
  });

  it('builds <folder>/<uuid>-<name> with one path component per name', () => {
    const dir =
      '/data/user/0/com.github.Qortal.qortalGo2/cache/reticulum-chat-resources';
    const id = '0b5e4a8e-3c55-4f0f-9d43-6f1f0f7a2b11';
    for (const [input, expected] of cases) {
      const path = buildStagedResourcePath(dir, input, id);
      expect(path).toBe(`${dir}/${id}-${expected}`);
      // Never a separator, so Kotlin's "directly in the folder" check holds.
      expect(path.slice(dir.length + 1)).not.toContain('/');
    }
    // A trailing slash on the folder does not double up.
    expect(buildStagedResourcePath(`${dir}/`, 'x.recv', id)).toBe(
      `${dir}/${id}-x.recv`
    );
  });

  it('makes a fresh lower-case UUID per path', () => {
    const a = newStagingId();
    const b = newStagingId();
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(a).not.toBe(b);
  });
});
