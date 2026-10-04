import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NODE = 'http://127.0.0.1:12391';
const TRACKER_HOST = 'tracker.example';

vi.mock('../../../utils/globalApi', () => ({
  getBaseApiReact: () => 'http://127.0.0.1:12391',
  getBaseApiReactForAvatar: () => 'http://127.0.0.1:12391',
}));
vi.mock('../../../App', async () => {
  const { createContext } = await import('react');
  return {
    QORTAL_APP_CONTEXT: createContext({ downloadResource: () => undefined }),
  };
});
vi.mock('../../../utils/events', () => ({ executeEvent: vi.fn() }));
vi.mock('../../../qortinoAgent/qortinoMediaActions', () => ({
  saveQdnMediaToDevice: vi.fn(),
}));
vi.mock('../../../qortinoAgent/qdnMediaShelf', () => ({
  formatShelfShareText: vi.fn(() => ''),
  saveMediaShelf: vi.fn(() => null),
}));
vi.mock('../earbumpSharedAudio', () => ({
  stopSharedEarbumpPlayback: vi.fn(),
}));
vi.mock('./QortinoVideoPlayer', () => ({ QortinoVideoPlayer: () => null }));
vi.mock('./QortinoAudioPlayer', () => ({ QortinoAudioPlayer: () => null }));
vi.mock('./QortinoNameAction', () => ({ QortinoNameAction: () => null }));
vi.mock('./QortinoZoomableImage', () => ({
  QortinoZoomableImage: () => null,
}));

import { executeEvent } from '../../../utils/events';
import { setCurrentNodeBaseResolver } from '../../../utils/remoteContentPolicy';
import type { QdnMediaItem } from '../../../qortinoAgent/qdnMedia';
import { QortinoMediaCards } from './QortinoMediaCards';

const DOCUMENT: QdnMediaItem = {
  kind: 'file',
  name: 'Publisher',
  service: 'DOCUMENT',
  identifier: 'annual-report-2026',
  title: 'Annual report',
};
const FILE: QdnMediaItem = {
  kind: 'file',
  name: 'Publisher',
  service: 'FILE',
  identifier: 'notes-archive',
  title: 'Notes archive',
};
const VIDEO: QdnMediaItem = {
  kind: 'video',
  name: 'Publisher',
  service: 'VIDEO',
  identifier: 'qtube_vid_tracker',
  title: 'Tracked video',
};

const PDF_BYTES = '%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n';

let fetchMock: ReturnType<typeof vi.fn>;
const fetchedUrls = () => fetchMock.mock.calls.map(([input]) => String(input));

beforeEach(() => {
  setCurrentNodeBaseResolver(() => NODE);
  vi.mocked(executeEvent).mockClear();
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    // Q-Tube metadata whose poster sits on a tracking host.
    if (url.includes('/arbitrary/DOCUMENT/Publisher/qtube_vid_tracker')) {
      return new Response(
        JSON.stringify({ videoImage: `https://${TRACKER_HOST}/p.gif` }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('/arbitrary/resource/status/')) {
      return new Response(JSON.stringify({ status: 'READY' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === `${NODE}/arbitrary/DOCUMENT/Publisher/annual-report-2026`) {
      return new Response(PDF_BYTES, {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
    }
    return new Response('', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 30));

describe('QortinoMediaCards outside contact', () => {
  it('downloads and parses no document before a tap and shows no third-party poster', async () => {
    const { container } = render(
      createElement(QortinoMediaCards, {
        items: [DOCUMENT, FILE, VIDEO],
        layout: 'list',
      })
    );

    // The video poster lookup runs (metadata comes from the node)…
    await waitFor(() =>
      expect(
        fetchedUrls().some((url) => url.includes('qtube_vid_tracker_metadata'))
      ).toBe(true)
    );
    await flush();

    // …but nothing touches the documents until they are tapped.
    for (const url of fetchedUrls()) {
      expect(url.startsWith(`${NODE}/`)).toBe(true);
      expect(url).not.toContain('annual-report-2026');
      expect(url).not.toContain('notes-archive');
      expect(url).not.toContain(TRACKER_HOST);
    }
    const imageSources = [...container.querySelectorAll('img')].map(
      (img) => img.getAttribute('src') ?? ''
    );
    for (const src of imageSources) {
      expect(src).not.toContain(TRACKER_HOST);
      expect(src.startsWith(`${NODE}/`)).toBe(true);
    }
    expect(executeEvent).not.toHaveBeenCalled();
  });

  it('opens a tapped PDF without a .pdf name in the viewer, by its bytes', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(createElement(QortinoMediaCards, { items: [DOCUMENT] }));
    expect(screen.getByText('File')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Annual report'));

    await waitFor(() =>
      expect(executeEvent).toHaveBeenCalledWith(
        'openPdf',
        expect.objectContaining({ title: 'Annual report' })
      )
    );
    expect(
      fetchedUrls().filter(
        (url) =>
          url === `${NODE}/arbitrary/DOCUMENT/Publisher/annual-report-2026`
      )
    ).toHaveLength(1);
    const payload = vi.mocked(executeEvent).mock.calls[0][1] as {
      blob: Blob;
    };
    expect(payload.blob.type).toBe('application/pdf');
    expect(open).not.toHaveBeenCalled();
    // The card now says what it is.
    await waitFor(() => expect(screen.getByText('PDF')).toBeInTheDocument());
    open.mockRestore();
  });
});
