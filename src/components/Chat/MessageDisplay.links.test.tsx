import { act, fireEvent, render } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { infoSnackGlobalAtom, openSnackGlobalAtom } from '../../atoms/global';
import { extractComponents, MessageDisplay } from './MessageDisplay';

// Audit GO-21: links that climb out of /render/APP/<name>/ so another
// publisher's app runs under a trusted name and its saved permissions.
const ATTACK_LINKS = [
  'qortal://APP/Q-Wallets/../../../render/APP/Evil',
  'qortal://APP/Q-Wallets/..\\..\\..\\render\\APP/Evil',
  'qortal://APP/Q-Wallets/%2e%2e/%2e%2e/%2e%2e/render/APP/Evil',
  'qortal://APP/Q-Wallets/%2E%2E/.%2e/render/APP/Evil',
  'qortal://APP/Q-Wallets/..;/..;/..;/render/APP/Evil',
  'qortal://APP/Q-Wallets/..%2f..%2f..%2frender%2fAPP%2fEvil',
  'qortal://APP/Q-Wallets/..%5c..%5crender%5cAPP%5cEvil',
  'qortal://APP/Q-Wallets/./../render/APP/Evil?identifier=x',
  'qortal://APP/../render/APP/Evil',
  'qortal://APP/%2e%2e/render/APP/Evil',
  'qortal://APP/Q-Wallets\\..\\..\\render\\APP\\Evil',
  'qortal://APP/Q-Wallets%2f..%2fEvil',
  'qortal://../APP/Evil',
  'qortal://..',
  'qortal://%2e%2e',
  'qortal://..?x=1',
  'qortal://%2e%2e#x',
  // Overlong UTF-8 and double-encoded dots.
  'qortal://APP/Q-Wallets/%c0%ae%c0%ae/%c0%ae%c0%ae/render/APP/Evil',
  'qortal://APP/Q-Wallets/%e0%80%ae%e0%80%ae/render/APP/Evil',
  'qortal://APP/Q-Wallets/..%c0%af..%c0%afrender/APP/Evil',
  'qortal://APP/Q-Wallets/%252e%252e/%252e%252e/render/APP/Evil',
  'qortal://APP/%252e%252e/render/APP/Evil',
  'qortal://APP/Q-Wallets%252f..%252fEvil',
  'qortal://%c0%ae%c0%ae',
];

describe('extractComponents path traversal (GO-21)', () => {
  it.each(ATTACK_LINKS)('refuses %s', (link) => {
    expect(extractComponents(link)).toBeNull();
  });

  it('still parses ordinary links', () => {
    expect(
      extractComponents('qortal://APP/Q-Tube/video/QTUBE_VIDEO_abc')
    ).toEqual({
      service: 'APP',
      name: 'Q-Tube',
      identifier: undefined,
      path: 'video/QTUBE_VIDEO_abc',
    });
    expect(
      extractComponents('qortal://APP/Q-Blog/post/x?identifier=id-1&tab=2')
    ).toEqual({
      service: 'APP',
      name: 'Q-Blog',
      identifier: 'id-1',
      path: 'post/x?tab=2',
    });
    expect(extractComponents('qortal://APP/Q-Blog/#/post/x')).toEqual({
      service: 'APP',
      name: 'Q-Blog',
      identifier: undefined,
      path: '#/post/x',
    });
    expect(
      extractComponents('qortal://APP/Q-Tube/search?q=../../x')
    ).toMatchObject({ name: 'Q-Tube', path: 'search?q=..%2F..%2Fx' });
  });

  it('keeps a query or fragment after a bare name with the site', () => {
    expect(extractComponents('qortal://Q-Tube?x=1')).toEqual({
      service: 'WEBSITE',
      name: 'Q-Tube',
      identifier: undefined,
      path: '?x=1',
    });
    expect(extractComponents('qortal://Q-Tube#..')).toEqual({
      service: 'WEBSITE',
      name: 'Q-Tube',
      identifier: undefined,
      path: '#..',
    });
    expect(extractComponents('qortal://Q-Tube')).toEqual({
      service: 'WEBSITE',
      name: 'Q-Tube',
      identifier: undefined,
      path: '',
    });
  });

  it('keeps a fragment right after the app name as the path', () => {
    expect(extractComponents('qortal://APP/Q-Blog#/post/x')).toEqual({
      service: 'APP',
      name: 'Q-Blog',
      identifier: undefined,
      path: '#/post/x',
    });
    expect(
      extractComponents('qortal://APP/Q-Blog#frag?identifier=id-1')
    ).toEqual({
      service: 'APP',
      name: 'Q-Blog',
      identifier: 'id-1',
      path: '#frag',
    });
  });

  it('decodes an encoded name so the tab carries the real one', () => {
    expect(extractComponents('qortal://APP/Q%20Tube/x')).toMatchObject({
      name: 'Q Tube',
      path: 'x',
    });
    expect(extractComponents('qortal://Q%20Tube')).toMatchObject({
      service: 'WEBSITE',
      name: 'Q Tube',
    });
  });
});

describe('chat qortal:// link clicks', () => {
  let opened: unknown[] = [];
  const onAddTab = (e: Event) => {
    opened.push((e as CustomEvent).detail?.data);
  };

  const store = getDefaultStore();

  beforeEach(() => {
    opened = [];
    store.set(infoSnackGlobalAtom, null);
    store.set(openSnackGlobalAtom, false);
    document.addEventListener('addTab', onAddTab);
  });

  afterEach(() => {
    document.removeEventListener('addTab', onAddTab);
  });

  const clickLink = (link: string) => {
    const { container } = render(
      <MessageDisplay htmlContent={`<p>${link}</p>`} />
    );
    const span = container.querySelector('[data-url]');
    expect(span?.getAttribute('data-url')).toBe(link);
    act(() => {
      fireEvent.click(span as Element);
    });
  };

  it('opens an ordinary link in a tab', () => {
    clickLink('qortal://APP/Q-Tube/video/abc');
    expect(opened).toEqual([
      {
        service: 'APP',
        name: 'Q-Tube',
        identifier: undefined,
        path: 'video/abc',
      },
    ]);
    expect(store.get(openSnackGlobalAtom)).toBe(false);
  });

  it.each([
    'qortal://APP/Q-Wallets/../../../render/APP/Evil',
    'qortal://APP/Q-Wallets/%2e%2e/%2e%2e/render/APP/Evil',
    'qortal://APP/Q-Wallets/..;/..;/render/APP/Evil',
    'qortal://APP/Q-Wallets/%c0%ae%c0%ae/render/APP/Evil',
  ])('does not open %s and says why', (link) => {
    clickLink(link);
    expect(opened).toEqual([]);
    expect(store.get(openSnackGlobalAtom)).toBe(true);
    expect(store.get(infoSnackGlobalAtom)).toMatchObject({ type: 'error' });
    expect(store.get(infoSnackGlobalAtom)?.message).toMatch(
      /invalid_qortal_link|invalid qortal link/i
    );
  });
});
