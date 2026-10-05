import { describe, expect, it } from 'vitest';
import {
  RETICULUM_CATEGORY_CONTENT_GAP_PX,
  RETICULUM_CHANNEL_LIST_HEADER_PX,
  reticulumCategoryHeaderMetrics,
  reticulumChannelListPadding,
  reticulumChannelRowMetrics,
  reticulumOnboardingChannelAnchor,
  reticulumScaledTextSize,
} from './reticulumChannelListLayout';

const scales = ['small', 'default', 'large'] as const;

describe('reticulumChannelRowMetrics', () => {
  it('keeps desktop rows as they were at the default size', () => {
    expect(
      scales.map((scale) => reticulumChannelRowMetrics(scale, false).minHeight)
    ).toEqual([28, 30, 36]);
    expect(reticulumChannelRowMetrics('default', false)).toMatchObject({
      fontSize: 14,
      iconSize: 18,
      paddingLeft: 12,
    });
  });

  it('scales the channel names with the chat text size', () => {
    expect(
      scales.map((scale) => reticulumChannelRowMetrics(scale, true).fontSize)
    ).toEqual([13, 15, 18]);
    expect(
      scales.map((scale) => reticulumChannelRowMetrics(scale, false).fontSize)
    ).toEqual([12.5, 14, 16.5]);
  });

  it('gives phones thumb-sized rows that grow with the text scale', () => {
    const heights = scales.map(
      (scale) => reticulumChannelRowMetrics(scale, true).minHeight
    );
    // Small text never shrinks a phone row under the 44px touch target.
    expect(heights).toEqual([44, 44, 50]);
    expect(reticulumChannelRowMetrics('default', true)).toMatchObject({
      fontSize: 15,
      iconSize: 20,
    });
    expect(reticulumChannelRowMetrics('large', true).fontSize).toBe(
      reticulumScaledTextSize('large', 15)
    );
  });

  it('never makes anything smaller on phones', () => {
    for (const scale of scales) {
      const desktop = reticulumChannelRowMetrics(scale, false);
      const phone = reticulumChannelRowMetrics(scale, true);
      for (const key of Object.keys(desktop) as Array<keyof typeof desktop>) {
        expect(phone[key]).toBeGreaterThanOrEqual(desktop[key]);
      }
    }
  });
});

describe('reticulumCategoryHeaderMetrics', () => {
  it('keeps the desktop header compact', () => {
    expect(reticulumCategoryHeaderMetrics(false)).toMatchObject({
      createButtonSize: null,
      fontSize: 10,
      minHeight: 32,
    });
  });

  it('fits a 40px create button inside a readable phone header', () => {
    const phone = reticulumCategoryHeaderMetrics(true);
    expect(phone.minHeight).toBeGreaterThanOrEqual(40);
    expect(phone.fontSize).toBeGreaterThanOrEqual(11);
    expect(phone.fontSize).toBeLessThanOrEqual(12);
    expect(phone.createButtonSize).toBeGreaterThanOrEqual(40);
    // The 1px border top and bottom sits outside the button.
    expect(phone.minHeight - 2).toBeGreaterThanOrEqual(
      phone.createButtonSize ?? 0
    );
    expect(phone.chevronSize).toBeGreaterThan(
      reticulumCategoryHeaderMetrics(false).chevronSize
    );
  });
});

describe('reticulumOnboardingChannelAnchor', () => {
  it('covers the first channel row under the default category header', () => {
    expect(
      reticulumOnboardingChannelAnchor({
        defaultCategoryHidden: false,
        phone: false,
        scale: 'default',
      })
    ).toEqual({
      height: 30,
      inset: 16,
      top:
        RETICULUM_CHANNEL_LIST_HEADER_PX +
        32 +
        RETICULUM_CATEGORY_CONTENT_GAP_PX,
    });
  });

  it('follows the bigger phone rows, header and padding', () => {
    const anchor = reticulumOnboardingChannelAnchor({
      defaultCategoryHidden: false,
      phone: true,
      scale: 'large',
    });
    const padding = reticulumChannelListPadding(true);
    expect(anchor).toEqual({
      height: reticulumChannelRowMetrics('large', true).minHeight,
      inset: padding.outer + padding.inner,
      top:
        RETICULUM_CHANNEL_LIST_HEADER_PX +
        reticulumCategoryHeaderMetrics(true).minHeight +
        RETICULUM_CATEGORY_CONTENT_GAP_PX,
    });
  });

  it('moves up when the default category header is hidden', () => {
    const shown = reticulumOnboardingChannelAnchor({
      defaultCategoryHidden: false,
      phone: true,
      scale: 'default',
    });
    const hidden = reticulumOnboardingChannelAnchor({
      defaultCategoryHidden: true,
      phone: true,
      scale: 'default',
    });
    expect(hidden.top).toBeLessThan(shown.top);
    expect(hidden.top).toBeGreaterThan(RETICULUM_CHANNEL_LIST_HEADER_PX);
  });
});
