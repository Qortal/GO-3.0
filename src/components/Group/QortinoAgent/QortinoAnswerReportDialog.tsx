/**
 * Flag-an-answer dialog: collect teaching feedback and Q-Mail it to
 * "Qortino AI" directly from the Hub (background MAIL_PRIVATE publish —
 * no Q-Mail iframe, no manual pasting).
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import {
  humanLabelForSearchKind,
  type QdnSearchKind,
} from '../../../qortinoAgent/qdnSearchKind';

export const QORTINO_TEACHING_SUBJECT = 'Teaching Qortino AI';
export const QORTINO_TEACHING_RECIPIENT = 'Qortino AI';

export type AnswerReportPayload = {
  question: string;
  answer: string;
  /** Offline vs live QDN chat window */
  dataSource: 'offline' | 'qdn';
  /** Fast vs Max depth / model */
  answerMode: 'fast' | 'max';
  /** Only meaningful when dataSource is qdn */
  qdnSearchKind?: QdnSearchKind;
};

type Props = {
  open: boolean;
  payload: AnswerReportPayload | null;
  onClose: () => void;
};

export function formatAnswerReportMode(opts: {
  dataSource: 'offline' | 'qdn';
  answerMode: 'fast' | 'max';
  qdnSearchKind?: QdnSearchKind;
}): string {
  const depth = opts.answerMode === 'max' ? 'MAX' : 'FAST';
  if (opts.dataSource === 'offline') {
    return `OFFLINE · ${depth}`;
  }
  const kind = humanLabelForSearchKind(opts.qdnSearchKind || 'all');
  return `QDN · ${depth} · ${kind}`;
}

