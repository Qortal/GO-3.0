import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DISMISS_DISTANCE_PX,
  DISMISS_FLICK_MIN_PX,
  DISMISS_FLICK_VELOCITY,
  MobileAccountPanel,
  BUTTONS_GONE_TRAVEL_PX,
  buttonCloseProgress,
  resolveSwipeRelease,
  type AccountAction,
} from './MobileAccountPanel';
import { useAndroidBack } from '../../utils/androidBack';

vi.mock('../../utils/androidBack', () => ({
  BACK_PRIORITY: { overlay: 70, root: 10 },
  useAndroidBack: vi.fn(),
}));
vi.mock('../QortalUserAvatar', () => ({
  QortalUserAvatar: () => <div data-testid="avatar" />,
}));

const actions = (): AccountAction[] => [
  { icon: SettingsRoundedIcon, label: 'Node', onClick: vi.fn() },
  { icon: LogoutRoundedIcon, label: 'Logout', onClick: vi.fn() },
];

const renderPanel = (
  props: Partial<Parameters<typeof MobileAccountPanel>[0]> = {}
) => {
  const onClose = vi.fn();
  const list = props.actions ?? actions();
  const utils = render(
    <MobileAccountPanel
      open
      anchor={{ top: 52, right: 10 }}
      actions={list}
      address="QfX9KhXn1234567890YcyQyH"
      primaryName="Simon James"
      cachedAvatarEntry={null}
      onClose={onClose}
      {...props}
    />
  );
  return { ...utils, onClose, list };
};

describe('MobileAccountPanel', () => {
  beforeEach(() => {
    // Zero-length animations keep the exit choreography out of the timing.
    window.localStorage.setItem('hub_ui_animations_enabled', 'false');
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it('shows the account header and one menu item per action', () => {
    renderPanel();
    expect(screen.getByRole('menu', { name: 'Account menu' })).toBeTruthy();
    expect(screen.getByText('Simon James')).toBeTruthy();
    expect(screen.getByText('QfX9KhXn…YcyQyH')).toBeTruthy();
    expect(screen.getAllByRole('menuitem').map((el) => el.textContent)).toEqual(
      ['Node', 'Logout']
    );
  });

  it('turns native panning off inside the list so a drag on a button is not cancelled', () => {
    renderPanel();
    const list = screen.getByRole('menu').lastElementChild as HTMLElement;
    expect(list.style.touchAction).toBe('none');
  });

  it('lets a swipe start on the dim behind the panel', () => {
    renderPanel();
    expect(screen.getByTestId('account-menu-backdrop').style.touchAction).toBe(
      'none'
    );
  });

  it('renders nothing while closed', () => {
    renderPanel({ open: false });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes when the dim behind it is tapped', () => {
    const { onClose } = renderPanel();
    fireEvent.click(screen.getByTestId('account-menu-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('runs the action and closes when a button is tapped', () => {
    const { onClose, list } = renderPanel();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Logout' }));
    expect(list[1].onClick).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('takes the Android back press while open', () => {
    const { onClose } = renderPanel();
    const calls = vi.mocked(useAndroidBack).mock.calls;
    const [handler, options] = calls[calls.length - 1];
    expect(options).toMatchObject({ enabled: true, priority: 70 });
    expect(handler()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not register for back while closed', () => {
    renderPanel({ open: false });
    const calls = vi.mocked(useAndroidBack).mock.calls;
    expect(calls[calls.length - 1][1]).toMatchObject({ enabled: false });
  });

  it('unmounts the menu after closing', async () => {
    const { rerender } = renderPanel();
    rerender(
      <MobileAccountPanel
        open={false}
        anchor={{ top: 52, right: 10 }}
        actions={actions()}
        address="Q"
        primaryName="Simon James"
        cachedAvatarEntry={null}
        onClose={() => {}}
      />
    );
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
});

describe('resolveSwipeRelease', () => {
  const FLING_TO = -600;

  it('springs back from a short slow swipe up', () => {
    expect(resolveSwipeRelease(-40, -80, FLING_TO)).toEqual({ kind: 'settle' });
    expect(resolveSwipeRelease(0, 0, FLING_TO)).toEqual({ kind: 'settle' });
  });

  it('never closes on a downward pull, however long or fast', () => {
    expect(resolveSwipeRelease(160, 900, FLING_TO)).toEqual({ kind: 'settle' });
    expect(resolveSwipeRelease(5, 3000, FLING_TO)).toEqual({ kind: 'settle' });
  });

  it('throws the panel up after enough upward travel', () => {
    expect(
      resolveSwipeRelease(-(DISMISS_DISTANCE_PX + 1), 0, FLING_TO)
    ).toEqual({ kind: 'fling', y: FLING_TO });
  });

  it('throws the panel up on an upward flick, but not on a flick against it', () => {
    const offset = -(DISMISS_FLICK_MIN_PX + 2);
    expect(
      resolveSwipeRelease(offset, -(DISMISS_FLICK_VELOCITY + 50), FLING_TO)
    ).toEqual({ kind: 'fling', y: FLING_TO });
    expect(
      resolveSwipeRelease(offset, DISMISS_FLICK_VELOCITY + 50, FLING_TO)
    ).toEqual({ kind: 'settle' });
  });

  it('ignores a fast flick that barely moved', () => {
    expect(resolveSwipeRelease(-10, -2000, FLING_TO)).toEqual({
      kind: 'settle',
    });
  });
});

describe('buttonCloseProgress', () => {
  const COUNT = 7;
  const all = (y: number) =>
    Array.from({ length: COUNT }, (_, i) => buttonCloseProgress(y, i, COUNT));

  it('keeps every button in place at rest and on a downward pull', () => {
    expect(all(0)).toEqual(Array(COUNT).fill(0));
    expect(all(40)).toEqual(Array(COUNT).fill(0));
  });

  it('has closed every button once the swipe travel is complete', () => {
    expect(all(-BUTTONS_GONE_TRAVEL_PX)).toEqual(Array(COUNT).fill(1));
    expect(all(-2 * BUTTONS_GONE_TRAVEL_PX)).toEqual(Array(COUNT).fill(1));
  });

  it('closes the bottom button first and the top one last', () => {
    const midway = all(-BUTTONS_GONE_TRAVEL_PX * 0.3);
    expect(midway[COUNT - 1]).toBeGreaterThan(0.5);
    expect(midway[0]).toBe(0);
    for (let i = 1; i < COUNT; i += 1) {
      expect(midway[i]).toBeGreaterThanOrEqual(midway[i - 1]);
    }
  });

  it('brings the buttons back when the finger comes back down', () => {
    const up = buttonCloseProgress(-100, COUNT - 1, COUNT);
    const backDown = buttonCloseProgress(-30, COUNT - 1, COUNT);
    expect(up).toBe(1);
    expect(backDown).toBeLessThan(up);
    expect(buttonCloseProgress(0, COUNT - 1, COUNT)).toBe(0);
  });

  it('handles a single button', () => {
    expect(buttonCloseProgress(0, 0, 1)).toBe(0);
    expect(buttonCloseProgress(-BUTTONS_GONE_TRAVEL_PX, 0, 1)).toBe(1);
  });
});
