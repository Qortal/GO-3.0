/**
 * Dev-only preview of the Home composer (Quitter / Torq), its post-style
 * attachment preview, a Torq feed card and Featured Q-Apps at phone widths.
 * Run `npm run dev` and open /tools/preview/home-composer.html. Not a build
 * input, so it never ships.
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline } from '@mui/material';
import { getDefaultStore, useAtomValue } from 'jotai';
import '../../src/i18n/i18n';
import '../../src/styles/index.css';
import {
  ThemeProvider,
  useThemeContext,
} from '../../src/components/Theme/ThemeContext';
import { userInfoAtom } from '../../src/atoms/global';
import { HomeFeaturedApps } from '../../src/components/Group/HomeFeaturedApps';
import { HomeQuitterComposer } from '../../src/components/Widgets/quitter/HomeQuitterComposer';
import { QuitterFeedCard } from '../../src/components/Widgets/quitter/QuitterFeedCard';
import {
  composerAppName,
  composerTargetAtom,
  setComposerTarget,
} from '../../src/components/Widgets/quitter/composerTarget';
import { patchQuitterComposerSession } from '../../src/components/Widgets/quitter/quitterComposerSession';
import type { QuitterFeedItem } from '../../src/components/Widgets/quitter/quitterFeedTypes';

const WIDTHS = [340, 360, 412, 520];

const picture = (hue: number, label: string, w = 900, h = 600) =>
  new Promise<File>((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = `hsl(${hue} 60% 55%)`;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 96px sans-serif';
    ctx.fillText(label, 60, h / 2);
    canvas.toBlob(
      (blob) =>
        resolve(new File([blob!], `${label}.png`, { type: 'image/png' })),
      'image/png'
    );
  });

/** Two seconds of a 440 Hz tone, so the audio player really plays. */
const toneWav = () => {
  const rate = 8000;
  const samples = rate * 2;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const text = (at: number, value: string) =>
    [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i += 1) {
    view.setInt16(44 + i * 2, Math.sin((i / rate) * 440 * 2 * Math.PI) * 8000, true);
  }
  return new File([buffer], 'Morning walk.wav', { type: '' });
};

const feedItem = (images: string[]): QuitterFeedItem => ({
  author: 'Simon James',
  avatarUrl: '',
  hasVideo: false,
  id: 'Simon James:post-1',
  identifier: 'post-1',
  images: images.map((src, i) => ({ alt: `image ${i}`, src })),
  latestSignature: 'sig',
  publishedAt: Date.now() - 60_000,
  searchCreatedAt: Date.now(),
  service: 'DOCUMENT',
  text: 'Which cover should the next mix use?\n\nqortal://APP/Torq/post/Simon%20James/post-1\n\nqortal://use-embed/ATTACHMENT?name=Simon&service=FILE&identifier=qshare_file_x',
  attachments: [{ title: 'Morning walk', isAudio: true }],
  pollOptions: ['The blue one', 'The green one'],
});

function Preview() {
  const { themeMode, toggleTheme } = useThemeContext();
  const target = useAtomValue(composerTargetAtom);
  const [width, setWidth] = useState(360);
  const [ready, setReady] = useState(false);
  const [feedImages, setFeedImages] = useState<string[]>([]);

  useEffect(() => {
    getDefaultStore().set(userInfoAtom, { name: 'Simon James' } as never);
    setComposerTarget('torq');
    void (async () => {
      const photos = await Promise.all([
        picture(210, 'One'),
        picture(140, 'Two'),
        picture(30, 'Three'),
      ]);
      const pdf = new File(['%PDF-1.4\n'.repeat(400)], 'Tour dates 2026.pdf', {
        type: 'application/pdf',
      });
      patchQuitterComposerSession({
        expanded: true,
        images: photos.map((file, i) => ({
          id: `photo-${i}`,
          file,
          previewUrl: URL.createObjectURL(file),
        })),
        files: [
          { id: 'audio-1', file: toneWav() },
          { id: 'pdf-1', file: pdf },
        ],
      });
      setFeedImages(
        (await Promise.all([210, 140, 30, 300, 90, 0].map((h, i) => picture(h, `${i + 1}`))))
          .map((file) => URL.createObjectURL(file))
      );
      setReady(true);
    })();
  }, []);

  return (
    <div style={{ padding: 8 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
        {WIDTHS.map((w) => (
          <button
            key={w}
            onClick={() => setWidth(w)}
            style={{ fontWeight: w === width ? 700 : 400 }}
          >
            {w}px
          </button>
        ))}
        <button onClick={toggleTheme}>{themeMode}</button>
        <button
          onClick={() =>
            setComposerTarget(target === 'torq' ? 'quitter' : 'torq')
          }
        >
          target: {target}
        </button>
      </div>
      {ready ? (
        <div style={{ width, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <HomeQuitterComposer />
          <QuitterFeedCard app={composerAppName(target)} item={feedItem(feedImages)} />
          <HomeFeaturedApps />
        </div>
      ) : null}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <CssBaseline />
    <Preview />
  </ThemeProvider>
);
