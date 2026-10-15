import { beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({
  buildPrivateAppOnDevice: vi.fn(),
  canBuildPrivateAppsOnDevice: vi.fn(() => true),
}));

vi.mock('../../../plugins/PrivateQappHost', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../plugins/PrivateQappHost')
  >()),
  buildPrivateAppOnDevice: host.buildPrivateAppOnDevice,
  canBuildPrivateAppsOnDevice: host.canBuildPrivateAppsOnDevice,
}));

import {
  DEV_ZIP_MAX_BYTES,
  DevZipError,
  buildDevZip,
  devAppLabelFromFileName,
  devAppName,
  isDevZipTab,
  looksLikeZipBase64,
  readFileAsBase64,
} from './devModeApp';
import { serializeTabForSession } from '../mobileOpenTabsSession';

const NODE = 'https://ext-node.qortal.link';
const ZIP_HEAD = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const EMPTY_ZIP = new Uint8Array([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0]);

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

describe('devAppLabelFromFileName', () => {
  it('keeps the file name without folders or .zip', () => {
    expect(devAppLabelFromFileName('my-app_v2.zip')).toBe('my-app_v2');
    expect(devAppLabelFromFileName('Download/Q-Tube.ZIP')).toBe('Q-Tube');
    expect(devAppLabelFromFileName('C:\\dev\\site.zip')).toBe('site');
  });

  it('drops characters that would end a name in an address', () => {
    expect(devAppLabelFromFileName('a?b#c%2e\u0000d.zip')).toBe('a b c 2e d');
  });

  it('falls back to "app" and caps long names', () => {
    expect(devAppLabelFromFileName('.zip')).toBe('app');
    expect(devAppLabelFromFileName('')).toBe('app');
    expect(devAppLabelFromFileName(`${'x'.repeat(80)}.zip`)).toHaveLength(40);
  });

  it('gives every dev app a name no published app shares by accident', () => {
    expect(devAppName('Q-Wallets')).toBe('Dev: Q-Wallets');
  });
});

describe('looksLikeZipBase64', () => {
  it('knows a zip by its first bytes', () => {
    expect(looksLikeZipBase64(toBase64(ZIP_HEAD))).toBe(true);
    expect(looksLikeZipBase64(toBase64(EMPTY_ZIP))).toBe(true);
  });

  it('refuses anything else', () => {
    expect(looksLikeZipBase64(btoa('<!doctype html>'))).toBe(false);
    expect(looksLikeZipBase64('')).toBe(false);
    expect(looksLikeZipBase64('!!!!')).toBe(false);
  });
});

describe('isDevZipTab', () => {
  it('is only true for tabs opened from a zip', () => {
    expect(isDevZipTab({ isDevZip: true })).toBe(true);
    expect(isDevZipTab({ isPreview: true, isPrivate: true })).toBe(false);
    expect(isDevZipTab(null)).toBe(false);
  });

  it('is never saved for the next start', () => {
    expect(
      serializeTabForSession({
        tabId: 't1',
        isDevZip: true,
        isPreview: true,
        service: 'APP',
        name: 'Dev: my-app',
        url: `${NODE}/render/hash/abc`,
      })
    ).toBeNull();
    expect(
      serializeTabForSession({ tabId: 't2', service: 'APP', name: 'Q-Tube' })
    ).toMatchObject({ tabId: 't2', name: 'Q-Tube' });
  });
});

describe('buildDevZip', () => {
  beforeEach(() => {
    host.buildPrivateAppOnDevice.mockReset();
  });

  it('reads the file and builds it on the phone', async () => {
    host.buildPrivateAppOnDevice.mockResolvedValue({
      id: 'abc',
      url: `${NODE}/render/hash/abc`,
    });
    const file = new File([ZIP_HEAD], 'app.zip', { type: 'application/zip' });

    await expect(readFileAsBase64(file)).resolves.toBe(toBase64(ZIP_HEAD));
    await expect(buildDevZip(NODE, file)).resolves.toBe(
      `${NODE}/render/hash/abc`
    );
    expect(host.buildPrivateAppOnDevice).toHaveBeenCalledWith(
      NODE,
      toBase64(ZIP_HEAD)
    );
  });

  it('says what is wrong with a file it cannot use', async () => {
    const notZip = new File(['<html></html>'], 'index.html');
    await expect(buildDevZip(NODE, notZip)).rejects.toMatchObject({
      problem: 'not_zip',
    });

    const big = new File([ZIP_HEAD], 'big.zip');
    Object.defineProperty(big, 'size', { value: DEV_ZIP_MAX_BYTES + 1 });
    await expect(buildDevZip(NODE, big)).rejects.toMatchObject({
      problem: 'too_large',
    });

    host.buildPrivateAppOnDevice.mockRejectedValue(new Error('invalid app'));
    const broken = new File([ZIP_HEAD], 'broken.zip');
    const failure = await buildDevZip(NODE, broken).catch((error) => error);
    expect(failure).toBeInstanceOf(DevZipError);
    expect(failure.problem).toBe('build');
    expect(host.buildPrivateAppOnDevice).toHaveBeenCalledTimes(1);
  });
});
