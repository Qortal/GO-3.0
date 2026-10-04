import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GO_INTERNAL_APP_INFO,
  requestingAppFromAppInfo,
} from '../../../utils/qappApproval';
import { publishMultipleResources } from './quitterPublish';

// A Quitter post is the user's own action in GO: the publish approval names
// GO itself instead of warning about an unknown Q-App.

const sendMessage = vi.fn();

afterEach(() => {
  sendMessage.mockReset();
  delete (window as unknown as { sendMessage?: unknown }).sendMessage;
});

describe('Quitter publish attribution', () => {
  it('sends PUBLISH_MULTIPLE_QDN_RESOURCES as GO, not as an unknown Q-App', async () => {
    sendMessage.mockResolvedValue({ success: true });
    (window as unknown as { sendMessage: unknown }).sendMessage = sendMessage;
    const resources = [{ service: 'DOCUMENT', identifier: 'q', name: 'me' }];

    await publishMultipleResources(resources);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [action, payload, , isExtension, appInfo] = sendMessage.mock.calls[0];
    expect(action).toBe('PUBLISH_MULTIPLE_QDN_RESOURCES');
    expect(payload).toEqual({ resources });
    expect(isExtension).toBe(true);
    expect(appInfo).toBe(GO_INTERNAL_APP_INFO);
    expect(requestingAppFromAppInfo(appInfo)).toEqual({
      name: '',
      service: null,
      internal: true,
    });
  });
});
