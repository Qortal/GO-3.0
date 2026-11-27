import { describe, expect, it } from 'vitest';
import { GroupCallAudioEngineRuntime } from './groupCallAudioEngineRuntime';

describe('group-call local root election authority', () => {
  function runtime(): any {
    const instance = Object.create(
      GroupCallAudioEngineRuntime.prototype
    ) as any;
    instance.userInfo = { address: 'Q-local' };
    instance.snapshot = {
      participants: [{ address: 'Q-local' }, { address: 'Q-peer' }],
    };
    instance.startupHydratedRemoteCount = 0;
    return instance;
  }

  it('does not mark the verified successor of a departed root as provisional', () => {
    expect(
      runtime().shouldMarkLocalRootProvisional('Q-departed', [
        'Q-local',
        'Q-peer',
      ])
    ).toBe(false);
  });

  it('does not make an established local root provisional during roster changes', () => {
    expect(
      runtime().shouldMarkLocalRootProvisional('Q-local', ['Q-local', 'Q-peer'])
    ).toBe(false);
  });

  it('marks an uncertain join-time self-election as provisional', () => {
    expect(
      runtime().shouldMarkLocalRootProvisional('', ['Q-local', 'Q-peer'])
    ).toBe(true);
  });

  it('marks a self-only Qortal group election provisional (an incumbent may not have reached us yet)', () => {
    const alone = runtime();
    alone.snapshot = {
      roomId: 'gcall-qortal-659',
      participants: [{ address: 'Q-local' }],
    };
    expect(alone.shouldMarkLocalRootProvisional('', ['Q-local'])).toBe(true);
  });

  it('keeps an established self-only root authoritative on later elections', () => {
    const alone = runtime();
    alone.snapshot = {
      roomId: 'gcall-qortal-659',
      participants: [{ address: 'Q-local' }],
    };
    expect(alone.shouldMarkLocalRootProvisional('Q-local', ['Q-local'])).toBe(
      false
    );
  });

  it('marks a conflicting election provisional while the prior root remains', () => {
    expect(
      runtime().shouldMarkLocalRootProvisional('Q-peer', ['Q-local', 'Q-peer'])
    ).toBe(true);
  });
});
