import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';

const mockExecuteEvent = vi.fn();
vi.mock('../../../utils/events', () => ({
  executeEvent: (...args: unknown[]) => mockExecuteEvent(...args),
  subscribeToEvent: vi.fn(),
  unsubscribeFromEvent: vi.fn(),
}));

const setShareTarget = vi.fn(async (_target: string) => undefined);
vi.mock('../../../plugins/ShareReceiver', () => ({
  ShareReceiver: {
    setShareTarget: (target: string) => setShareTarget(target),
    getPendingShare: vi.fn(async () => []),
    consumeSharedFile: vi.fn(async () => undefined),
    addShareListener: vi.fn(async () => null),
  },
  isShareReceiverAvailable: () => false,
}));

vi.mock('./TorqTextEditor', () => ({
  TorqTextEditor: () => <div data-testid="torq-editor" />,
}));

i18n.init({
  lng: 'en',
  fallbackLng: 'en',
  resources: {
    en: {
      group: {
        home_composer: {
          action_compose: 'compose',
          action_rev: 'Rev',
          rev_aria: 'make a Rev in Torq',
          open_app: 'open {{app}}',
          post_to: 'post to {{app}}',
          subtitle_quitter: 'quitter subtitle',
          subtitle_torq: 'torq subtitle',
          target_label: 'publish to',
          try_torq: 'try Torq',
          switch_to_torq: 'switch to Torq',
        },
      },
      core: { action: { hide: 'hide', publish: 'publish' } },
    },
  },
  interpolation: { escapeValue: false },
});

import { getDefaultStore } from 'jotai';
import { userInfoAtom } from '../../../atoms/global';
import { composerTargetAtom } from './composerTarget';
import { HomeQuitterComposer } from './HomeQuitterComposer';
import {
  clearQuitterComposerSession,
  patchQuitterComposerSession,
} from './quitterComposerSession';

const renderComposer = () =>
  render(
    <ThemeProvider theme={createTheme()}>
      <I18nextProvider i18n={i18n}>
        <HomeQuitterComposer />
      </I18nextProvider>
    </ThemeProvider>
  );

beforeEach(() => {
  mockExecuteEvent.mockClear();
  setShareTarget.mockClear();
  localStorage.clear();
  clearQuitterComposerSession();
  patchQuitterComposerSession({ expanded: true });
  getDefaultStore().set(userInfoAtom, { name: 'Alice' } as any);
  getDefaultStore().set(composerTargetAtom, 'quitter');
});

const switchOrder = () =>
  within(screen.getByRole('group', { name: 'Publish to' }))
    .getAllByRole('button')
    .map((button) => button.textContent);

describe('HomeQuitterComposer target', () => {
  it('lists the chosen app first and follows a switch to Torq', () => {
    renderComposer();
    expect(switchOrder()).toEqual(['Quitter', 'Torq']);

    fireEvent.click(screen.getByRole('button', { name: 'Torq' }));

    expect(switchOrder()).toEqual(['Torq', 'Quitter']);
    expect(getDefaultStore().get(composerTargetAtom)).toBe('torq');
    expect(localStorage.getItem('go-home-composer-target')).toBe('torq');
    expect(setShareTarget).toHaveBeenCalledWith('torq');
    expect(screen.getByText('Post to Torq')).toBeInTheDocument();
  });

  it('opens the chosen app from the logo beside the composer', () => {
    getDefaultStore().set(composerTargetAtom, 'torq');
    renderComposer();
    fireEvent.click(screen.getByRole('button', { name: 'Open Torq' }));
    expect(mockExecuteEvent).toHaveBeenCalledWith('addTab', {
      data: { identifier: '', name: 'Torq', service: 'APP' },
    });
    expect(mockExecuteEvent).toHaveBeenCalledWith('open-apps-mode', {});
  });

  it("offers a Rev only with Torq, opening Torq's Rev editor", () => {
    renderComposer();
    expect(
      screen.queryByRole('button', { name: 'Make a Rev in Torq' })
    ).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Torq' }));
    fireEvent.click(screen.getByRole('button', { name: 'Make a Rev in Torq' }));
    expect(mockExecuteEvent).toHaveBeenCalledWith('addTab', {
      data: {
        identifier: '',
        name: 'Torq',
        navigateIfAlreadyOpen: true,
        path: 'rev/new',
        service: 'APP',
      },
    });
    expect(mockExecuteEvent).toHaveBeenCalledWith('open-apps-mode', {});
  });
});
