import { getDefaultStore } from 'jotai';
import { afterEach, describe, expect, it } from 'vitest';
import { p2pHealthAtom } from '../../../atoms/global';
import { isCallNetworkWarmingUp } from './callHints';

afterEach(() => {
  getDefaultStore().set(p2pHealthAtom, 'unknown');
});

describe('isCallNetworkWarmingUp', () => {
  it('only while peers receive but are not steady yet (or no reading)', () => {
    const store = getDefaultStore();
    store.set(p2pHealthAtom, 'unknown');
    expect(isCallNetworkWarmingUp()).toBe(true);
    store.set(p2pHealthAtom, 'low');
    expect(isCallNetworkWarmingUp()).toBe(true);
    // No receiving peers at all: the Hub's "connect more peers" reason.
    store.set(p2pHealthAtom, 'bad');
    expect(isCallNetworkWarmingUp()).toBe(false);
    store.set(p2pHealthAtom, 'good');
    expect(isCallNetworkWarmingUp()).toBe(false);
  });
});
