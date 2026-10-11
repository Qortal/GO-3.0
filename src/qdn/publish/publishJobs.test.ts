import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_WINDOW_ANSWER_MS,
  beginPublishJob,
  dismissPublishWindow,
  expandPublishWindow,
  finishPublishJob,
  getPublishWindowSnapshot,
  minimizePublishWindow,
  noteAppWindow,
  notePublishProgress,
  notePublishRowBytes,
  notePublishRowFailed,
  notePublishRowPublished,
  notePublishRowStarted,
  publishJobProgress,
  publishJobSecondsLeft,
  PUBLISH_WINDOW_SLOW_MS,
  PUBLISHED_LINGER_EXPANDED_MS,
  PUBLISHED_LINGER_MS,
  QDN_PUBLISH_APP_WINDOW_EVENT,
  resetPublishWindowForTests,
  type AppWindowCommandDetail,
} from './publishJobs';
import { QDN_PUBLISH_CHUNK_BYTES } from './publishProgress';

const MB = 1024 * 1024;

const commands: AppWindowCommandDetail[] = [];
const onCommand = (event: Event) =>
  commands.push((event as CustomEvent<AppWindowCommandDetail>).detail);

const begin = (bytes: number[], tabId = 'tab-1') =>
  beginPublishJob({
    tabId,
    appName: 'Q-Share',
    appService: 'APP',
    rows: bytes.map((size, index) => ({
      service: index === 0 ? 'FILE' : 'DOCUMENT',
      label: `file-${index}`,
      bytes: size,
    })),
  });

const job = (id: string) =>
  getPublishWindowSnapshot().jobs.find((item) => item.id === id)!;

