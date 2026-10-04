import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openSavedMobileFile: vi.fn(async (..._args: unknown[]) => true),
}));

vi.mock('../../plugins/QortalBackground', () => ({
  QortalBackground: {
    showTransferNotification: vi.fn(async () => ({ success: true })),
    dismissTransferNotification: vi.fn(async () => ({ success: true })),
  },
}));
vi.mock('../../utils/platform', () => ({ isCapacitor: () => true }));
vi.mock('../../utils/mobileFileSave', () => ({
  openSavedMobileFile: mocks.openSavedMobileFile,
}));

import '../../i18n/i18n';
import { SavedQdnFileRow } from './QdnDownloadsNotice';

const savedAt = Date.UTC(2026, 9, 1, 12, 0, 0);

// N-31: a saved app package is listed with where it went, never as
// "ready to install" and with nothing that opens it.
describe('SavedQdnFileRow', () => {
  beforeEach(() => mocks.openSavedMobileFile.mockClear());

  it('lists a saved .apk as saved, with no Open or Install', () => {
    const { container } = render(
      <SavedQdnFileRow
        file={{
          id: 'saved:apk',
          filename: 'GO 3.0 v0.0.15.apk',
          location: 'Documents/Qortal Go/Apps',
          mimeType: 'application/zip',
          savedAt,
          seen: true,
        }}
        onOpened={() => undefined}
        onRemove={() => undefined}
      />
    );
    expect(
      screen.getByText(
        'Saved to Documents/Qortal Go/Apps. GO does not open app packages.'
      )
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /open|install/i })).toBeNull();
    expect(container.textContent || '').not.toMatch(/install/i);

    fireEvent.click(screen.getByText('GO 3.0 v0.0.15.apk'));
    expect(mocks.openSavedMobileFile).not.toHaveBeenCalled();
  });

  it('still offers Open for a PDF', () => {
    render(
      <SavedQdnFileRow
        file={{
          id: 'saved:pdf',
          filename: 'report.pdf',
          location: 'Documents/Qortal Go/Docs',
          uri: 'content://media/external_primary/file/9',
          mimeType: 'application/pdf',
          savedAt,
          seen: true,
        }}
        onOpened={() => undefined}
        onRemove={() => undefined}
      />
    );
    expect(
      screen.getByText('Ready to open · Documents/Qortal Go/Docs')
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(mocks.openSavedMobileFile).toHaveBeenCalledWith(
      'content://media/external_primary/file/9',
      'report.pdf',
      'application/pdf'
    );
  });
});