export function buildTeachingQmailBody(opts: {
  question: string;
  answer: string;
  mode: string;
  feedback: string;
}): string {
  return (
    `Mode: ${opts.mode.trim()}\n\n` +
    `Question:\n${opts.question.trim()}\n\n` +
    `Qortino's answer:\n${opts.answer.trim()}\n\n` +
    `What went wrong and how Qortino should answer next time:\n${opts.feedback.trim()}`
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Q-Mail renders textContentV2 as HTML — paragraphs with <br> line breaks. */
export function teachingBodyToHtml(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

type SendPhase = 'compose' | 'sending' | 'sent';

export function QortinoAnswerReportDialog({ open, payload, onClose }: Props) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [feedback, setFeedback] = useState('');
  const [phase, setPhase] = useState<SendPhase>('compose');
  const [sendError, setSendError] = useState('');

  const modeLabel = useMemo(
    () =>
      payload
        ? formatAnswerReportMode({
            dataSource: payload.dataSource,
            answerMode: payload.answerMode,
            qdnSearchKind: payload.qdnSearchKind,
          })
        : '',
    [payload]
  );

  useEffect(() => {
    if (open) {
      setFeedback('');
      setPhase('compose');
      setSendError('');
    }
  }, [open, payload?.question, payload?.answer]);

  const canSend = !!payload && feedback.trim().length >= 2;

  const handleSend = async () => {
    if (!payload || !canSend || phase === 'sending') return;
    setSendError('');
    setPhase('sending');
    try {
      const body = buildTeachingQmailBody({
        question: payload.question,
        answer: payload.answer,
        mode: modeLabel,
        feedback,
      });
      const res = await window.sendMessage('sendPrivateQmail', {
        recipientName: QORTINO_TEACHING_RECIPIENT,
        subject: QORTINO_TEACHING_SUBJECT,
        htmlBody: teachingBodyToHtml(body),
      });
      if (res?.error) throw new Error(res.error);
      setPhase('sent');
    } catch (error: any) {
      const message =
        typeof error === 'string'
          ? error
          : error?.message || error?.error || 'Unable to send the report';
      setSendError(message);
      setPhase('compose');
    }
  };

  const handleClose = () => {
    if (phase === 'sending') return;
    onClose();
  };

  return (
    <Dialog
      open={open && !!payload}
      onClose={handleClose}
      fullWidth
      maxWidth="sm"
      // Below QortalRequestExtensionDialog (11000) so auth prompts stay on top.
      sx={{ zIndex: 10500 }}
      PaperProps={{
        sx: {
          background: isDark ? '#141820' : '#f7f9fc',
          border: `1px solid ${alpha(theme.palette.common.white, isDark ? 0.1 : 0.4)}`,
          borderRadius: '16px',
          display: 'flex',
          flexDirection: 'column',
          m: 1.5,
          maxHeight: '90dvh',
        },
      }}
    >
      <DialogTitle
        sx={{
          alignItems: 'center',
          display: 'flex',
          flexShrink: 0,
          fontSize: '1.05rem',
          fontWeight: 800,
          justifyContent: 'space-between',
          pr: 1,
          pt: 1.5,
        }}
      >
        Teach Qortino
        <IconButton
          aria-label="Close"
          edge="end"
          onClick={handleClose}
          disabled={phase === 'sending'}
          size="small"
        >
          <CloseRoundedIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      {phase === 'sent' ? (
        <>
          <DialogContent
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
              pb: 1,
              pt: 2,
              textAlign: 'center',
            }}
          >
            <CheckCircleRoundedIcon
              sx={{ color: isDark ? '#6FDA8B' : '#1E9E4A', fontSize: 44 }}
            />
            <Typography sx={{ fontSize: '0.95rem', fontWeight: 800 }}>
              Report sent to {QORTINO_TEACHING_RECIPIENT}
            </Typography>
            <Typography
              sx={{
                color: alpha(theme.palette.text.primary, 0.65),
                fontSize: '0.8rem',
                lineHeight: 1.4,
              }}
            >
              Your Q-Mail ({QORTINO_TEACHING_SUBJECT}) was published to QDN.
              Thank you — every report makes Qortino smarter.
            </Typography>
          </DialogContent>
          <DialogActions sx={{ px: 2.5, pb: 2 }}>
            <Button
              onClick={onClose}
              variant="contained"
              sx={{
                background: isDark ? '#4A7FD4' : '#1A6FD4',
                fontWeight: 800,
                px: 2.5,
                '&:hover': { background: isDark ? '#5B8FE0' : '#1558B0' },
              }}
            >
              Done
            </Button>
          </DialogActions>
        </>
      ) : (
        <>
          <DialogContent
            sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 0.5 }}
          >
            <Typography
              sx={{
                color: alpha(theme.palette.text.primary, 0.7),
                fontSize: '0.82rem',
                lineHeight: 1.4,
              }}
            >
              Describe what went wrong and how Qortino should answer next time.
              The report is Q-Mailed to{' '}
              <strong>{QORTINO_TEACHING_RECIPIENT}</strong> right from here —
              subject <strong>{QORTINO_TEACHING_SUBJECT}</strong> (small QDN
              publish fee applies).
            </Typography>
            {modeLabel ? (
              <Box
                sx={{
                  alignSelf: 'flex-start',
                  background: alpha('#7EB6FF', isDark ? 0.18 : 0.12),
                  borderRadius: '999px',
                  color: isDark ? '#D6E8FF' : '#1A4A8A',
                  fontSize: '0.72rem',
                  fontWeight: 800,
                  px: 1,
                  py: 0.35,
                }}
              >
                {modeLabel}
              </Box>
            ) : null}
            <TextField
              label="What went wrong and how should Qortino answer?"
              placeholder="e.g. It picked Qortal Kitty instead of Kitty — next time use the exact registered name first…"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              multiline
              minRows={4}
              fullWidth
              autoFocus
              disabled={phase === 'sending'}
            />
            {sendError ? (
              <Typography
                sx={{
                  color: theme.palette.error.main,
                  fontSize: '0.78rem',
                  fontWeight: 600,
                }}
              >
                {sendError}
              </Typography>
            ) : null}
            {payload ? (
              <Box
                sx={{
                  background: alpha(
                    theme.palette.text.primary,
                    isDark ? 0.06 : 0.04
                  ),
                  borderRadius: '12px',
                  maxHeight: 140,
                  overflow: 'auto',
                  px: 1.1,
                  py: 0.85,
                }}
              >
                <Typography
                  sx={{
                    color: alpha(theme.palette.text.primary, 0.5),
                    fontSize: '0.66rem',
                    fontWeight: 800,
                    letterSpacing: '0.04em',
                    mb: 0.4,
                    textTransform: 'uppercase',
                  }}
                >
                  Included in the report
                </Typography>
                <Typography
                  sx={{
                    fontSize: '0.72rem',
                    lineHeight: 1.35,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  <Box component="span" sx={{ fontWeight: 700 }}>
                    Mode:{' '}
                  </Box>
                  {modeLabel}
                  {'\n'}
                  <Box component="span" sx={{ fontWeight: 700 }}>
                    Q:{' '}
                  </Box>
                  {payload.question.slice(0, 220)}
                  {payload.question.length > 220 ? '…' : ''}
                  {'\n'}
                  <Box component="span" sx={{ fontWeight: 700 }}>
                    A:{' '}
                  </Box>
                  {payload.answer.slice(0, 220)}
                  {payload.answer.length > 220 ? '…' : ''}
                </Typography>
              </Box>
            ) : null}
          </DialogContent>
          <DialogActions sx={{ px: 2.5, pb: 2 }}>
            <Button
              onClick={handleClose}
              color="inherit"
              disabled={phase === 'sending'}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              disabled={!canSend || phase === 'sending'}
              onClick={() => void handleSend()}
              startIcon={
                phase === 'sending' ? (
                  <CircularProgress size={16} sx={{ color: 'inherit' }} />
                ) : (
                  <SendRoundedIcon sx={{ fontSize: 16 }} />
                )
              }
              sx={{
                background: isDark ? '#4A7FD4' : '#1A6FD4',
                fontWeight: 800,
                px: 2,
                '&:hover': {
                  background: isDark ? '#5B8FE0' : '#1558B0',
                },
              }}
            >
              {phase === 'sending' ? 'Sending…' : 'Report'}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}
