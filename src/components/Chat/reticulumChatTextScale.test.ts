import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createStore } from 'jotai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reticulumChatTextScaleAtom } from '../../atoms/global';
import {
  RETICULUM_CHAT_META_SCALE_FACTOR,
  RETICULUM_CHAT_TEXT_SCALES,
  RETICULUM_CHAT_TEXT_SCALE_FACTOR,
  normalizeReticulumChatTextScale,
  qchatMetaTextSize,
  qchatTextSize,
  reticulumChatScaledPx,
  reticulumChatTextScaleClassName,
  reticulumMemberNamePx,
} from './reticulumChatTextScale';

const STORAGE_KEY = 'qortal_reticulum_chat_text_scale';
const chatCss = readFileSync(resolve(__dirname, 'chat.css'), 'utf8');

/** The declarations of the rule whose selector is exactly `selector`. */
const cssRule = (selector: string) => {
  const start = chatCss.indexOf(`\n${selector} {`);
  expect(start, `${selector} in chat.css`).toBeGreaterThanOrEqual(0);
  return chatCss.slice(start, chatCss.indexOf('}', start));
};

describe('normalizeReticulumChatTextScale', () => {
  it('keeps the three sizes', () => {
    for (const scale of RETICULUM_CHAT_TEXT_SCALES) {
      expect(normalizeReticulumChatTextScale(scale)).toBe(scale);
    }
  });

  it('reads an older build’s Medium and High as Large', () => {
    expect(normalizeReticulumChatTextScale('medium')).toBe('large');
    expect(normalizeReticulumChatTextScale('high')).toBe('large');
  });

  it('falls back to Default for anything else', () => {
    for (const value of [undefined, null, '', 'huge', 3, {}]) {
      expect(normalizeReticulumChatTextScale(value)).toBe('default');
    }
  });
});

describe('the size helpers', () => {
  it('lists Small, Default, Large in that order', () => {
    expect(RETICULUM_CHAT_TEXT_SCALES).toEqual(['small', 'default', 'large']);
  });

  it('leaves Default exactly as the chat always was', () => {
    expect(RETICULUM_CHAT_TEXT_SCALE_FACTOR.default).toBe(1);
    expect(RETICULUM_CHAT_META_SCALE_FACTOR.default).toBe(1);
    expect(reticulumChatScaledPx('default', 15.5)).toBe(15.5);
  });

  it('moves the small labels less than the reading text', () => {
    expect(RETICULUM_CHAT_META_SCALE_FACTOR.small).toBeGreaterThan(
      RETICULUM_CHAT_TEXT_SCALE_FACTOR.small
    );
    expect(RETICULUM_CHAT_META_SCALE_FACTOR.large).toBeLessThan(
      RETICULUM_CHAT_TEXT_SCALE_FACTOR.large
    );
  });

  it('gives message text 14, 16 and 19px', () => {
    expect(
      RETICULUM_CHAT_TEXT_SCALES.map((scale) =>
        reticulumChatScaledPx(scale, 16)
      )
    ).toEqual([14, 16, 19]);
  });

  it('rounds sizes in script to half pixels', () => {
    expect(reticulumChatScaledPx('small', 15)).toBe(13);
    expect(reticulumChatScaledPx('large', 15)).toBe(18);
    expect(reticulumChatScaledPx('small', 14)).toBe(12.5);
  });

  it('keeps member names at 12px or more', () => {
    expect(RETICULUM_CHAT_TEXT_SCALES.map(reticulumMemberNamePx)).toEqual([
      12, 13, 15.5,
    ]);
  });

  it('builds the root class and the CSS sizes', () => {
    expect(reticulumChatTextScaleClassName('large')).toBe(
      'reticulum-chat-text-scale reticulum-chat-text-scale--large'
    );
    expect(qchatTextSize(15.5)).toBe(
      'calc(15.5px * var(--qchat-text-scale, 1))'
    );
    expect(qchatMetaTextSize(11)).toBe(
      'calc(11px * var(--qchat-meta-scale, 1))'
    );
  });
});

describe('chat.css', () => {
  it('carries the same factors as the script', () => {
    for (const scale of ['small', 'large'] as const) {
      const rule = cssRule(`.reticulum-chat-text-scale--${scale}`);
      expect(rule).toContain(
        `--qchat-text-scale: ${RETICULUM_CHAT_TEXT_SCALE_FACTOR[scale]};`
      );
      expect(rule).toContain(
        `--qchat-meta-scale: ${RETICULUM_CHAT_META_SCALE_FACTOR[scale]};`
      );
    }
  });

  it('sets no factor for Default', () => {
    expect(chatCss).not.toContain('.reticulum-chat-text-scale--default');
  });

  it('gives the message box plain px sizes, which TipTap measures with', () => {
    expect(cssRule('.tiptap-chat-composer--compact')).toContain(
      '--composer-font-size: 17px;'
    );
    expect(
      cssRule(
        '.reticulum-chat-text-scale--small .tiptap-chat-composer--compact'
      )
    ).toContain('--composer-font-size: 15px;');
    expect(
      cssRule(
        '.reticulum-chat-text-scale--large .tiptap-chat-composer--compact'
      )
    ).toContain('--composer-font-size: 20px;');
  });
});

describe('reticulumChatTextScaleAtom', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts at Default', () => {
    const store = createStore();
    store.sub(reticulumChatTextScaleAtom, () => undefined);
    expect(store.get(reticulumChatTextScaleAtom)).toBe('default');
  });

  it('reads a High saved by an older build as Large', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify('high'));
    const store = createStore();
    // Mounting reads the saved value.
    store.sub(reticulumChatTextScaleAtom, () => undefined);
    expect(store.get(reticulumChatTextScaleAtom)).toBe('large');
  });

  it('has the saved size before anything mounts it', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify('small'));
    vi.resetModules();
    const fresh = await import('../../atoms/global');
    // A chat's first render reads it this way: no frame at Default first.
    expect(createStore().get(fresh.reticulumChatTextScaleAtom)).toBe('small');
  });

  it('saves the choice', () => {
    const store = createStore();
    store.sub(reticulumChatTextScaleAtom, () => undefined);
    store.set(reticulumChatTextScaleAtom, 'small');
    expect(store.get(reticulumChatTextScaleAtom)).toBe('small');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')).toBe(
      'small'
    );
  });
});
