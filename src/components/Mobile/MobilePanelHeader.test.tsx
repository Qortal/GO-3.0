import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import EventRoundedIcon from '@mui/icons-material/EventRounded';
import '../../i18n/i18n';
import { MobilePanelHeader } from './MobilePanelHeader';

describe('MobilePanelHeader', () => {
  it('shows the title, the action, and an X that closes the panel', () => {
    const onClose = vi.fn();
    render(
      <MobilePanelHeader
        icon={<EventRoundedIcon />}
        title="Group Calendar"
        actions={<button type="button">Add event</button>}
        onClose={onClose}
      />
    );
    expect(
      screen.getByRole('heading', { name: 'Group Calendar' })
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add event' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the X as the last control, after the action', () => {
    render(
      <MobilePanelHeader
        icon={<EventRoundedIcon />}
        title="Qortal Land"
        actions={<button type="button">Group Call</button>}
        onClose={vi.fn()}
      />
    );
    const buttons = screen.getAllByRole('button');
    expect(
      buttons.map(
        (button) => button.getAttribute('aria-label') ?? button.textContent
      )
    ).toEqual(['Group Call', 'Close']);
  });
});
