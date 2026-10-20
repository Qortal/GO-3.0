import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  __resetCallTransportPreferenceForTests,
  CALL_TRANSPORT_PREFERENCE_KEY,
  getCallTransportPreference,
  isWebRtcCallTransportAllowed,
  setCallTransportPreference,
  subscribe,
  subscribeCallTransportPreference,
  useCallTransportPreference,
} from './callTransportPreference';

describe('callTransportPreference', () => {
  beforeEach(() => {
    localStorage.removeItem(CALL_TRANSPORT_PREFERENCE_KEY);
    __resetCallTransportPreferenceForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem(CALL_TRANSPORT_PREFERENCE_KEY);
    __resetCallTransportPreferenceForTests();
  });

  it('defaults to webrtc', () => {
    expect(getCallTransportPreference()).toBe('webrtc');
    expect(isWebRtcCallTransportAllowed()).toBe(true);
  });

  it('persists under go.calls.transport', () => {
    setCallTransportPreference('reticulum');
    expect(localStorage.getItem('go.calls.transport')).toBe('reticulum');
    __resetCallTransportPreferenceForTests();
    expect(getCallTransportPreference()).toBe('reticulum');
    expect(isWebRtcCallTransportAllowed()).toBe(false);
  });

  it('ignores junk in storage and junk values', () => {
    localStorage.setItem(CALL_TRANSPORT_PREFERENCE_KEY, 'turn-only');
    expect(getCallTransportPreference()).toBe('webrtc');
    setCallTransportPreference('nope' as never);
    expect(getCallTransportPreference()).toBe('webrtc');
  });

  it('notifies subscribers only on change and unsubscribes', () => {
    const seen: string[] = [];
    const off = subscribeCallTransportPreference((p) => seen.push(p));
    setCallTransportPreference('webrtc');
    setCallTransportPreference('reticulum');
    setCallTransportPreference('reticulum');
    setCallTransportPreference('webrtc');
    off();
    setCallTransportPreference('reticulum');
    expect(seen).toEqual(['reticulum', 'webrtc']);
  });

  it('exposes subscribe as an alias', () => {
    expect(subscribe).toBe(subscribeCallTransportPreference);
  });

  it('keeps working when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(getCallTransportPreference()).toBe('webrtc');
    setCallTransportPreference('reticulum');
    expect(getCallTransportPreference()).toBe('reticulum');
  });

  it('a throwing listener does not stop the others', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: string[] = [];
    subscribeCallTransportPreference(() => {
      throw new Error('boom');
    });
    subscribeCallTransportPreference((p) => seen.push(p));
    setCallTransportPreference('reticulum');
    expect(seen).toEqual(['reticulum']);
  });

  it('picks up a change written by another document (storage event)', () => {
    const seen: string[] = [];
    subscribeCallTransportPreference((p) => seen.push(p));
    getCallTransportPreference();
    localStorage.setItem(CALL_TRANSPORT_PREFERENCE_KEY, 'reticulum');
    window.dispatchEvent(
      new StorageEvent('storage', { key: CALL_TRANSPORT_PREFERENCE_KEY })
    );
    expect(seen).toEqual(['reticulum']);
    expect(getCallTransportPreference()).toBe('reticulum');
  });

  it('React hook reflects and updates the preference', () => {
    const { result } = renderHook(() => useCallTransportPreference());
    expect(result.current[0]).toBe('webrtc');
    act(() => result.current[1]('reticulum'));
    expect(result.current[0]).toBe('reticulum');
    act(() => setCallTransportPreference('webrtc'));
    expect(result.current[0]).toBe('webrtc');
  });
});
