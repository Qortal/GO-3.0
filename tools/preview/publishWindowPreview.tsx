/**
 * Dev-only preview of GO's QDN publish window (QdnPublishWindow): a pretend
 * GO shell around a pretend Q-App frame (fake-qapp-publish.html). The app's
 * Publish buttons open its own "Publishing Status" window and ask this page
 * to publish; the page runs a made-up upload through GO's real publish store,
 * so GO takes the app's window over, and the window can be minimized into
 * the bubble, dragged and opened again. Run `npm run dev` and open
 * /tools/preview/publish-window.html (phone size). Not a build input, so it
 * never ships.
 */
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Box, Button, CssBaseline, Stack, Typography } from '@mui/material';
import { useSetAtom } from 'jotai';
import '../../src/i18n/i18n';
import '../../src/styles/index.css';
import {
  ThemeProvider,
  useThemeContext,
} from '../../src/components/Theme/ThemeContext';
import { QdnPublishWindow } from '../../src/components/Transfers/QdnPublishWindow';
import { useQappPublishWindowBridge } from '../../src/components/Apps/useQappPublishWindowBridge';
import { mobileQappFrameShowingAtom } from '../../src/components/Mobile/mobileQappFrame';
import {
  beginPublishJob,
  finishPublishJob,
  notePublishProgress,
  notePublishRowFailed,
  notePublishRowPublished,
  notePublishRowStarted,
} from '../../src/qdn/publish/publishJobs';
import { executeEvent } from '../../src/utils/events';

const MB = 1024 * 1024;
const TAB = { tabId: 'tab-preview', name: 'Q-Share', service: 'APP' };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Row = { service: string; label: string; bytes: number; fail?: string };

const PLANS: Record<string, { rows: Row[]; chunkMs: number; startMs: number }> =
  {
    video: {
      chunkMs: 260,
      startMs: 0,
      rows: [
        { service: 'VIDEO', label: 'holiday.mp4', bytes: 180 * MB },
        { service: 'THUMBNAIL', label: 'holiday-thumb.webp', bytes: 48 * 1024 },
        { service: 'DOCUMENT', label: 'qshare_details_holiday', bytes: 2100 },
      ],
    },
    fail: {
      chunkMs: 220,
      startMs: 0,
      rows: [
        { service: 'FILE', label: 'manual.pdf', bytes: 42 * MB },
        {
          service: 'FILE',
          label: 'manual-extra.zip',
          bytes: 9 * MB,
          fail: 'Not enough QORT for the publish fee',
        },
      ],
    },
    small: {
      chunkMs: 0,
      startMs: 6_500,
      rows: [{ service: 'IMAGE', label: 'avatar.png', bytes: 900 * 1024 }],
    },
  };

let sending: Window | null = null;
const tellApp = (message: Record<string, unknown>) =>
  sending?.postMessage(message, window.location.origin);

async function runPublish(kind: string, appName = TAB.name, tabId = TAB.tabId) {
  const plan = PLANS[kind] ?? PLANS.video;
  const jobId = beginPublishJob({
    tabId,
    appName,
    appService: 'APP',
    rows: plan.rows.map(({ service, label, bytes }) => ({
      service,
      label,
      bytes,
    })),
  });
  const total = plan.rows.reduce((sum, row) => sum + row.bytes, 0);
  let sent = 0;
  for (const [index, row] of plan.rows.entries()) {
    notePublishRowStarted(jobId, index);
    await wait(plan.startMs || 300);
    const chunks = Math.max(1, Math.ceil(row.bytes / (5 * MB)));
    notePublishProgress(jobId, index, {
      stage: 'uploading',
      sentChunks: 0,
      totalChunks: chunks,
    });
    for (let chunk = 1; chunk <= chunks; chunk += 1) {
      await wait(plan.chunkMs || 400);
      if (row.fail && chunk === chunks) break;
      notePublishProgress(jobId, index, {
        stage: 'uploading',
        sentChunks: chunk,
        totalChunks: chunks,
      });
      tellApp({
        preview: 'progress',
        percent: Math.round(
          ((sent + Math.min(row.bytes, chunk * 5 * MB)) / total) * 100
        ),
      });
      if (chunk === 9 && kind === 'video') {
        notePublishProgress(jobId, index, { stage: 'retrying' });
        await wait(1600);
      }
    }
    if (row.fail) {
      notePublishRowFailed(jobId, index, row.fail);
      continue;
    }
    sent += row.bytes;
    notePublishProgress(jobId, index, { stage: 'processing' });
    await wait(row.bytes > 20 * MB ? 3000 : 500);
    notePublishProgress(jobId, index, { stage: 'published' });
    notePublishRowPublished(jobId, index);
  }
  finishPublishJob(jobId);
  tellApp({ preview: plan.rows.some((row) => row.fail) ? 'failed' : 'done' });
}

