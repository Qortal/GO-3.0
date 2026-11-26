import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DirectFriendEventRow } from './DirectFriendEventRow';

const ME = 'QmeAddressXXXXXXXXXXXXXXXXXXXXXXXX';
const PEER = 'QpeerAddressXXXXXXXXXXXXXXXXXXXXXX';

const message = (actor: string, target: string, callsAvailable: boolean) => ({
  dmFriendEvent: {
    actorAddress: actor,
    actorName: actor === ME ? 'Me' : 'Friend',
    targetAddress: target,
    targetName: target === ME ? 'Me' : 'Friend',
    callsAvailable,
  },
});

describe('DirectFriendEventRow', () => {
  it('keeps the "add them back" hint while only one side added', () => {
    render(
      <DirectFriendEventRow message={message(PEER, ME, false)} myAddress={ME} />
    );
    expect(screen.getByText(/Add them back to enable calls/)).toBeTruthy();
  });

  it('reads plainly once the other side added back too', () => {
    render(
      <DirectFriendEventRow
        message={message(PEER, ME, false)}
        myAddress={ME}
        mutual
      />
    );
    expect(screen.getByText('Friend added you as a friend.')).toBeTruthy();
    render(
      <DirectFriendEventRow
        message={message(ME, PEER, false)}
        myAddress={ME}
        mutual
      />
    );
    expect(screen.getByText('You added Friend as a friend.')).toBeTruthy();
  });

  it('the event that completed the friendship still says calling is available', () => {
    render(
      <DirectFriendEventRow
        message={message(ME, PEER, true)}
        myAddress={ME}
        mutual
      />
    );
    expect(screen.getByText(/Calling is now available/)).toBeTruthy();
  });
});
