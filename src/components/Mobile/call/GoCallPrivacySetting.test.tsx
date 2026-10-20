import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ring = vi.hoisted(() => ({
  allowed: null as boolean | null,
  open: vi.fn(async () => true),
}));

vi.mock('./callBridgeAdapters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./callBridgeAdapters')>();
  return {
    ...actual,
    useFullScreenRingAllowed: () => ring.allowed,
    openFullScreenRingSettings: () => ring.open(),
  };
});

import '../../../i18n/i18n';
import {
  CALL_TRANSPORT_STORAGE_KEY,
  getCallTransportPreferenceSafe,
  setCallTransportPreferenceSafe,
} from './callBridgeAdapters';
import { GoCallPrivacySetting } from './GoCallPrivacySetting';
import { publishCallStrip, resetCallStripStoreForTests } from './goCallUi';
import type { MobileCallView } from './callUiModel';

const liveCall = (
  phase: MobileCallView['phase'] = 'active'
): MobileCallView => ({
  kind: 'direct',
  phase,
  callKey: 'direct:QAlice:QMe',
  title: 'alice',
  durationSec: 12,
  muted: false,
  transport: 'direct',
  delayed: false,
  participants: [],
  maxParticipants: 2,
  relaying: false,
});

const noop = { open: () => {}, toggleMute: () => {}, hangUp: () => {} };

describe('GoCallPrivacySetting', () => {
  beforeEach(() => {
    setCallTransportPreferenceSafe('webrtc');
    resetCallStripStoreForTests();
    ring.allowed = null;
    ring.open.mockClear();
  });

  afterEach(() => {
    resetCallStripStoreForTests();
  });

  it('defaults to Direct and explains the IP trade-off', () => {
    render(<GoCallPrivacySetting />);
    expect(
      screen
        .getByTestId('go-call-transport-webrtc')
        .getAttribute('aria-checked')
    ).toBe('true');
    expect(
      screen.getByTestId('go-call-transport-detail').textContent
    ).toContain('IP address');
  });

  it('switches to Private (Reticulum only) and stores it', () => {
    render(<GoCallPrivacySetting />);
    fireEvent.click(screen.getByRole('radio', { name: /Private/ }));
    expect(getCallTransportPreferenceSafe()).toBe('reticulum');
    expect(localStorage.getItem(CALL_TRANSPORT_STORAGE_KEY)).toBe('reticulum');
    expect(
      screen
        .getByTestId('go-call-transport-reticulum')
        .getAttribute('aria-checked')
    ).toBe('true');
    // No call running: nothing about "next call".
    expect(screen.queryByTestId('go-call-transport-next-call')).toBeNull();
  });

  it('changed during a call: applies from the next call', () => {
    act(() =>
      publishCallStrip({ view: liveCall(), actions: noop, show: false })
    );
    render(<GoCallPrivacySetting />);
    // Just opening settings during a call says nothing.
    expect(screen.queryByTestId('go-call-transport-next-call')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /Private/ }));
    expect(screen.getByTestId('go-call-transport-next-call').textContent).toBe(
      'Applies from Your next call.'
    );
    // The call ends: the note goes.
    act(() =>
      publishCallStrip({
        view: liveCall('ended'),
        actions: noop,
        show: false,
      })
    );
    expect(screen.queryByTestId('go-call-transport-next-call')).toBeNull();
  });

  it('changed during a group call: no "next call" note (it applies now)', () => {
    act(() =>
      publishCallStrip({
        view: {
          ...liveCall(),
          kind: 'group',
          callKey: 'gcall-qortal-7',
          maxParticipants: 8,
        },
        actions: noop,
        show: false,
      })
    );
    render(<GoCallPrivacySetting />);
    fireEvent.click(screen.getByRole('radio', { name: /Private/ }));
    expect(getCallTransportPreferenceSafe()).toBe('reticulum');
    // GO re-syncs the running group call's WebRTC edges on the change.
    expect(screen.queryByTestId('go-call-transport-next-call')).toBeNull();
  });

  it('a tap on the option already chosen is not a change', () => {
    act(() =>
      publishCallStrip({ view: liveCall(), actions: noop, show: false })
    );
    render(<GoCallPrivacySetting />);
    fireEvent.click(screen.getByRole('radio', { name: /Direct/ }));
    expect(screen.queryByTestId('go-call-transport-next-call')).toBeNull();
  });

  it('Android 14+ without the full-screen OK: says so, Allow opens Android', () => {
    ring.allowed = false;
    render(<GoCallPrivacySetting />);
    expect(screen.getByTestId('go-call-full-screen-off').textContent).toContain(
      "Incoming calls can't show over Your lock screen."
    );
    fireEvent.click(screen.getByTestId('go-call-full-screen-allow'));
    expect(ring.open).toHaveBeenCalledTimes(1);
  });

  it('nothing about the lock screen when allowed or unknown', () => {
    ring.allowed = true;
    const { rerender } = render(<GoCallPrivacySetting />);
    expect(screen.queryByTestId('go-call-full-screen-off')).toBeNull();
    ring.allowed = null;
    rerender(<GoCallPrivacySetting />);
    expect(screen.queryByTestId('go-call-full-screen-off')).toBeNull();
  });
});