const Shell = () => {
  const { toggleTheme, themeMode } = useThemeContext() as {
    toggleTheme: () => void;
    themeMode: string;
  };
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const setFrameShowing = useSetAtom(mobileQappFrameShowingAtom);
  const [onHome, setOnHome] = useState(false);
  useQappPublishWindowBridge(iframeRef, TAB.tabId);

  useEffect(() => {
    // GO's tab list, as AppsDesktop broadcasts it.
    setFrameShowing(!onHome);
    executeEvent('setTabsToNav', {
      data: { tabs: [TAB], selectedTab: onHome ? null : TAB },
    });
  }, [onHome, setFrameShowing]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as { preview?: string; kind?: string };
      if (data?.preview !== 'publish') return;
      sending = iframeRef.current?.contentWindow ?? null;
      void runPublish(data.kind ?? 'video');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <Box
      sx={{
        bgcolor: 'background.default',
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
      }}
    >
      <Box
        data-go-notifications-anchor
        sx={{
          alignItems: 'center',
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          flex: '0 0 52px',
          gap: 1,
          px: 1.5,
        }}
      >
        <Typography sx={{ flex: 1, fontWeight: 800 }}>
          {onHome ? 'GO Home' : 'qortal://APP/Q-Share'}
        </Typography>
        <Button size="small" onClick={toggleTheme}>
          {themeMode}
        </Button>
        <Button size="small" onClick={() => setOnHome((v) => !v)}>
          {onHome ? 'apps' : 'home'}
        </Button>
      </Box>
      <Box sx={{ flex: 1, position: 'relative' }}>
        <iframe
          ref={iframeRef}
          title="Q-Share"
          src="./fake-qapp-publish.html"
          style={{
            border: 0,
            height: '100%',
            inset: 0,
            position: 'absolute',
            visibility: onHome ? 'hidden' : 'visible',
            width: '100%',
          }}
        />
        {onHome ? (
          <Stack spacing={1} sx={{ p: 2 }}>
            <Typography variant="h6">Home</Typography>
            <Button
              variant="outlined"
              onClick={() => void runPublish('video', 'Q-Tube', 'tab-2')}
            >
              Start a Q-Tube publish here
            </Button>
          </Stack>
        ) : null}
      </Box>
      <Box
        sx={{
          alignItems: 'center',
          bgcolor: 'background.paper',
          borderTop: 1,
          borderColor: 'divider',
          display: 'flex',
          flex: '0 0 60px',
          justifyContent: 'space-around',
        }}
      >
        {['Home', 'Apps', 'Chat'].map((label) => (
          <Box
            key={label}
            sx={{
              alignItems: 'center',
              bgcolor: 'action.hover',
              borderRadius: '50%',
              display: 'flex',
              fontSize: 11,
              height: 44,
              justifyContent: 'center',
              width: 44,
            }}
          >
            {label}
          </Box>
        ))}
      </Box>
      <QdnPublishWindow enabled />
    </Box>
  );
};

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <CssBaseline />
    <Shell />
  </ThemeProvider>
);

Object.assign(window, { previewPublish: { runPublish } });
