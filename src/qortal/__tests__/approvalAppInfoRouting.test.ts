import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// GO-28: the approval dialog names the asking app from the `appInfo` the
// router passes to the get.ts handler. A handler call that leaves it out
// shows "Unknown Q-App" on a real Q-App's request, which teaches users to
// ignore the warning. This walks the router source and fails on any call to
// a get.ts export that takes `appInfo` but is not given it.

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

/** The text between the parenthesis at `openIndex` and its partner. */
function enclosed(source: string, openIndex: number): string | null {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, i);
    }
  }
  return null;
}

/** Splits an argument or parameter list at its top-level commas. */
function topLevelParts(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i += 1) {
    const char = list[i];
    if ('([{'.includes(char)) depth += 1;
    else if (')]}'.includes(char)) depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(list.slice(start, i));
      start = i + 1;
    }
  }
  const last = list.slice(start);
  if (last.trim()) parts.push(last);
  return parts;
}

const APP_INFO = /\bappInfo\b/;

/**
 * Exports of `source` that take `appInfo`: the position of a plain
 * `appInfo` parameter, or -1 when it sits inside a destructured object.
 */
function exportsTakingAppInfo(source: string): Map<string, number> {
  const found = new Map<string, number>();
  const definition =
    /export\s+(?:const\s+(\w+)\s*=\s*(?:async\s*)?\(|async\s+function\s+(\w+)\s*\(|function\s+(\w+)\s*\()/g;
  let match: RegExpExecArray | null;
  while ((match = definition.exec(source))) {
    const name = match[1] || match[2] || match[3];
    const params = enclosed(source, match.index + match[0].length - 1);
    if (!params || !APP_INFO.test(params)) continue;
    const position = topLevelParts(params).findIndex(
      (param) => param.split(/[?:=]/)[0].trim() === 'appInfo'
    );
    found.set(name, position);
  }
  return found;
}

/** Calls in `source` to `names` that do not pass appInfo where it belongs. */
function callsMissingAppInfo(
  source: string,
  names: Map<string, number>,
  skipBefore = 0
): string[] {
  const missing: string[] = [];
  names.forEach((position, name) => {
    const call = new RegExp(`(?<![\\w.])${name}\\s*\\(`, 'g');
    let match: RegExpExecArray | null;
    while ((match = call.exec(source))) {
      if (match.index < skipBefore) continue;
      const args = enclosed(source, match.index + match[0].length - 1) ?? '';
      const passed =
        position >= 0
          ? APP_INFO.test(topLevelParts(args)[position] ?? '')
          : APP_INFO.test(args);
      if (!passed) {
        const line = source.slice(0, match.index).split('\n').length;
        missing.push(`${name} (line ${line})`);
      }
    }
  });
  return missing;
}

describe('the checker itself', () => {
  const handlers = `
    export const sendCoin = async (data, isFromExtension, appInfo?) => {};
    export const signForeignFees = async (data, appInfo, isFromExtension) => {};
    export const getUserAccount = async ({ isFromExtension, appInfo }) => {};
    export const getNodeInfo = async (data) => {};
  `;

  it('finds the exports that take appInfo, and where', () => {
    expect(exportsTakingAppInfo(handlers)).toEqual(
      new Map([
        ['sendCoin', 2],
        ['signForeignFees', 1],
        ['getUserAccount', -1],
      ])
    );
  });

  it('flags calls without appInfo, or with it in the wrong place', () => {
    const router = `
      await sendCoin(request.payload, isFromExtension, appInfo);
      await sendCoin(request.payload, isFromExtension);
      await sendCoin(request.payload, appInfo, isFromExtension);
      await signForeignFees(request.payload, appInfo, isFromExtension);
      await getUserAccount({ isFromExtension, appInfo });
      await getUserAccount({ isFromExtension });
      await getNodeInfo(request.payload);
    `;
    expect(callsMissingAppInfo(router, exportsTakingAppInfo(handlers))).toEqual(
      ['sendCoin (line 3)', 'sendCoin (line 4)', 'getUserAccount (line 7)']
    );
  });
});

describe('Q-App requests reach the dialog with their app (GO-28)', () => {
  const get = read('../get.ts');

  it('every router call to a get.ts handler passes appInfo', () => {
    const router = read('../qortal-requests.ts');
    const importBlock = router.match(
      /import\s*\{([^}]*)\}\s*from\s*'\.\/get(?:\.ts)?';/
    );
    expect(importBlock).not.toBeNull();
    const imported = new Set(
      importBlock![1]
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
    );
    const handlers = new Map(
      [...exportsTakingAppInfo(get)].filter(([name]) => imported.has(name))
    );
    // Sanity: the walk sees the handlers it is meant to check.
    expect(handlers.has('sendCoin')).toBe(true);
    expect(handlers.size).toBeGreaterThan(40);

    expect(
      callsMissingAppInfo(
        router,
        handlers,
        importBlock!.index! + importBlock![0].length
      )
    ).toEqual([]);
  });

  it('SAVE_FILE passes appInfo (through its options)', () => {
    const listener = read('../../hooks/useQortalMessageListener.tsx');
    const saveFileCalls = callsMissingAppInfo(
      listener,
      new Map([['saveFile', -1]])
    );
    expect(listener).toMatch(/(?<![\w.])saveFile\s*\(/);
    expect(saveFileCalls).toEqual([]);
  });
});
