import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  QDN_AVATAR_SEEDS,
  QDN_AVATAR_SEEDS_CAPTURED_AT,
} from '../../assets/qdnAvatarSeeds/manifest';
import { qdnAvatarKey } from './keys';
import {
  getQdnAvatarSeedNames,
  getQdnAvatarSeedUrl,
  qdnAvatarSeedUrlForKey,
} from './seeds';

const SEED_DIR = join(process.cwd(), 'src/assets/qdnAvatarSeeds');

describe('bundled avatar seeds', () => {
  it('ships the Home featured apps (Q-Chat has no QDN icon)', () => {
    for (const name of ['Q-Tube', 'Quitter', 'Q-Mail', 'SubWire', 'Q-Trade']) {
      expect(getQdnAvatarSeedUrl(name)).toBeTruthy();
    }
    expect(getQdnAvatarSeedUrl('Q-Chat')).toBeUndefined();
  });

  it('looks names up without case', () => {
    expect(getQdnAvatarSeedUrl('q-tube')).toBe(getQdnAvatarSeedUrl('Q-TUBE'));
    expect(qdnAvatarSeedUrlForKey(qdnAvatarKey('quitter'))).toBe(
      getQdnAvatarSeedUrl('Quitter')
    );
  });

  it('has no seeds for group avatars or unknown names', () => {
    expect(
      qdnAvatarSeedUrlForKey(qdnAvatarKey('Q-Tube', 'qortal_group_avatar_1'))
    ).toBeUndefined();
    expect(getQdnAvatarSeedUrl('someone-else')).toBeUndefined();
    expect(getQdnAvatarSeedUrl(null)).toBeUndefined();
  });

  it('manifest matches the files and stays small', () => {
    const files = readdirSync(SEED_DIR).filter((file) =>
      file.endsWith('.webp')
    );
    expect(files).toHaveLength(QDN_AVATAR_SEEDS.length);
    expect(getQdnAvatarSeedNames()).toHaveLength(QDN_AVATAR_SEEDS.length);
    const total = files.reduce(
      (sum, file) => sum + statSync(join(SEED_DIR, file)).size,
      0
    );
    expect(total).toBeLessThan(300 * 1024);
    expect(QDN_AVATAR_SEEDS_CAPTURED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
