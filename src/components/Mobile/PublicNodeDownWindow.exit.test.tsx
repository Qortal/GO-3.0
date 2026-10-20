import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Its own file: framer-motion's frame loop is shared by a file's tests, and
// fake timers elsewhere would stall it. Real timers throughout here.
vi.mock('./immersive/useImmersiveBars', () => ({
  immersiveMotionReduced: () => true,
}));
vi.mock('../App/QappIcon', () => ({
  QappIcon: ({ name }: { name: string }) => <span>{name}</span>,
}));
vi.mock('../Reticulum/reticulumStatus', () => ({
  getDeviceOnline: () => true,
}));
vi.mock('../../utils/globalApi', () => ({
  getBaseApiReact: () => 'https://ext-node.qortal.link',
}));

import '../../i18n/i18n';
import {
  beforePublicNodeOpen,
  checkPublicNodeNow,
  resetPublicNodeWatchForTests,
} from '../../publicNode/publicNodeWatch';
import { PublicNodeDownWindow } from './PublicNodeDownWindow';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    })
  );
  resetPublicNodeWatchForTests();
});

afterEach(() => {
  resetPublicNodeWatchForTests();
  vi.unstubAllGlobals();
});

describe('PublicNodeDownWindow leaving', () => {
  it('leaves the screen after "Wait", even while the countdown ticks', async () => {
    render(<PublicNodeDownWindow enabled />);
    await act(async () => {
      await checkPublicNodeNow();
    });
    act(() => {
      beforePublicNodeOpen({ service: 'APP', name: 'Torq', retry: vi.fn() });
    });
    await screen.findByText('Checking again in 6 s', undefined, {
      timeout: 2_000,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Wait' }));
    await waitFor(
      () => {
        expect(screen.queryByTestId('public-node-down-window')).toBeNull();
        expect(screen.queryByTestId('public-node-backdrop')).toBeNull();
      },
      { timeout: 2_000 }
    );
  });
});
