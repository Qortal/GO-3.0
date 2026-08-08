import { describe, expect, it } from 'vitest';
import {
  averageLtcPerQortFromTrades,
  QORT_PRICE_OFFLINE_NUDGE,
} from '../qdnQortPrice';
import { isQortPriceQuery } from '../queryIntent';
import { matchGoldenAnswer } from '../goldenMatch';

describe('qdnQortPrice', () => {
  it('averages LTC per QORT from trade rows', () => {
    const { ltcPerQort, tradeCount } = averageLtcPerQortFromTrades([
      { qortAmount: '10', foreignAmount: '1' }, // 0.1 LTC/QORT
      { qortAmount: '10', foreignAmount: '2' }, // 0.2 LTC/QORT
    ]);
    expect(tradeCount).toBe(2);
    // (1+2)/(10+10) = 0.15
    expect(ltcPerQort).toBeCloseTo(0.15, 8);
  });

  it('ignores junk trade rows', () => {
    const { ltcPerQort, tradeCount } = averageLtcPerQortFromTrades([
      { qortAmount: '0', foreignAmount: '1' },
      { qortAmount: 'bad', foreignAmount: '1' },
    ]);
    expect(tradeCount).toBe(0);
    expect(ltcPerQort).toBe(0);
  });

  it('offline nudge tells user to open QDN', () => {
    expect(QORT_PRICE_OFFLINE_NUDGE.toLowerCase()).toMatch(/qdn/);
    expect(QORT_PRICE_OFFLINE_NUDGE.toLowerCase()).toMatch(/switch|open/);
  });
});

describe('QORT price routing', () => {
  it('detects LTC price paraphrases', () => {
    expect(isQortPriceQuery('what is the price of QORT')).toBe(true);
    expect(isQortPriceQuery('QORT to LTC')).toBe(true);
    expect(isQortPriceQuery('LTC per QORT')).toBe(true);
    expect(isQortPriceQuery('what is QORT')).toBe(false);
  });

  it('golden FAQ points to QDN for live LTC quote', () => {
    const m = matchGoldenAnswer('what is the price of QORT', {
      minScore: 0.55,
    });
    expect(m?.entry.id).toBe('qortal-210');
    expect(m!.entry.a.toLowerCase()).toMatch(/qdn/);
    expect(m!.entry.a.toLowerCase()).toMatch(/ltc/);
  });
});
