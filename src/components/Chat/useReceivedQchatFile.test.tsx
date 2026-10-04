import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const files = vi.hoisted(() => ({
  statReceivedChatFile: vi.fn(),
  openReceivedChatFile: vi.fn(),
  saveReceivedChatFile: vi.fn(),
}));

vi.mock('../../utils/receivedChatFiles', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../utils/receivedChatFiles')>();
  return {
    ...actual,
    statReceivedChatFile: files.statReceivedChatFile,
    openReceivedChatFile: files.openReceivedChatFile,
    saveReceivedChatFile: files.saveReceivedChatFile,
  };
});

import { FileNameWithExtension } from './FileNameWithExtension';
import {
  receivedQchatFileState,
  useReceivedQchatFile,
} from './useReceivedQchatFile';

const PATH = '/data/user/0/app/files/qchat-received/u/photo.jpg';
const LEGACY = 'content://media/external/downloads/12';

describe('receivedQchatFileState', () => {
  it('combines the private copy and an older Downloads copy', () => {
    expect(receivedQchatFileState(true, false)).toBe('present');
    expect(receivedQchatFileState(true, true)).toBe('present');
    expect(receivedQchatFileState(false, true)).toBe('legacy');
    expect(receivedQchatFileState(null, true)).toBe('legacy');
    expect(receivedQchatFileState(false, false)).toBe('gone');
    expect(receivedQchatFileState(null, false)).toBe('unknown');
  });
});

describe('useReceivedQchatFile (N-22, N-27)', () => {
  let snacks: Array<{ message: string; type: string }>;
  const onSnack = (event: Event) => snacks.push((event as CustomEvent).detail);

  beforeEach(() => {
    snacks = [];
    document.addEventListener('openGlobalSnackBar', onSnack);
    files.statReceivedChatFile
      .mockReset()
      .mockResolvedValue({ exists: true, size: 3 });
    files.openReceivedChatFile
      .mockReset()
      .mockResolvedValue({ ok: true, via: 'viewer' });
    files.saveReceivedChatFile.mockReset().mockResolvedValue({
      ok: true,
      name: 'photo.jpg',
      location: 'Documents/Qortal Go/Images/photo.jpg',
      uri: 'content://media/external/file/3',
    });
  });

  afterEach(() => {
    document.removeEventListener('openGlobalSnackBar', onSnack);
  });

  it('checks nothing until the transfer is done on the phone', () => {
    const { result } = renderHook(() =>
      useReceivedQchatFile({ path: PATH, fileName: 'photo.jpg' }, false)
    );
    expect(result.current.state).toBe('unknown');
    expect(files.statReceivedChatFile).not.toHaveBeenCalled();
  });

  it('reports a file GO still holds, and one logout removed', async () => {
    const { result, rerender } = renderHook(
      ({ path }) => useReceivedQchatFile({ path, fileName: 'photo.jpg' }, true),
      { initialProps: { path: PATH } }
    );
    await waitFor(() => expect(result.current.state).toBe('present'));

    files.statReceivedChatFile.mockResolvedValue({ exists: false, size: 0 });
    rerender({ path: `${PATH}.2` });
    await waitFor(() => expect(result.current.state).toBe('gone'));
  });

  it('keeps an older build Downloads copy reachable', async () => {
    files.statReceivedChatFile.mockResolvedValue({ exists: false, size: 0 });
    const { result } = renderHook(() =>
      useReceivedQchatFile(
        { path: PATH, legacyUri: LEGACY, fileName: 'photo.jpg' },
        true
      )
    );
    await waitFor(() => expect(result.current.state).toBe('legacy'));
  });

  it('opens only on tap, and saves only on tap', async () => {
    const { result } = renderHook(() =>
      useReceivedQchatFile({ path: PATH, fileName: 'photo.jpg' }, true)
    );
    await waitFor(() => expect(result.current.state).toBe('present'));
    expect(files.openReceivedChatFile).not.toHaveBeenCalled();
    expect(files.saveReceivedChatFile).not.toHaveBeenCalled();

    await act(() => result.current.open());
    expect(files.openReceivedChatFile).toHaveBeenCalledWith({
      path: PATH,
      legacyUri: '',
      fileName: 'photo.jpg',
    });
    expect(files.saveReceivedChatFile).not.toHaveBeenCalled();

    await act(() => result.current.save());
    expect(files.saveReceivedChatFile).toHaveBeenCalledTimes(1);
    // Tests run without loaded translations: the key stands for the text.
    expect(snacks).toEqual([
      { message: 'core:file_transfer.saved_to', type: 'success' },
    ]);
  });

  it('marks a file gone when it is no longer there', async () => {
    files.openReceivedChatFile.mockResolvedValue({
      ok: false,
      reason: 'missing',
    });
    const { result } = renderHook(() =>
      useReceivedQchatFile({ path: PATH, fileName: 'photo.jpg' }, true)
    );
    await waitFor(() => expect(result.current.state).toBe('present'));
    await act(() => result.current.open());
    expect(result.current.state).toBe('gone');
    expect(snacks).toHaveLength(1);
    expect(snacks[0].type).toBe('info');
  });

  it('never offers to open an app package', async () => {
    const { result } = renderHook(() =>
      useReceivedQchatFile(
        {
          path: '/data/user/0/app/files/qchat-received/u/holidaygpj.apk',
          fileName: 'holiday\u202Egpj.apk',
        },
        true
      )
    );
    expect(result.current.isPackage).toBe(true);
  });
});

describe('FileNameWithExtension', () => {
  it('shows the real extension of a bidi-disguised name', () => {
    render(<FileNameWithExtension name={'holiday\u202Egpj.apk'} fallback="" />);
    expect(screen.getByText('holidaygpj')).toBeInTheDocument();
    expect(screen.getByText('.apk')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByTitle('holidaygpj.apk')).toBeInTheDocument();
  });

  it('falls back when nothing is left of the name', () => {
    render(<FileNameWithExtension name={'\u200B'} fallback="File transfer" />);
    expect(screen.getByText('File transfer')).toBeInTheDocument();
  });
});
