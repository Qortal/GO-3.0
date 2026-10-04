import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../hooks/useSecureScreen', () => ({ useSecureScreen: vi.fn() }));
const nodeBase = vi.hoisted(() => ({
  get: (): string => 'http://127.0.0.1:12391',
}));
vi.mock('../../utils/globalApi', () => ({
  getBaseApiReact: () => nodeBase.get(),
}));
// Counts how often the request details render (the countdown must not
// re-render them).
const detailsRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock('./QortalRequestDetails', () => ({
  QortalRequestDetails: ({ details }: { details: { resources?: unknown } }) => {
    detailsRenders.count += 1;
    if (details?.resources === null) throw new Error('cannot draw');
    return <div data-testid="qortal-request-details" />;
  },
}));
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const params = { ...(options || {}) };
      delete params.postProcess;
      return Object.keys(params).length
        ? `${key} ${JSON.stringify(params)}`
        : key;
    },
    i18n: { language: 'en' },
  }),
}));

import { useSecureScreen } from '../../hooks/useSecureScreen';
import { lightTheme } from '../../styles/theme-light';
import { getQdnAvatarSeedUrl, qdnAvatarKey } from '../../lib/qdnAvatars';
import type { QdnAvatarCache } from '../../lib/qdnAvatars/avatarCache';
import { setQdnAvatarCacheForTests } from '../../lib/qdnAvatars/defaultCache';
import {
  createAvatarTestHarness,
  imageResponse,
  PNG_BYTES,
} from '../../lib/qdnAvatars/testHarness';
import { ANDROID_BACK_EVENT } from '../../bridge/capacitorBridge';
import {
  QortalRequestExtensionDialog,
  looksLikeAmount,
  splitDetailLine,
  splitNameAndAddress,
} from './QortalRequestExtensionDialog';

const NOW = new Date('2026-10-02T03:00:00Z').getTime();

// App icons come from the avatar cache; by default a node that never answers,
// so no test reaches the network.
let avatars: ReturnType<typeof createAvatarTestHarness>;
beforeEach(() => {
  avatars = createAvatarTestHarness({
    handler: () => new Promise<Response>(() => {}),
  });
  setQdnAvatarCacheForTests(avatars.cache);
});
afterEach(() => {
  setQdnAvatarCacheForTests(null);
});

/** Lets the avatar cache finish its work (fake timers are on). */
const settleAvatars = () =>
  act(async () => {
    for (let i = 0; i < 10; i += 1) await vi.advanceTimersByTimeAsync(1);
  });

type DialogProps = Parameters<typeof QortalRequestExtensionDialog>[0];

const baseMessage = {
  text1: 'Send coins',
  highlightedText: '1 QORT',
  requestingApp: { name: 'Q-Wallets', service: 'APP' },
  expiresAt: NOW + 60_000,
};

function renderDialog(props: Partial<DialogProps> = {}) {
  const handlers = {
    onAccept: vi.fn(),
    onCancel: vi.fn(),
    onDeclineAll: vi.fn(),
    onCountdownComplete: vi.fn(),
  };
  const view = (next: Partial<DialogProps> = {}) => (
    <ThemeProvider theme={lightTheme}>
      <QortalRequestExtensionDialog
        open
        requestId={1}
        pendingCount={0}
        message={baseMessage}
        sendPaymentError=""
        {...handlers}
        {...props}
        {...next}
      />
    </ThemeProvider>
  );
  const result = render(view());
  return {
    ...result,
    ...handlers,
    rerenderWith: (next: Partial<DialogProps>) => result.rerender(view(next)),
  };
}

const accept = () =>
  fireEvent.click(screen.getByTestId('qortal-request-accept'));
