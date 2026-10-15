import { describe, expect, it } from 'vitest';
import i18n from '../../i18n/i18n';
import { NodeError } from '../../qortalCard/cardNode';
import { cardErrorText } from './cardErrorText';

describe('card error text', () => {
  it('turns a node NO_BALANCE into what to do next', () => {
    const t = i18n.t.bind(i18n);
    expect(
      cardErrorText(
        t,
        new NodeError('transaction invalid: insufficient balance (NO_BALANCE)')
      )
    ).toMatch(/wait for the next block/);
    expect(
      cardErrorText(t, new NodeError("Missing 'X-API-KEY' header"))
    ).toMatch(/Switch to your own node/);
    expect(cardErrorText(t, new NodeError('NAME_ALREADY_REGISTERED'))).toBe(
      'The node did not take it: NAME_ALREADY_REGISTERED'
    );
  });
});
