/**
 * Dev-only preview of the chat's full-screen image viewer
 * (ReticulumImageViewer) over a chat-like page. Run `npm run dev` and open
 * /tools/preview/image-viewer.html; below 900px of viewport width it takes
 * the whole screen like on a phone. Not a build input, so it never ships.
 */
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Box, CssBaseline, Typography } from '@mui/material';
import '../../src/i18n/i18n';
import '../../src/styles/index.css';
import {
  ThemeProvider,
  useThemeContext,
} from '../../src/components/Theme/ThemeContext';
import { ReticulumImageViewer } from '../../src/components/Chat/ReticulumImageViewer';
import type { ChatMediaItem } from '../../src/components/Chat/chatMediaGallery';

// Four pictures, one not on this device and one video card, oldest first,
// served by a stand-in for window.reticulumResources.
const GALLERY: ChatMediaItem[] = [
  { key: 'p0', messageKey: 'm0', fileHash: 'p0', kind: 'image' },
  { key: 'p1', messageKey: 'm1', fileHash: 'p1', kind: 'image' },
  { key: 'gone', messageKey: 'm2', fileHash: 'gone', kind: 'image' },
  {
    key: 'v',
    messageKey: 'm3',
    fileHash: 'v',
    kind: 'video',
    fileName: 'beach-day.mp4',
  },
  { key: 'p2', messageKey: 'm4', fileHash: 'p2', kind: 'image' },
  { key: 'p3', messageKey: 'm5', fileHash: 'p3', kind: 'image' },
];

const PALETTES = [
  ['#9fd3ff', '#fff3c4', '#f6b26b', '#3f7d4e'],
  ['#2b1055', '#7597de', '#f9c5d1', '#1d3557'],
  ['#ffecd2', '#fcb69f', '#ff7e5f', '#6a4c93'],
  ['#c2e9fb', '#a1c4fd', '#ffffff', '#2d6a4f'],
];

// A bright "photo" so the contrast with the blurred chat shows.
const makePicture = async (palette = PALETTES[0]): Promise<string> => {
  const canvas = document.createElement('canvas');
  canvas.width = 900;
  canvas.height = 1200;
  const context = canvas.getContext('2d')!;
  const sky = context.createLinearGradient(0, 0, 0, 1200);
  sky.addColorStop(0, palette[0]);
  sky.addColorStop(0.55, palette[1]);
  sky.addColorStop(1, palette[2]);
  context.fillStyle = sky;
  context.fillRect(0, 0, 900, 1200);
  context.fillStyle = '#ffd34d';
  context.beginPath();
  context.arc(620, 380, 120, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = palette[3];
  context.beginPath();
  context.moveTo(0, 900);
  context.quadraticCurveTo(300, 700, 560, 880);
  context.quadraticCurveTo(760, 1000, 900, 860);
  context.lineTo(900, 1200);
  context.lineTo(0, 1200);
  context.fill();
  const blob = await new Promise<Blob>((resolve) =>
    canvas.toBlob((value) => resolve(value!), 'image/png')
  );
  return URL.createObjectURL(blob);
};

// Stable, as the viewer starts over when it gets a new gallery.
const GALLERY_PROP = { items: GALLERY, index: GALLERY.length - 1 };

const LINES = [
  'Anyone tried the new release on a phone yet?',
  'Yes, the buttons are much easier to hit now.',
  'Look at this sunset from yesterday 👇',
  'Wow, that is beautiful!',
  'Where was it taken?',
  'Up on the hill behind the lake.',
];

function Preview() {
  const { themeMode, toggleTheme } = useThemeContext();
  const [src, setSrc] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const chatRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    void Promise.all(PALETTES.map((palette) => makePicture(palette))).then(
      (urls) => {
        const byHash: Record<string, string> = {
          p0: urls[1],
          p1: urls[2],
          p2: urls[3],
          p3: urls[0],
        };
        (window as any).reticulumResources = {
          getStatus: async (hash: string) => ({
            success: true,
            complete: hash !== 'gone',
          }),
          // The video never loads here: its card shows a spinner.
          getUrl: async (hash: string) =>
            byHash[hash]
              ? { success: true, url: byHash[hash] }
              : new Promise(() => {}),
        };
        setSrc(urls[0]);
      }
    );
  }, []);
  return (
    <Box sx={{ color: 'text.primary', height: '100vh' }}>
      <Box sx={{ display: 'flex', gap: 1, p: 1 }}>
        <button onClick={toggleTheme}>{themeMode}</button>
        <button disabled={!src} onClick={() => setOpen(true)}>
          open picture
        </button>
      </Box>
      <Box
        ref={chatRef}
        data-reticulum-chat-root="true"
        sx={{ bgcolor: 'background.default', p: 2 }}
      >
        {LINES.map((line, index) => (
          <Box key={line} sx={{ mb: 2 }}>
            <Typography sx={{ fontWeight: 600 }}>
              {index % 2 ? 'bob' : 'alice'}
            </Typography>
            <Typography>{line}</Typography>
            {index === 2 && src && (
              <Box
                alt="sunset"
                component="img"
                onClick={() => setOpen(true)}
                src={src}
                sx={{ borderRadius: 2, mt: 1, width: 180 }}
              />
            )}
          </Box>
        ))}
      </Box>
      {src && open && (
        <ReticulumImageViewer
          containerElement={chatRef.current}
          fileName="sunset.png"
          gallery={GALLERY_PROP}
          mimeType="image/png"
          onClose={() => setOpen(false)}
          open={open}
          src={src}
        />
      )}
    </Box>
  );
}

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <CssBaseline />
    <Preview />
  </ThemeProvider>
);