const decline = () => fireEvent.click(screen.getByText('core:action.decline'));
/** A hardware back press, as the Capacitor bridge sends it. */
const pressBack = () => {
  const event = new CustomEvent(ANDROID_BACK_EVENT, { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};
const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe('QortalRequestExtensionDialog (GO-28 / GO-29)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.mocked(useSecureScreen).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('names the requesting app and its service', () => {
    renderDialog();
    expect(screen.getByTestId('qortal-request-app-name')).toHaveTextContent(
      'Q-Wallets'
    );
    expect(screen.getByTestId('qortal-request-app-service')).toHaveTextContent(
      'APP'
    );
    expect(
      screen.getByText('core:approval_dialog.requested_by')
    ).toBeInTheDocument();
  });

  it('warns when GO cannot tell which app asks', () => {
    renderDialog({ message: { ...baseMessage, requestingApp: null } });
    expect(screen.getByTestId('qortal-request-app-name')).toHaveTextContent(
      'core:approval_dialog.unknown_app'
    );
    expect(
      screen.getByText('core:approval_dialog.unknown_app_hint')
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('qortal-request-app-service')
    ).not.toBeInTheDocument();
  });

  it('protects the screen and touches while open', () => {
    const { rerenderWith } = renderDialog();
    expect(useSecureScreen).toHaveBeenLastCalledWith({
      secure: true,
      touchProtection: true,
    });
    rerenderWith({ open: false });
    expect(useSecureScreen).toHaveBeenLastCalledWith({
      secure: false,
      touchProtection: false,
    });
  });

  it('keeps Accept disabled for a second after the request appears', () => {
    const { onAccept } = renderDialog();
    const button = screen.getByTestId('qortal-request-accept');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    accept();
    wait(900);
    accept();
    expect(onAccept).not.toHaveBeenCalled();

    wait(100);
    expect(button).toHaveAttribute('aria-disabled', 'false');
    accept();
    expect(onAccept).toHaveBeenCalledWith({
      requestId: 1,
      checkbox1: undefined,
      confirmed: false,
    });
  });

  it('needs the tick before Accept when the request asks for it', () => {
    const { onAccept } = renderDialog({
      message: { ...baseMessage, confirmCheckbox: true },
    });
    wait(1000);
    accept();
    expect(onAccept).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /core:message\.success\.request_read/,
      })
    );
    accept();
    expect(onAccept).toHaveBeenCalledWith({
      requestId: 1,
      checkbox1: undefined,
      confirmed: true,
    });
  });

  it('starts every request fresh: boxes, tick and the Accept delay', () => {
    const withBoxes = {
      ...baseMessage,
      confirmCheckbox: true,
      checkbox1: { value: true, label: 'Pay the app fee' },
    };
    const { onAccept, rerenderWith } = renderDialog({ message: withBoxes });
    wait(1000);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pay the app fee' }));
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /core:message\.success\.request_read/,
      })
    );
    expect(
      screen.getByRole('checkbox', { name: 'Pay the app fee' })
    ).not.toBeChecked();

    // The next request takes the dialog: nothing carries over.
    rerenderWith({
      requestId: 2,
      message: { ...withBoxes, text1: 'Publish with app fee' },
    });
    expect(
      screen.getByRole('checkbox', { name: 'Pay the app fee' })
    ).toBeChecked();
    expect(
      screen.getByRole('checkbox', {
        name: /core:message\.success\.request_read/,
      })
    ).not.toBeChecked();
    accept();
    expect(onAccept).not.toHaveBeenCalled();

    wait(1000);
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: /core:message\.success\.request_read/,
      })
    );
    accept();
    expect(onAccept).toHaveBeenCalledWith({
      requestId: 2,
      checkbox1: true,
      confirmed: true,
    });
  });

  it('declines the request on screen by its id', () => {
    const { onCancel } = renderDialog({ requestId: 7 });
    wait(300);
    decline();
    expect(onCancel).toHaveBeenCalledWith(7);
  });

  it('ignores Decline right after a request appears (double taps)', () => {
    const { onCancel, rerenderWith } = renderDialog({ requestId: 7 });
    decline();
    expect(onCancel).not.toHaveBeenCalled();
    wait(300);
    decline();
    expect(onCancel).toHaveBeenCalledTimes(1);

    // The second tap of a double tap lands on the next request: ignored.
    rerenderWith({ requestId: 8 });
    decline();
    expect(onCancel).toHaveBeenCalledTimes(1);
    wait(300);
    decline();
    expect(onCancel).toHaveBeenLastCalledWith(8);
  });

  it('declines on the Android back button, and keeps it from the screens below', () => {
    const { onCancel } = renderDialog({ requestId: 5 });
    expect(pressBack()).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
    wait(300);
    expect(pressBack()).toBe(true);
    expect(onCancel).toHaveBeenCalledWith(5);
  });

  it('offers Decline all when the same app has more requests waiting', () => {
    const { onDeclineAll } = renderDialog({
      pendingCount: 3,
      sameAppPendingCount: 2,
    });
    const button = screen.getByTestId('qortal-request-decline-all');
    expect(button).toHaveTextContent(
      'core:approval_dialog.decline_all {"count":3}'
    );
    fireEvent.click(button);
    expect(onDeclineAll).not.toHaveBeenCalled();
    wait(300);
    fireEvent.click(button);
    expect(onDeclineAll).toHaveBeenCalledTimes(1);
  });

  it('shows no Decline all when only other apps wait', () => {
    renderDialog({ pendingCount: 2, sameAppPendingCount: 0 });
    expect(
      screen.queryByTestId('qortal-request-decline-all')
    ).not.toBeInTheDocument();
  });

  it('names GO itself for its own requests, without the warning', () => {
    renderDialog({
      message: {
        ...baseMessage,
        requestingApp: { name: '', service: null, internal: true },
      },
    });
    expect(screen.getByTestId('qortal-request-app-name')).toHaveTextContent(
      'core:approval_dialog.internal_app'
    );
    expect(
      screen.queryByText('core:approval_dialog.unknown_app_hint')
    ).not.toBeInTheDocument();
  });

  it('ticks the countdown without drawing the request again', () => {
    detailsRenders.count = 0;
    renderDialog({
      message: {
        ...baseMessage,
        details: { type: 'resources', resources: [] },
      },
    });
    const rendersAfterOpen = detailsRenders.count;
    expect(screen.getByTestId('qortal-request-seconds')).toHaveTextContent(
      '59'
    );
    wait(5_000);
    expect(screen.getByTestId('qortal-request-seconds')).toHaveTextContent(
      '54'
    );
    // Only the Accept delay arming re-renders the content, not the clock.
    expect(detailsRenders.count).toBeLessThanOrEqual(rendersAfterOpen + 2);
  });

  it('times out with the requester, from the wall clock', () => {
    const { onCountdownComplete } = renderDialog({
      requestId: 3,
      message: { ...baseMessage, expiresAt: NOW + 5_000 },
    });
    wait(3_000);
    expect(onCountdownComplete).not.toHaveBeenCalled();
    wait(1_000);
    expect(onCountdownComplete).toHaveBeenCalledTimes(1);
    expect(onCountdownComplete).toHaveBeenCalledWith(3);
  });

  it('ends a request that waited too long in the queue at once', () => {
    const { onCountdownComplete, onAccept } = renderDialog({
      requestId: 4,
      message: { ...baseMessage, expiresAt: NOW - 1 },
    });
    expect(onCountdownComplete).toHaveBeenCalledWith(4);
    wait(1000);
    accept();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('says how many requests wait behind this one', () => {
    renderDialog({ pendingCount: 2 });
    expect(screen.getByTestId('qortal-request-pending')).toHaveTextContent(
      'core:approval_dialog.more_waiting {"count":2}'
    );
  });

  it('declines a request it cannot draw', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { onCancel } = renderDialog({
      requestId: 9,
      message: {
        ...baseMessage,
        details: { type: 'resources', resources: null },
      },
    });
    expect(onCancel).toHaveBeenCalledWith(9);
    error.mockRestore();
  });
});

