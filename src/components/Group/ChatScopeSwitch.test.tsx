import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { darkTheme } from '../../styles/theme-dark';
import { ChatScopeSwitch } from './ChatScopeSwitch';

const i18n = createInstance();
void i18n.init({
  lng: 'en',
  resources: {
    en: {
      reticulum: {
        chat_scope: {
          direct_messages: 'DMs',
          groups: 'Groups',
          label: 'Show groups or direct messages',
        },
      },
    },
  },
});

const renderSwitch = (
  props: Partial<Parameters<typeof ChatScopeSwitch>[0]> = {}
) => {
  const onChange = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={darkTheme}>
        <ChatScopeSwitch onChange={onChange} value="groups" {...props} />
      </ThemeProvider>
    </I18nextProvider>
  );
  return onChange;
};

describe('ChatScopeSwitch', () => {
  it('shows translated labels on full-height segments', () => {
    renderSwitch();

    expect(
      screen.getByRole('group', { name: 'Show groups or direct messages' })
    ).toBeInTheDocument();
    const groups = screen.getByRole('button', { name: 'Groups' });
    const directs = screen.getByRole('button', { name: 'DMs' });
    expect(groups).toHaveAttribute('aria-pressed', 'true');
    expect(directs).toHaveAttribute('aria-pressed', 'false');
    // The whole segment is the touch target, not just the pill inside it.
    expect(groups).toHaveStyle({ fontSize: '14px', height: '44px' });
    expect(directs).toHaveStyle({ height: '44px' });
    // The track pads only the sides, so its height is all segment.
    const track = groups.parentElement as HTMLElement;
    expect(track).toHaveStyle({ paddingLeft: '2px', paddingRight: '2px' });
    expect(track).not.toHaveStyle({ paddingTop: '2px' });
  });

  it('anchors the onboarding DM step on the DMs segment', () => {
    renderSwitch();

    expect(screen.getByRole('button', { name: 'DMs' })).toHaveAttribute(
      'data-tour',
      'hub-direct-messages'
    );
    expect(screen.getByRole('button', { name: 'Groups' })).not.toHaveAttribute(
      'data-tour'
    );
  });

  it('switches scope only from the inactive segment', () => {
    const onChange = renderSwitch();

    fireEvent.click(screen.getByRole('button', { name: 'Groups' }));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'DMs' }));
    expect(onChange).toHaveBeenCalledWith('directs');
  });

  it('keeps the unread count out of the DMs label', () => {
    renderSwitch({ directHasUnread: true, directUnreadCount: 3 });

    expect(screen.getByRole('button', { name: 'DMs' })).toBeInTheDocument();
  });
});