describe('publish window store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetPublishWindowForTests();
    commands.length = 0;
    document.addEventListener(QDN_PUBLISH_APP_WINDOW_EVENT, onCommand);
  });

  afterEach(() => {
    document.removeEventListener(QDN_PUBLISH_APP_WINDOW_EVENT, onCommand);
    resetPublishWindowForTests();
    vi.useRealTimers();
  });

  it('leaves a small quick publish off the screen', () => {
    const id = begin([2048]);
    expect(job(id).shown).toBe(false);
    notePublishProgress(id, 0, {
      stage: 'uploading',
      sentChunks: 0,
      totalChunks: 1,
    });
    notePublishProgress(id, 0, { stage: 'processing' });
    notePublishProgress(id, 0, { stage: 'published' });
    finishPublishJob(id);
    vi.advanceTimersByTime(PUBLISH_WINDOW_SLOW_MS * 2);
    expect(getPublishWindowSnapshot().jobs).toHaveLength(0);
    expect(getPublishWindowSnapshot().view).toBe('closed');
    expect(commands).toHaveLength(0);
  });

  it('takes a big publish over at once and asks the app to hide its window', () => {
    const id = begin([40 * MB, 1200]);
    expect(job(id).shown).toBe(true);
    expect(commands).toEqual([{ tabId: 'tab-1', jobId: id, command: 'hide' }]);
    // No answer yet: nothing decided.
    expect(getPublishWindowSnapshot().view).toBe('closed');
  });

  it('opens the window where the app’s own one was hidden', () => {
    const id = begin([40 * MB]);
    noteAppWindow(id, 'hidden');
    expect(getPublishWindowSnapshot().view).toBe('expanded');
  });

  it('shows only the bubble when the app had no window to hide', () => {
    const id = begin([40 * MB]);
    noteAppWindow(id, 'none');
    expect(getPublishWindowSnapshot().view).toBe('minimized');
  });

  it('falls back to the bubble when the frame never answers', () => {
    begin([40 * MB]);
    vi.advanceTimersByTime(APP_WINDOW_ANSWER_MS);
    expect(getPublishWindowSnapshot().view).toBe('minimized');
  });

  it('still opens the window for an app window that showed up late', () => {
    const id = begin([40 * MB]);
    vi.advanceTimersByTime(APP_WINDOW_ANSWER_MS);
    expect(getPublishWindowSnapshot().view).toBe('minimized');
    noteAppWindow(id, 'hidden');
    expect(getPublishWindowSnapshot().view).toBe('expanded');
  });

  it('keeps the person’s own choice over a late answer', () => {
    vi.setSystemTime(10_000);
    const id = begin([40 * MB]);
    vi.advanceTimersByTime(APP_WINDOW_ANSWER_MS);
    expandPublishWindow();
    minimizePublishWindow();
    noteAppWindow(id, 'hidden');
    expect(getPublishWindowSnapshot().view).toBe('minimized');
  });

  it('takes a small publish over once it turns out slow', () => {
    const id = begin([3000]);
    vi.advanceTimersByTime(PUBLISH_WINDOW_SLOW_MS - 1);
    expect(job(id).shown).toBe(false);
    vi.advanceTimersByTime(1);
    expect(job(id).shown).toBe(true);
    expect(commands.map((c) => c.command)).toEqual(['hide']);
  });

  it('takes a publish over once a late-known file turns out big', () => {
    const id = begin([0]);
    notePublishRowBytes(id, 0, 30 * MB);
    expect(job(id).shown).toBe(true);
  });

  it('follows the parts of each file', () => {
    const id = begin([12 * MB, 400]);
    notePublishRowStarted(id, 0);
    expect(job(id).rows[0].state).toBe('preparing');
    notePublishProgress(id, 0, {
      stage: 'uploading',
      sentChunks: 1,
      totalChunks: 3,
    });
    expect(job(id).rows[0]).toMatchObject({
      state: 'uploading',
      sentChunks: 1,
      totalChunks: 3,
    });
    expect(publishJobProgress(job(id)).sentBytes).toBe(QDN_PUBLISH_CHUNK_BYTES);
    notePublishProgress(id, 0, { stage: 'retrying' });
    expect(job(id).rows[0].retrying).toBe(true);
    notePublishProgress(id, 0, {
      stage: 'uploading',
      sentChunks: 3,
      totalChunks: 3,
    });
    expect(job(id).rows[0].retrying).toBe(false);
    expect(publishJobProgress(job(id)).sentBytes).toBe(12 * MB);
    notePublishProgress(id, 0, { stage: 'processing' });
    notePublishRowPublished(id, 0);
    expect(job(id).rows[0].state).toBe('published');
    // A settled row ignores late news.
    notePublishProgress(id, 0, {
      stage: 'uploading',
      sentChunks: 0,
      totalChunks: 3,
    });
    expect(job(id).rows[0].state).toBe('published');
    const { fraction } = publishJobProgress(job(id));
    expect(fraction).toBeCloseTo((12 * MB) / (12 * MB + 400));
  });

  it('measures the speed and the time left', () => {
    vi.setSystemTime(0);
    const id = begin([50 * MB]);
    notePublishProgress(
      id,
      0,
      { stage: 'uploading', sentChunks: 0, totalChunks: 10 },
      0
    );
    notePublishProgress(
      id,
      0,
      { stage: 'uploading', sentChunks: 1, totalChunks: 10 },
      2_000
    );
    notePublishProgress(
      id,
      0,
      { stage: 'uploading', sentChunks: 2, totalChunks: 10 },
      4_000
    );
    // 10 MB in 4 s.
    expect(job(id).speed).toBeCloseTo((10 * MB) / 4);
    expect(publishJobSecondsLeft(job(id))).toBeCloseTo(16);
  });

  it('hands the app its window back and goes once published', () => {
    const id = begin([40 * MB]);
    noteAppWindow(id, 'hidden');
    notePublishRowPublished(id, 0);
    finishPublishJob(id);
    expect(job(id).outcome).toBe('published');
    expect(commands.map((c) => c.command)).toEqual(['hide', 'release']);
    expect(getPublishWindowSnapshot().view).toBe('expanded');
    vi.advanceTimersByTime(PUBLISHED_LINGER_MS);
    expect(getPublishWindowSnapshot().jobs).toHaveLength(0);
    expect(getPublishWindowSnapshot().view).toBe('closed');
  });

  it('leaves the open window sooner than the bubble after a success', () => {
    const open = begin([40 * MB]);
    noteAppWindow(open, 'hidden');
    notePublishRowPublished(open, 0);
    finishPublishJob(open);
    vi.advanceTimersByTime(PUBLISHED_LINGER_EXPANDED_MS);
    expect(getPublishWindowSnapshot().view).toBe('closed');

    const bubble = begin([40 * MB]);
    noteAppWindow(bubble, 'none');
    notePublishRowPublished(bubble, 0);
    finishPublishJob(bubble);
    vi.advanceTimersByTime(PUBLISHED_LINGER_EXPANDED_MS);
    expect(getPublishWindowSnapshot().view).toBe('minimized');
    vi.advanceTimersByTime(PUBLISHED_LINGER_MS - PUBLISHED_LINGER_EXPANDED_MS);
    expect(getPublishWindowSnapshot().view).toBe('closed');
  });

  it('takes a frame’s answer for its own tab only', () => {
    const id = begin([40 * MB], 'tab-1');
    noteAppWindow(id, 'hidden', 'tab-2');
    expect(job(id).appWindow).toBe('unknown');
    noteAppWindow(id, 'hidden', 'tab-1');
    expect(job(id).appWindow).toBe('hidden');
  });

  it('keeps a failure on screen until dismissed', () => {
    const id = begin([40 * MB, 100]);
    noteAppWindow(id, 'none');
    notePublishRowPublished(id, 0);
    notePublishRowFailed(id, 1, 'Not enough QORT');
    finishPublishJob(id);
    expect(job(id).outcome).toBe('partial');
    expect(job(id).rows[1].error).toBe('Not enough QORT');
    vi.advanceTimersByTime(PUBLISHED_LINGER_MS * 3);
    expect(getPublishWindowSnapshot().view).toBe('minimized');
    dismissPublishWindow();
    expect(getPublishWindowSnapshot().jobs).toHaveLength(0);
    expect(getPublishWindowSnapshot().view).toBe('closed');
  });

  it('marks what never settled as failed, or stopped when cancelled', () => {
    const failed = begin([40 * MB]);
    finishPublishJob(failed);
    expect(job(failed)).toMatchObject({ outcome: 'failed' });
    expect(job(failed).rows[0].state).toBe('failed');

    const stopped = begin([40 * MB]);
    finishPublishJob(stopped, { aborted: true });
    expect(job(stopped)).toMatchObject({ outcome: 'cancelled' });
    expect(job(stopped).rows[0].state).toBe('cancelled');
  });

  it('a dismissed window leaves a running publish in the bubble', () => {
    const done = begin([40 * MB]);
    noteAppWindow(done, 'hidden');
    finishPublishJob(done);
    const running = begin([40 * MB], 'tab-2');
    noteAppWindow(running, 'hidden');
    dismissPublishWindow();
    const snapshot = getPublishWindowSnapshot();
    expect(snapshot.jobs.map((item) => item.id)).toEqual([running]);
    expect(snapshot.view).toBe('minimized');
  });

  it('does not open or close a window with nothing in it', () => {
    expandPublishWindow();
    minimizePublishWindow();
    expect(getPublishWindowSnapshot().view).toBe('closed');
  });
});
