import { describe, expect, it } from 'vitest';
import i18n from '../../i18n/i18n';
import {
  VENDOR_BATTERY_BRANDS,
  normalizeBatteryBrand,
  vendorBatteryStepKeys,
  vendorBatterySteps,
} from './vendorBatterySteps';

const PREFIX = 'core:background_sync.vendor_freeze.steps';

describe('normalizeBatteryBrand', () => {
  it.each([
    ['vivo', 'vivo'],
    ['iQOO', 'vivo'],
    ['IQOO', 'vivo'],
    ['Xiaomi', 'xiaomi'],
    ['Redmi', 'xiaomi'],
    ['POCO', 'xiaomi'],
    ['samsung', 'samsung'],
    ['OPPO', 'oppo'],
    ['realme', 'oppo'],
    ['OnePlus', 'oppo'],
    ['HUAWEI', 'huawei'],
    ['HONOR', 'huawei'],
  ])('maps %s to %s', (manufacturer, brand) => {
    expect(normalizeBatteryBrand(manufacturer)).toBe(brand);
  });

  it.each([
    'Google',
    'GrapheneOS',
    'motorola',
    'HMD Global',
    'Nokia',
    'Acme',
    '',
    '   ',
  ])('treats %j as a generic phone', (manufacturer) => {
    expect(normalizeBatteryBrand(manufacturer)).toBe('generic');
  });

  it('ignores case, spaces and punctuation, and a company suffix', () => {
    expect(normalizeBatteryBrand('  One Plus ')).toBe('oppo');
    expect(normalizeBatteryBrand('Xiaomi Inc.')).toBe('xiaomi');
    expect(normalizeBatteryBrand('Samsung Electronics')).toBe('samsung');
    expect(normalizeBatteryBrand(null)).toBe('generic');
    expect(normalizeBatteryBrand(undefined)).toBe('generic');
  });
});

describe('vendorBatterySteps', () => {
  it('lists each brand its own numbered step keys', () => {
    expect(vendorBatteryStepKeys('vivo')).toEqual([
      `${PREFIX}.vivo.step_1`,
      `${PREFIX}.vivo.step_2`,
      `${PREFIX}.vivo.step_3`,
    ]);
    expect(vendorBatteryStepKeys('xiaomi')).toHaveLength(3);
    expect(vendorBatteryStepKeys('samsung')).toHaveLength(2);
    expect(vendorBatteryStepKeys('oppo')).toHaveLength(2);
    expect(vendorBatteryStepKeys('huawei')).toHaveLength(3);
    expect(vendorBatteryStepKeys('generic')).toEqual([
      `${PREFIX}.generic.step_1`,
      `${PREFIX}.generic.step_2`,
    ]);
  });

  it('adds the same two notes under every brand', () => {
    for (const manufacturer of ['vivo', 'samsung', 'Google', '']) {
      expect(vendorBatterySteps(manufacturer).noteKeys).toEqual([
        `${PREFIX}.note_menu_names`,
        `${PREFIX}.note_recents`,
      ]);
    }
  });

  it('names the brand group for a heading, none for generic phones', () => {
    expect(vendorBatterySteps('iqoo')).toMatchObject({
      brand: 'vivo',
      brandLabel: 'vivo / iQOO',
    });
    expect(vendorBatterySteps('Google')).toMatchObject({
      brand: 'generic',
      brandLabel: null,
    });
  });

  it('has an English text for every key it hands out', async () => {
    if (!i18n.isInitialized) {
      await new Promise<void>((resolve) =>
        i18n.on('initialized', () => resolve())
      );
    }
    const english = i18n.getFixedT('en');
    for (const brand of VENDOR_BATTERY_BRANDS) {
      const { stepKeys, noteKeys } = vendorBatterySteps(brand);
      for (const key of [...stepKeys, ...noteKeys]) {
        expect(i18n.exists(key, { lng: 'en' }), key).toBe(true);
        expect(english(key)).not.toContain('background_sync');
      }
    }
    expect(english(`${PREFIX}.vivo.step_1`)).toBe(
      'Open Settings > Battery > "Background power consumption management".'
    );
  });
});