const ADDRESS = 'QWfVwmsTD3jKpUEb2HUk7wgeVBgYwK5V8c';

describe('approval dialog layout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the question once, not again as the summary', () => {
    renderDialog({
      message: {
        text1: 'Allow this app to get your wallet information?',
        requestingApp: { name: 'Q-Wallets', service: 'APP' },
        expiresAt: NOW + 60_000,
      },
    });

    expect(
      screen.getAllByText('Allow this app to get your wallet information?')
    ).toHaveLength(1);
    expect(screen.queryByTestId('qortal-request-summary')).toBeNull();
  });

  it('puts a payment recipient in the amount card, with the full address', () => {
    renderDialog({
      message: {
        text1: 'Allow this app to send coins?',
        text2: `To: alice (${ADDRESS})`,
        highlightedText: '5 QORT',
        fee: '0.01',
        confirmCheckbox: true,
        requestingApp: { name: 'Q-Wallets', service: 'APP' },
        expiresAt: NOW + 60_000,
      },
    });

    const card = screen.getByTestId('qortal-request-summary');
    expect(card).toHaveTextContent('5 QORT');
    expect(card).toHaveTextContent('alice');
    expect(card).toHaveTextContent(ADDRESS);
  });

  it('lists "label: value" lines as rows outside the card for other requests', () => {
    renderDialog({
      message: {
        text1: 'Allow this app to publish to QDN?',
        text2: 'service: VIDEO',
        text3: 'identifier: qtube_vid_1',
        requestingApp: { name: 'Q-Tube', service: 'APP' },
        expiresAt: NOW + 60_000,
      },
    });

    expect(screen.getByText('Service')).toBeInTheDocument();
    expect(screen.getByText('VIDEO')).toBeInTheDocument();
    expect(screen.getByText('Identifier')).toBeInTheDocument();
  });

  it('shows the cached app icon at once, and the Qortal logo until it loads', async () => {
    await avatars.cache.putImage('Q-Wallets', PNG_BYTES);
    renderDialog();

    const icon = screen.getByTestId('qortal-request-app-icon');
    expect(icon.getAttribute('src')).toBe('blob:test/1');
    expect(icon).toHaveStyle({ opacity: '0' });
    expect(screen.getByTestId('qortal-request-app')).toContainHTML(
      'LogoSelected'
    );
    fireEvent.load(icon);
    expect(icon).toHaveStyle({ opacity: '1' });
    expect(avatars.calls).toHaveLength(0);
  });

  it('fetches an icon that is not cached yet first, from the node in use', async () => {
    avatars.setHandler(() => imageResponse());
    renderDialog();
    expect(screen.queryByTestId('qortal-request-app-icon')).toBeNull();

    await settleAvatars();

    expect(avatars.calls[0].url).toContain(
      '/arbitrary/THUMBNAIL/Q-Wallets/qortal_avatar?async=true'
    );
    expect(
      screen.getByTestId('qortal-request-app-icon').getAttribute('src')
    ).toMatch(/^blob:test\//);
  });

  it('shows the icon GO ships for a well-known app while the node is slow', () => {
    const seeded = createAvatarTestHarness({
      seeds: { [qdnAvatarKey('Q-Wallets')!]: '/seeds/q-wallets.webp' },
      handler: () => new Promise<Response>(() => {}),
    });
    setQdnAvatarCacheForTests(seeded.cache);
    renderDialog();

    expect(
      screen.getByTestId('qortal-request-app-icon').getAttribute('src')
    ).toBe('/seeds/q-wallets.webp');
  });

  it('keeps the icon on screen under the live one until that has loaded', async () => {
    const seeded = createAvatarTestHarness({
      seeds: { [qdnAvatarKey('Q-Wallets')!]: '/seeds/q-wallets.webp' },
      handler: () => new Promise<Response>(() => {}),
    });
    setQdnAvatarCacheForTests(seeded.cache);
    renderDialog();
    const seedIcon = screen.getByTestId('qortal-request-app-icon');
    fireEvent.load(seedIcon);

    await act(async () => {
      await seeded.cache.putImage('Q-Wallets', PNG_BYTES);
    });

    const live = screen.getByTestId('qortal-request-app-icon');
    expect(live.getAttribute('src')).toBe('blob:test/1');
    expect(live).toHaveStyle({ opacity: '0' });
    // The same image element stays underneath: no reload, no logo.
    expect(screen.getByTestId('qortal-request-app-icon-previous')).toBe(
      seedIcon
    );
    expect(screen.getByTestId('qortal-request-app')).not.toContainHTML(
      'LogoSelected'
    );

    fireEvent.load(live);
    expect(live).toHaveStyle({ opacity: '1' });
    expect(screen.queryByTestId('qortal-request-app-icon-previous')).toBeNull();
  });

  it('keeps the loaded icon when the live one cannot load', async () => {
    const seeded = createAvatarTestHarness({
      seeds: { [qdnAvatarKey('Q-Wallets')!]: '/seeds/q-wallets.webp' },
      handler: () => new Promise<Response>(() => {}),
    });
    setQdnAvatarCacheForTests(seeded.cache);
    renderDialog();
    fireEvent.load(screen.getByTestId('qortal-request-app-icon'));
    await act(async () => {
      await seeded.cache.putImage('Q-Wallets', PNG_BYTES);
    });

    fireEvent.error(screen.getByTestId('qortal-request-app-icon'));

    expect(screen.queryByTestId('qortal-request-app-icon')).toBeNull();
    expect(
      screen.getByTestId('qortal-request-app-icon-previous').getAttribute('src')
    ).toBe('/seeds/q-wallets.webp');
    expect(screen.getByTestId('qortal-request-app')).not.toContainHTML(
      'LogoSelected'
    );
  });

  it('shows the Qortal logo, and keeps the request, when the node is unknown', async () => {
    setQdnAvatarCacheForTests(null);
    const real = nodeBase.get;
    nodeBase.get = () => {
      throw new Error('no node configured');
    };
    try {
      const { onCancel } = renderDialog({
        message: {
          ...baseMessage,
          requestingApp: { name: 'Some-New-App', service: 'APP' },
        },
      });
      await settleAvatars();

      expect(screen.queryByTestId('qortal-request-app-icon')).toBeNull();
      expect(screen.getByTestId('qortal-request-dialog')).toBeInTheDocument();
      expect(onCancel).not.toHaveBeenCalled();
    } finally {
      nodeBase.get = real;
    }
  });

  it('still shows the icon GO ships when the node is unknown', async () => {
    setQdnAvatarCacheForTests(null);
    const real = nodeBase.get;
    nodeBase.get = () => {
      throw new Error('no node configured');
    };
    try {
      renderDialog();
      await settleAvatars();

      expect(
        screen.getByTestId('qortal-request-app-icon').getAttribute('src')
      ).toBe(getQdnAvatarSeedUrl('Q-Wallets'));
    } finally {
      nodeBase.get = real;
    }
  });

  it('keeps the request when the icon cannot load', async () => {
    await avatars.cache.putImage('Q-Wallets', PNG_BYTES);
    const { onCancel } = renderDialog();

    fireEvent.error(screen.getByTestId('qortal-request-app-icon'));
    expect(screen.queryByTestId('qortal-request-app-icon')).toBeNull();
    expect(screen.getByTestId('qortal-request-dialog')).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('keeps the request, with the Qortal logo, when the icon throws while drawing', () => {
    const broken = new Proxy({} as QdnAvatarCache, {
      get: () => () => {
        throw new Error('avatar cache broken');
      },
    });
    setQdnAvatarCacheForTests(broken);
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    try {
      const { onCancel } = renderDialog();

      expect(screen.getByTestId('qortal-request-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('qortal-request-app')).toContainHTML(
        'LogoSelected'
      );
      expect(onCancel).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('splitDetailLine', () => {
  it.each([
    ['service: VIDEO', 'Service', 'VIDEO'],
    ['Tx type: PAYMENT', 'Tx type', 'PAYMENT'],
    [`To: alice (${ADDRESS})`, 'To', `alice (${ADDRESS})`],
  ])('splits %s', (line, label, value) => {
    expect(splitDetailLine(line)).toEqual({ label, value });
  });

  it.each([
    'https://example.com/a',
    'A sentence without a label',
    'no space after the colon:x',
  ])('leaves %s as a paragraph', (line) => {
    expect(splitDetailLine(line).label).toBeNull();
  });
});

describe('looksLikeAmount', () => {
  it.each(['5 QORT', '0.25 LTC', '1,000.5 QORT'])('%s is an amount', (text) => {
    expect(looksLikeAmount(text)).toBe(true);
  });

  it.each(['Read the transaction carefully', 'QORT 5', '', undefined])(
    '%s is not',
    (text) => {
      expect(looksLikeAmount(text)).toBe(false);
    }
  );
});

describe('splitNameAndAddress', () => {
  it('separates a name from its address', () => {
    expect(splitNameAndAddress(`alice (${ADDRESS})`)).toEqual({
      name: 'alice',
      address: ADDRESS,
    });
  });

  it('recognises a bare address', () => {
    expect(splitNameAndAddress(ADDRESS)).toEqual({
      name: '',
      address: ADDRESS,
    });
  });

  it('leaves other text alone', () => {
    expect(splitNameAndAddress('qtube_vid_1')).toEqual({
      name: 'qtube_vid_1',
      address: null,
    });
  });
});
