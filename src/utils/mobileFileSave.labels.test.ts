import { describe, expect, it } from 'vitest';
import {
  categorizeSaveFile,
  describeMobileSave,
  mobileSaveLocationLabelFor,
  mobileSaveTarget,
} from './mobileFileSave';

// The "Saved to" message names the folder native really used
// (SaveCategory.java after SavedFilePolicy.forSave).
describe('where a phone save lands', () => {
  it('saves a page as text, so it lands in Documents', () => {
    expect(mobileSaveTarget('image.svg', 'image/svg+xml')).toEqual({
      name: 'image.svg.txt',
      mimeType: 'text/plain',
    });
    expect(categorizeSaveFile('image.svg')).toBe('Documents');
    expect(mobileSaveLocationLabelFor('site.html.', 'text/html')).toBe(
      'Documents/Qortal Go/Documents'
    );
    expect(mobileSaveTarget('feed.rss').name).toBe('feed.rss.txt');
  });

  it('drops a page type given to another name', () => {
    expect(mobileSaveTarget('drawing', 'image/svg+xml')).toEqual({
      name: 'drawing',
      mimeType: 'application/octet-stream',
    });
    expect(categorizeSaveFile('drawing', 'image/svg+xml')).toBe('Documents');
  });

  it('lets the type decide before the extension, as native does', () => {
    expect(categorizeSaveFile('clip', 'video/mp4')).toBe('Videos');
    expect(categorizeSaveFile('clip.jpg', 'video/mp4')).toBe('Videos');
    expect(categorizeSaveFile('photo.jpg')).toBe('Images');
    expect(categorizeSaveFile('song.mp3', 'application/octet-stream')).toBe(
      'Audio'
    );
    expect(categorizeSaveFile('a.pdf', 'application/pdf')).toBe('Documents');
  });

  it('keeps apps and Qortino packs in their own folders', () => {
    expect(categorizeSaveFile('GO.apk', 'image/png')).toBe('Apps');
    expect(
      categorizeSaveFile('update', 'application/vnd.android.package-archive')
    ).toBe('Apps');
    expect(categorizeSaveFile('model.gguf', 'application/octet-stream')).toBe(
      'Qortino AI'
    );
  });

  it('cleans the name it reports', () => {
    expect(mobileSaveTarget('holiday\u202Egpj.jpg').name).toBe(
      'holidaygpj.jpg'
    );
    expect(mobileSaveTarget('').name).toBe('download');
  });

  it('reads the real folder and name from an Android 8/9 path', () => {
    expect(
      describeMobileSave(
        {
          path: '/storage/emulated/0/Documents/Qortal Go/Documents/a (1).pdf',
        },
        'a.pdf',
        'application/pdf'
      )
    ).toEqual({ folder: 'Documents/Qortal Go/Documents', name: 'a (1).pdf' });
  });

  it('works out the folder and name for an Android 10+ uri', () => {
    expect(
      describeMobileSave(
        { path: 'content://media/external/file/12' },
        'image.svg',
        'image/svg+xml'
      )
    ).toEqual({
      folder: 'Documents/Qortal Go/Documents',
      name: 'image.svg.txt',
    });
    expect(describeMobileSave(null, 'clip', 'video/mp4')).toEqual({
      folder: 'Documents/Qortal Go/Videos',
      name: 'clip',
    });
  });
});
