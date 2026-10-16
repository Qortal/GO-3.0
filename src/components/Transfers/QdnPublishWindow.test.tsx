import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ keyboardInset: 0 }));

// Animations shortened to fades, as with GO's "reduce motion".
vi.mock('../Mobile/immersive/useImmersiveBars', () => ({
  immersiveMotionReduced: () => true,
}));
vi.mock('../../hooks/useSoftKeyboardInset', () => ({
  useSoftKeyboardInset: () => mocks.keyboardInset,
}));

import '../../i18n/i18n';
import { ANDROID_BACK_EVENT } from '../../bridge/capacitorBridge';
import {
  beginPublishJob,
  finishPublishJob,
  getPublishWindowSnapshot,
  noteAppWindow,
  notePublishProgress,
  notePublishRowFailed,
  notePublishRowPublished,
  resetPublishWindowForTests,
} from '../../qdn/publish/publishJobs';
import { QdnPublishWindow } from './QdnPublishWindow';

const MB = 1024 * 1024;

const startPublish = (appWindow: 'hidden' | 'none' = 'hidden') => {
  let id = '';
  act(() => {
    id = beginPublishJob({
      tabId: 'tab-1',
      appName: 'Q-Share',
      appService: 'APP',
      rows: [
        { service: 'VIDEO', label: 'holiday.mp4', bytes: 40 * MB },
        { service: 'DOCUMENT', label: 'qshare_details', bytes: 900 },
      ],
    });
    noteAppWindow(id, appWindow);
  });
  return id;
};

const pressBack = () => {
  const event = new CustomEvent(ANDROID_BACK_EVENT, { cancelable: true });
  act(() => {
    window.dispatchEvent(event);
  });
  return event.defaultPrevented;
};

describe('QdnPublishWindow', () => {
  beforeEach(() => {
    mocks.keyboardInset = 0;
    resetPublishWindowForTests();
  });

  afterEach(() => {
    act(() => resetPublishWindowForTests());
  });

  it('opens in place of the app’s own publish window', () => {
    render(<QdnPublishWindow enabled />);
    const id = startPublish('hidden');
    act(() =>
      notePublishProgress(id, 0, {
        stage: 'uploading',
        sentChunks: 4,
        totalChunks: 8,
      })
    );
    const dialog = screen.getByRole('dialog', { name: 'Publishing to QDN' });
    expect(dialog.textContent).toContain('Q-Share · 2 files');
    expect(dialog.textContent).toContain('holiday.mp4');
    expect(dialog.textContent).toContain('20.0 MB of 40.0 MB');
    expect(
      screen.getByRole('button', { name: /Keep using Q-Share/ })
    ).toBeTruthy();
  });

  it('shrinks into the bubble and opens again from it', async () => {
    render(<QdnPublishWindow enabled />);
    startPublish('hidden');
    fireEvent.click(screen.getByRole('button', { name: /Keep using Q-Share/ }));
    expect(getPublishWindowSnapshot().view).toBe('minimized');

    const bubble = await screen.findByTestId('qdn-publish-bubble');
    await waitFor(() =>
      expect(screen.queryByTestId('qdn-publish-window')).toBeNull()
    );
    expect(bubble.getAttribute('aria-label')).toBe(
      'Publishing to QDN from Q-Share, 0%. Tap to open.'
    );

    fireEvent.pointerDown(bubble, { button: 0, pointerId: 1 });
    fireEvent.pointerUp(bubble, { button: 0, pointerId: 1 });
    expect(getPublishWindowSnapshot().view).toBe('expanded');
    expect(await screen.findByTestId('qdn-publish-window')).toBeTruthy();
  });

  it('shows just the bubble when the app showed nothing to hide', async () => {
    render(<QdnPublishWindow enabled />);
    startPublish('none');
    expect(await screen.findByTestId('qdn-publish-bubble')).toBeTruthy();
    expect(screen.queryByTestId('qdn-publish-window')).toBeNull();
  });

  it('minimizes on Android back, and leaves back alone after that', () => {
    render(<QdnPublishWindow enabled />);
    startPublish('hidden');
    expect(pressBack()).toBe(true);
    expect(getPublishWindowSnapshot().view).toBe('minimized');
    expect(pressBack()).toBe(false);
  });

  it('keeps the bubble out of the way of the keyboard', async () => {
    mocks.keyboardInset = 280;
    render(<QdnPublishWindow enabled />);
    startPublish('none');
    const bubble = await screen.findByTestId('qdn-publish-bubble');
    expect(bubble.getAttribute('aria-hidden')).toBe('true');
    expect(bubble.style.pointerEvents).toBe('none');
  });

  it('says which file failed and hands the app back', async () => {
    render(<QdnPublishWindow enabled />);
    const id = startPublish('hidden');
    act(() => {
      notePublishRowPublished(id, 0);
      notePublishRowFailed(id, 1, 'Not enough QORT for the publish fee');
      finishPublishJob(id);
    });
    const dialog = screen.getByRole('dialog', {
      name: 'Some files did not publish',
    });
    expect(dialog.textContent).toContain('1 of 2 files published');
    expect(dialog.textContent).toContain('Not enough QORT for the publish fee');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Q-Share' }));
    expect(getPublishWindowSnapshot().view).toBe('closed');
    await waitFor(() =>
      expect(screen.queryByTestId('qdn-publish-window')).toBeNull()
    );
  });

  it('offers node settings when the node needs its API key', async () => {
    const opened = vi.fn();
    document.addEventListener('openNodeSettings', opened);
    try {
      render(<QdnPublishWindow enabled />);
      act(() => {
        const id = beginPublishJob({
          tabId: 'tab-1',
          appName: 'Q-Mintership+',
          rows: [{ service: 'DOCUMENT_PRIVATE', label: 'vote', bytes: 300 }],
        });
        notePublishRowFailed(
          id,
          0,
          'Your node needs its API key to publish. Add it in node settings.',
          { needsNodeKey: true }
        );
        finishPublishJob(id);
      });
      const dialog = screen.getByRole('dialog', { name: 'Publish failed' });
      expect(dialog.textContent).toContain(
        'Your node needs its API key to publish. Add it in node settings.'
      );
      expect(dialog.textContent).not.toContain('did not answer');
      fireEvent.click(
        screen.getByRole('button', { name: 'Open node settings' })
      );
      expect(opened).toHaveBeenCalledTimes(1);
      expect(getPublishWindowSnapshot().view).toBe('closed');
      await waitFor(() =>
        expect(screen.queryByTestId('qdn-publish-window')).toBeNull()
      );
    } finally {
      document.removeEventListener('openNodeSettings', opened);
    }
  });

  it('offers no node settings for other failures', () => {
    render(<QdnPublishWindow enabled />);
    const id = startPublish('hidden');
    act(() => {
      notePublishRowFailed(id, 0, 'Not enough QORT for the publish fee');
      finishPublishJob(id);
    });
    expect(
      screen.queryByRole('button', { name: 'Open node settings' })
    ).toBeNull();
  });

  it('shows nothing while GO is locked', () => {
    render(<QdnPublishWindow enabled={false} />);
    startPublish('hidden');
    expect(screen.queryByTestId('qdn-publish-window')).toBeNull();
    expect(screen.queryByTestId('qdn-publish-bubble')).toBeNull();
  });
});
