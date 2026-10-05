import { describe, expect, it, vi } from 'vitest';
import { MobileReticulumBridge } from './wireBridge';

// GO's chat engine marks a served DM page delivered only on the bridge's
// terminal event for that transfer, so the worker bridge must hand those
// events to the engine untouched, and the engine's DM-page answers must reach
// python with their logical type (it picks the dm-page lane from it).

function makeBridge(withStaging: boolean) {
  const calls: Array<{ action: string; payload: Record<string, unknown> }> = [];
  const sendCommand = vi.fn(
    async (action: string, payload: Record<string, unknown>) => {
      calls.push({ action, payload });
      return { ok: true };
    }
  );
  const staging = {
    discard: vi.fn(async () => undefined),
    completeInbound: vi.fn(async (nativePath: string) => `opfs:${nativePath}`),
    stageOutbound: vi.fn(async (filePath: string) => filePath),
    reserveInbound: vi.fn(async (savePath: string) => savePath),
  };
  const bridge = new MobileReticulumBridge(
    sendCommand,
    withStaging ? (staging as any) : undefined
  );
  bridge.markReady({});
  const received: Array<Record<string, unknown>> = [];
  bridge.on('reticulum-chat-resource', (payload) => received.push(payload));
  return { bridge, calls, received, staging };
}

describe('MobileReticulumBridge DM page delivery', () => {
  it.each([false, true])(
    'passes terminal page events to the engine (staging=%s)',
    (withStaging) => {
      const { bridge, received, staging } = makeBridge(withStaging);
      const sent = {
        status: 'sent',
        transferId: 'a1'.repeat(8),
        peerPresenceHash: 'b'.repeat(32),
        resourceType: 'reticulum_chat_event',
      };
      const failed = {
        status: 'failed',
        transferId: 'a2'.repeat(8),
        resourceType: 'reticulum_chat_event',
        reason: 'resource_session_closed',
      };
      bridge.dispatchPythonEvent('reticulum_chat_resource', sent);
      bridge.dispatchPythonEvent('reticulum_chat_resource', failed);
      expect(received).toEqual([sent, failed]);
      expect(staging.discard).not.toHaveBeenCalled();
    }
  );

  it('sends the DM-page logical type with authorize and reject', async () => {
    const { bridge, calls } = makeBridge(false);
    await bridge.authorizeReticulumChatResourceDetailed({
      linkId: 'link-1',
      transferId: 'c1'.repeat(8),
      logicalResourceType: 'reticulum_chat_dm_page',
    });
    await bridge.rejectReticulumChatResourceDetailed({
      linkId: 'link-2',
      transferId: 'c2'.repeat(8),
      reason: 'no_dm_events',
      logicalResourceType: 'reticulum_chat_dm_page',
    });
    expect(calls).toEqual([
      {
        action: 'authorize_reticulum_chat_resource',
        payload: {
          linkId: 'link-1',
          transferId: 'c1'.repeat(8),
          logicalResourceType: 'reticulum_chat_dm_page',
        },
      },
      {
        action: 'reject_reticulum_chat_resource',
        payload: {
          linkId: 'link-2',
          transferId: 'c2'.repeat(8),
          reason: 'no_dm_events',
          logicalResourceType: 'reticulum_chat_dm_page',
        },
      },
    ]);
  });
});
