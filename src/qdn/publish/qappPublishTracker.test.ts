import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/i18n';
import { NodeApiKeyRequiredError } from './nodeAnswer';
import {
  getPublishWindowSnapshot,
  resetPublishWindowForTests,
} from './publishJobs';
import {
  publishResourceBytes,
  publishResourceLabel,
  startQappPublishTracker,
} from './qappPublishTracker';

const app = { tabId: 'tab-1', name: 'Q-Share', service: 'APP' };

describe('Q-App publish tracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetPublishWindowForTests();
  });

  afterEach(() => {
    resetPublishWindowForTests();
    vi.useRealTimers();
  });

  it('lists nothing for GO’s own publishes', () => {
    expect(
      startQappPublishTracker({ name: 'Qortal GO', internal: true }, [
        { service: 'IMAGE', base64: 'aGVsbG8=' },
      ])
    ).toBeNull();
    expect(startQappPublishTracker(null, [{ service: 'IMAGE' }])).toBeNull();
    expect(getPublishWindowSnapshot().jobs).toHaveLength(0);
  });

  it('lists a Q-App publish with what each resource is called', () => {
    const tracker = startQappPublishTracker(app, [
      { service: 'VIDEO', file: new File([new Uint8Array(10)], 'clip.mp4') },
      { service: 'DOCUMENT', identifier: 'qshare_details', base64: 'aGVsbG8=' },
    ]);
    expect(tracker).not.toBeNull();
    const [job] = getPublishWindowSnapshot().jobs;
    expect(job).toMatchObject({ tabId: 'tab-1', appName: 'Q-Share' });
    expect(job.rows.map((row) => [row.label, row.bytes])).toEqual([
      ['clip.mp4', 10],
      ['qshare_details', 6],
    ]);
  });

  it('follows the publish through to the end', () => {
    const tracker = startQappPublishTracker(app, [
      { service: 'FILE', file: new Blob(['x']) },
    ])!;
    tracker.rowStarted(0);
    tracker.progressFor(0)({
      stage: 'uploading',
      sentChunks: 1,
      totalChunks: 1,
    });
    tracker.rowFailed(0, new Error('Not enough QORT'));
    tracker.finish();
    const [job] = getPublishWindowSnapshot().jobs;
    // A small quick publish is never shown, so it is gone at once.
    expect(job).toBeUndefined();
  });

  it('shows a quick publish the node refused for want of its API key', () => {
    const tracker = startQappPublishTracker(app, [
      { service: 'DOCUMENT_PRIVATE', base64: 'aGVsbG8=' },
    ])!;
    tracker.rowStarted(0);
    tracker.rowFailed(0, new NodeApiKeyRequiredError());
    tracker.finish();
    const { jobs, view } = getPublishWindowSnapshot();
    // Opened, with the way to node settings, however small and quick.
    expect(view).toBe('expanded');
    expect(jobs[0]).toMatchObject({ outcome: 'failed', shown: true });
    expect(jobs[0].rows[0]).toMatchObject({
      state: 'failed',
      needsNodeKey: true,
      error: 'Your node needs its API key to publish. Add it in node settings.',
    });
  });

  it('knows the key refusal behind a reason given as text', () => {
    const tracker = startQappPublishTracker(app, [
      { service: 'IMAGE', base64: 'aGVsbG8=' },
      { service: 'DOCUMENT', base64: 'aGVsbG8=' },
    ])!;
    tracker.rowFailed(0, 'Not enough QORT', new Error('Not enough QORT'));
    tracker.rowFailed(1, 'Needs the key', new NodeApiKeyRequiredError());
    const [job] = getPublishWindowSnapshot().jobs;
    expect(job.rows.map((row) => row.needsNodeKey)).toEqual([false, true]);
  });

  it('names and sizes resources the way a person would know them', () => {
    expect(
      publishResourceLabel({ filename: ' report.pdf ', title: 'Report' })
    ).toBe('report.pdf');
    expect(publishResourceLabel({ title: 'Holiday', identifier: 'x' })).toBe(
      'Holiday'
    );
    expect(publishResourceLabel({ service: 'JSON' })).toBe('JSON');
    // A Blob with a name (GO's File may not be the real File class).
    const named = Object.assign(new Blob(['abc']), { name: 'song.m4a' });
    expect(publishResourceLabel({ file: named })).toBe('song.m4a');
    expect(publishResourceBytes({ blob: new Blob(['abcd']) })).toBe(4);
    expect(publishResourceBytes({ data64: 'aGVsbG8gd29ybGQ=' })).toBe(12);
    expect(publishResourceBytes({})).toBe(0);
  });
});
