import { describe, expect, it } from 'vitest';
import { toOwnedAudioArrayBuffer } from './groupCallAudioPayload';

describe('toOwnedAudioArrayBuffer', () => {
  it('returns an ArrayBuffer unchanged', () => {
    const buf = new Uint8Array([1, 2, 3]).buffer;
    expect(toOwnedAudioArrayBuffer(buf)).toBe(buf);
  });
  it('copies exactly the bytes of a view into its own buffer', () => {
    const backing = new Uint8Array([9, 9, 1, 2, 3, 9]);
    const view = new Uint8Array(backing.buffer, 2, 3);
    const out = toOwnedAudioArrayBuffer(view)!;
    expect(out).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(out)]).toEqual([1, 2, 3]);
    backing[2] = 7;
    expect(new Uint8Array(out)[0]).toBe(1);
  });
  it('handles other typed views (DataView)', () => {
    const dv = new DataView(new Uint8Array([4, 5, 6, 7]).buffer, 1, 2);
    expect([...new Uint8Array(toOwnedAudioArrayBuffer(dv)!)]).toEqual([5, 6]);
  });
  it('rejects anything else', () => {
    for (const v of [null, undefined, 'abc', 12, {}, [1, 2]]) {
      expect(toOwnedAudioArrayBuffer(v)).toBeNull();
    }
  });
});
