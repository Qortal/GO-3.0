import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const go = vi.hoisted(() => ({ on: true }));
const hints = vi.hoisted(() => ({
  showCallHint: vi.fn(),
  openGoCallScreen: vi.fn(),
  isCallNetworkWarmingUp: vi.fn(() => true),
}));

vi.mock('./goCallUi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./goCallUi')>()),
  isGoCallUi: () => go.on,
}));
vi.mock('./callHints', () => hints);
vi.mock('../../../utils/globalApi', () => ({ getBaseApiReact: () => '' }));
vi.mock('../../Chat/AvatarPreviewModal', () => ({
  AvatarPreviewModal: () => null,
}));

import '../../../i18n/i18n';
import {
  DirectChatHeader,
  type DirectChatHeaderCall,
  type DirectChatHeaderProps,
} from '../../Chat/DirectChatHeader';

const call = (
  overrides: Partial<DirectChatHeaderCall> = {}
): DirectChatHeaderCall => ({
  enabled: true,
  connected: false,
  ringing: false,
  blockedByFriend: false,
  blockedByP2p: false,
  p2pBlockedTooltip: 'P2P health is bad.',
  onStart: vi.fn(),
  onHangUp: vi.fn(),
  ...overrides,
});

const renderHeader = (overrides: Partial<DirectChatHeaderProps> = {}) =>
  render(
    <DirectChatHeader
      isMobile
      reticulumDirectUiEnabled
      isNewChat={false}
      isSelfDirect={false}
      partner={{ name: 'Alice', address: 'QAliceAddress' }}
      onClose={vi.fn()}
      peerOnline
      peerHidden={false}
      unhideBusy={false}
      onUnhide={vi.fn()}
      isFriend
      friendActionBusy={false}
      onToggleFriend={vi.fn()}
      call={call()}
      {...overrides}
    />
  );

/** The disabled IconButton ignores taps; its wrapper span gets them. */
const tapCallArea = () => {
  const button = screen.getByRole('button', { name: /voice call|end call/i });
  fireEvent.click(button.parentElement as HTMLElement);
};

afterEach(() => {
  vi.clearAllMocks();
  go.on = true;
});

describe('DirectChatHeader call button on GO', () => {
  it('a tap on the greyed button while the network warms up explains it', () => {
    renderHeader({ call: call({ blockedByP2p: true }) });
    tapCallArea();
    expect(hints.showCallHint).toHaveBeenCalledWith(
      'Calls get ready about half a minute after GO connects. Try again shortly.'
    );
  });

  it('no receiving peers at all: the Hub reason (connect more peers)', () => {
    hints.isCallNetworkWarmingUp.mockReturnValueOnce(false);
    renderHeader({ call: call({ blockedByP2p: true }) });
    tapCallArea();
    expect(hints.showCallHint).toHaveBeenCalledWith('P2P health is bad.');
  });

  it('offline peer: the offline reason', () => {
    renderHeader({ peerOnline: false });
    tapCallArea();
    expect(hints.showCallHint).toHaveBeenCalledTimes(1);
    expect(hints.showCallHint.mock.calls[0][0]).toMatch(/offline/i);
  });

  it('while ringing out it brings the call screen back', () => {
    renderHeader({ call: call({ ringing: true }) });
    tapCallArea();
    expect(hints.openGoCallScreen).toHaveBeenCalledTimes(1);
    expect(hints.showCallHint).not.toHaveBeenCalled();
  });

  it('an enabled button just starts the call', () => {
    const onStart = vi.fn();
    renderHeader({ call: call({ onStart }) });
    fireEvent.click(screen.getByRole('button', { name: /voice call/i }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(hints.showCallHint).not.toHaveBeenCalled();
  });

  it('the Hub keeps its tooltip only', () => {
    go.on = false;
    renderHeader({ call: call({ blockedByP2p: true }) });
    tapCallArea();
    expect(hints.showCallHint).not.toHaveBeenCalled();
  });
});
