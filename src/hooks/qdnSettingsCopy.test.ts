import { beforeEach, describe, expect, it } from 'vitest';
import {
  forgetSettingsCopies,
  rememberedSettingsCopy,
  rememberSettingsCopy,
} from './qdnSettingsCopy';

const copy = (updated: number, homeLayout: string) => ({
  settings: { homeLayout },
  updated,
});

beforeEach(() => {
  forgetSettingsCopies();
});

describe("the copy of the settings a save keeps GO's other fields from", () => {
  it('holds the newest copy read, per account', () => {
    rememberSettingsCopy('QAlice', copy(100, 'first'));
    rememberSettingsCopy('QAlice', copy(200, 'second'));
    rememberSettingsCopy('QBob', copy(50, 'bob'));

    expect(rememberedSettingsCopy('QAlice')).toEqual(copy(200, 'second'));
    expect(rememberedSettingsCopy('QBob')).toEqual(copy(50, 'bob'));
    expect(rememberedSettingsCopy('QCarol')).toBeNull();
  });

  it('keeps it when a node that is behind answers with an older one', () => {
    rememberSettingsCopy('QAlice', copy(200, 'newer'));
    rememberSettingsCopy('QAlice', copy(100, 'older'));

    expect(rememberedSettingsCopy('QAlice')).toEqual(copy(200, 'newer'));
  });
});
