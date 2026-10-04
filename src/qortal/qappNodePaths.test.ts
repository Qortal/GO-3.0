import { describe, expect, it, vi } from 'vitest';

vi.mock('i18next', () => ({
  default: { t: vi.fn((key: string) => key) },
}));

import {
  foreignCoinPathSegment,
  foreignCoinTicker,
  foreignFeeType,
  isArrrCoin,
  listNamePathSegment,
  nodeOriginForQApp,
  requireForeignCoinTicker,
  tradeBlockchainName,
} from './qappNodePaths';

describe('foreign coin allow-list', () => {
  it.each([
    ['BTC', 'btc'],
    ['bitcoin', 'btc'],
    ['LTC', 'ltc'],
    ['ltc', 'ltc'],
    ['LITECOIN', 'ltc'],
    ['DOGE', 'doge'],
    ['DGB', 'dgb'],
    ['RVN', 'rvn'],
    ['ARRR', 'arrr'],
    ['PIRATECHAIN', 'arrr'],
    [' Ltc ', 'ltc'],
  ])('maps %j to /crosschain/%s', (coin, segment) => {
    expect(foreignCoinPathSegment(coin)).toBe(segment);
  });

  it.each([
    '../admin/apikey/generate?x=',
    'ltc/../../admin/stop',
    'tradebot',
    'QORT',
    '',
    '__proto__',
    'constructor',
    undefined,
    7,
  ])('refuses %j as not supported', (coin) => {
    expect(foreignCoinTicker(coin)).toBeNull();
    expect(() => foreignCoinPathSegment(coin)).toThrow(
      'question:message.error.token_not_supported'
    );
    expect(() => requireForeignCoinTicker(coin)).toThrow();
  });

  it('recognises ARRR under every accepted spelling', () => {
    expect(isArrrCoin('ARRR')).toBe(true);
    expect(isArrrCoin('arrr')).toBe(true);
    expect(isArrrCoin('PIRATECHAIN')).toBe(true);
    expect(isArrrCoin('LTC')).toBe(false);
    expect(isArrrCoin(undefined)).toBe(false);
  });

  it('gives Core chain names for the trade activity query', () => {
    expect(tradeBlockchainName('LTC')).toBe('LITECOIN');
    expect(tradeBlockchainName('LITECOIN')).toBe('LITECOIN');
    expect(tradeBlockchainName('arrr')).toBe('PIRATECHAIN');
    expect(() => tradeBlockchainName('LITECOIN&apiKey=x')).toThrow(
      'question:message.error.token_not_supported'
    );
  });
});

describe('foreignFeeType', () => {
  it('accepts the two fee types Core serves', () => {
    expect(foreignFeeType('feekb')).toBe('feekb');
    expect(foreignFeeType('feerequired')).toBe('feerequired');
    expect(foreignFeeType('FeeKB')).toBe('feekb');
  });

  it.each([
    '../../admin/apikey/generate',
    '../tradebot',
    'walletbalance',
    'feekb/../../tradebot',
    '',
    undefined,
  ])('refuses %j', (type) => {
    expect(() => foreignFeeType(type)).toThrow(
      'question:message.error.invalid_type'
    );
  });
});

describe('listNamePathSegment', () => {
  it.each([
    ['blockedNames', 'blockedNames'],
    ['followedNames_q-tube', 'followedNames_q-tube'],
    ['blockedNames_Q-Blog', 'blockedNames_Q-Blog'],
    ['my list', 'my%20list'],
    ['a?b', 'a%3Fb'],
    ['a#b', 'a%23b'],
    ['a..b', 'a..b'],
  ])('accepts and encodes %j', (name, encoded) => {
    expect(listNamePathSegment(name)).toBe(encoded);
  });

  it.each([
    '..',
    '.',
    '.hidden',
    '../admin/apikey/generate',
    'a/b',
    'a\\b',
    'tab\tname',
    '',
    'x'.repeat(129),
    undefined,
    ['blockedNames'],
  ])('refuses %j', (name) => {
    expect(() => listNamePathSegment(name)).toThrow(
      'question:message.error.invalid_list_name'
    );
  });

  it('refuses encoded traversal through the path checks', () => {
    expect(() => listNamePathSegment('%2e%2e')).toThrow();
  });
});

describe('nodeOriginForQApp', () => {
  it('keeps only the origin, dropping the path and the API key', () => {
    expect(
      nodeOriginForQApp(
        'http://127.0.0.1:12391/crosschain/tradebot/respondmultiple?apiKey=secret'
      )
    ).toBe('http://127.0.0.1:12391');
    expect(
      nodeOriginForQApp('https://node.example.com/crosschain/tradebot/respond')
    ).toBe('https://node.example.com');
  });

  it('returns an empty string for anything that is not a URL', () => {
    expect(nodeOriginForQApp('not a url')).toBe('');
    expect(nodeOriginForQApp(undefined)).toBe('');
  });
});
