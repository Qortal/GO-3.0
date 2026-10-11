import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Checkbox,
  Dialog,
  FormControlLabel,
  Theme,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import {
  JsonView,
  allExpanded,
  darkStyles,
  defaultStyles,
} from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';
import { CountdownCircleTimer } from 'react-countdown-circle-timer';
import ErrorBoundary from '../../common/ErrorBoundary';
import { CustomButtonAccept, TextP } from '../../styles/App-styles.ts';
import { ErrorText } from '../index';
import PriorityHighIcon from '@mui/icons-material/PriorityHigh';
import {
  QortalRequestDetails,
  QortalRequestDetailsData,
} from './QortalRequestDetails';
import { useSecureScreen } from '../../hooks/useSecureScreen';
import { useAcceptDelay } from '../../hooks/useAcceptDelay';
import {
  ApprovalDecision,
  RequestingApp,
  approvalCheckbox1Default,
  approvalExpiry,
  approvalSecondsLeft,
} from '../../utils/qappApproval';
import { DECLINE_GUARD_MS } from '../../utils/qappApprovalQueue';
import { BACK_PRIORITY, useAndroidBack } from '../../utils/androidBack';
import { QappIcon, QappIconFrame } from './QappIcon';

const QORTAL_REQUEST_DIALOG_Z_INDEX = 11000;

/**
 * The dialog covers everything, calls included, so the Android back button
 * reaches it first.
 */
export const APPROVAL_BACK_PRIORITY = BACK_PRIORITY.call + 10;

export type MessageQortalRequestExtension = {
  text1?: string;
  text2?: string;
  text3?: string;
  text4?: string;
  details?: QortalRequestDetailsData;
  highlightedText?: string;
  json?: any;
  fee?: string;
  appFee?: string;
  foreignFee?: string;
  checkbox1?: { label?: string; value?: boolean };
  confirmCheckbox?: boolean;
  confirmCheckboxLabel?: string;
  /** Set by GO from the request's appInfo (utils/qappApproval.ts). */
  requestingApp?: RequestingApp | null;
  /** When the requester stops waiting (ms since epoch). */
  expiresAt?: number;
};

type QortalRequestExtensionDialogProps = {
  open: boolean;
  /** The id of the request on screen; per-request state resets with it. */
  requestId?: number | null;
  /** How many more requests wait behind this one. */
  pendingCount?: number;
  /** How many of those come from the same app as this one. */
  sameAppPendingCount?: number;
  message: MessageQortalRequestExtension | null | Record<string, unknown>;
  sendPaymentError: string;
  onAccept: (decision: ApprovalDecision) => void;
  /** Declines the request with this id (the one on screen). */
  onCancel: (requestId: number | null) => void;
  /** Declines this request and every queued one from the same app. */
  onDeclineAll?: () => void;
  /** The request with this id ran out of time. */
  onCountdownComplete: (requestId: number | null) => void;
};

/**
 * The Q-App approval dialog (GO-28 / GO-29).
 *
 * - Names the requesting app (from GO's appInfo, never from the payload).
 * - One request at a time: the content is keyed by `requestId`, so the
 *   checkboxes, the countdown and the Accept delay start over for each one.
 * - Accept stays disabled for a second after the request appears, and until
 *   the "I have read this request" box is ticked when the request needs it.
 *   Decline (and the Android back button, which declines too) is ignored for
 *   a moment after a request appears, so a double tap cannot decline the
 *   request queued behind it.
 * - "Decline all" answers every queued request of the same app at once.
 * - While open, screenshots and screen recording are blocked and taps are
 *   dropped when another app's window covers GO.
 */
export function QortalRequestExtensionDialog({
  open,
  requestId = null,
  pendingCount = 0,
  sameAppPendingCount = 0,
  message,
  sendPaymentError,
  onAccept,
  onCancel,
  onDeclineAll,
  onCountdownComplete,
}: QortalRequestExtensionDialogProps) {
  useSecureScreen({ secure: open, touchProtection: open });

  if (!open) return null;

  return (
    <Dialog
      open={open}
      aria-labelledby="qortal-request-dialog-title"
      aria-describedby="qortal-request-dialog-description"
      sx={{ zIndex: QORTAL_REQUEST_DIALOG_Z_INDEX }}
      PaperProps={{
        sx: {
          backgroundColor: 'transparent',
          backgroundImage: 'none',
          boxShadow: 'none',
          margin: '16px',
          maxWidth: 'none',
          overflow: 'visible',
        },
      }}
    >
      {/* A request the dialog cannot draw is declined; the next one still
          shows, since each request gets a fresh boundary. */}
      <ErrorBoundary
        key={requestId ?? 'request'}
        fallback={null}
        onCatch={() => onCancel(requestId)}
      >
        <QortalRequestApprovalContent
          requestId={requestId}
          pendingCount={pendingCount}
          sameAppPendingCount={sameAppPendingCount}
          message={message}
          sendPaymentError={sendPaymentError}
          onAccept={onAccept}
          onCancel={onCancel}
          onDeclineAll={onDeclineAll}
          onCountdownComplete={onCountdownComplete}
        />
      </ErrorBoundary>
    </Dialog>
  );
}

type QortalRequestApprovalContentProps = Omit<
  QortalRequestExtensionDialogProps,
  'open'
>;

function QortalRequestApprovalContent({
  requestId = null,
  pendingCount = 0,
  sameAppPendingCount = 0,
  message,
  sendPaymentError,
  onAccept,
  onCancel,
  onDeclineAll,
  onCountdownComplete,
}: QortalRequestApprovalContentProps) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const requestMessage = (message || {}) as MessageQortalRequestExtension;

  // Per request: this component is remounted for every request id.
  const [checkbox1Checked, setCheckbox1Checked] = useState(() =>
    approvalCheckbox1Default(requestMessage)
  );
  const [confirmed, setConfirmed] = useState(false);
  const acceptArmed = useAcceptDelay(true, requestId ?? message);
  const declineArmed = useAcceptDelay(
    true,
    requestId ?? message,
    DECLINE_GUARD_MS
  );

  // Countdown from the wall clock, so it ends when the requester stops
  // waiting even if GO was in the background or the request was queued.
  // The ticking lives in <ApprovalCountdown>, so the rest of the dialog
  // (request details, JSON) renders once per request, not twice a second.
  const [expiresAt] = useState(() =>
    approvalExpiry(requestMessage.expiresAt, Date.now())
  );
  const [totalSeconds] = useState(() =>
    Math.max(1, approvalSecondsLeft(expiresAt, Date.now()))
  );
  const [timedOut, setTimedOut] = useState(false);
  const handleTimeout = useCallback(() => setTimedOut(true), []);
  // Answers only this request, so a repeated call can never time out the
  // request queued behind it.
  const onCountdownCompleteRef = useRef(onCountdownComplete);
  onCountdownCompleteRef.current = onCountdownComplete;
  useEffect(() => {
    if (timedOut) onCountdownCompleteRef.current(requestId);
  }, [requestId, timedOut]);

  const needsConfirm = Boolean(requestMessage.confirmCheckbox);
  const canAccept = acceptArmed && !timedOut && (!needsConfirm || confirmed);

  const handleAccept = () => {
    if (!canAccept) return;
    // Checked again at the tap: the countdown may be a tick behind.
    if (approvalSecondsLeft(expiresAt, Date.now()) <= 0) return;
    onAccept({
      requestId,
      checkbox1: requestMessage.checkbox1 ? checkbox1Checked : undefined,
      confirmed,
    });
  };

  const handleDecline = () => {
    if (!declineArmed) return;
    onCancel(requestId);
  };

  const handleDeclineAll = () => {
    if (!declineArmed || !onDeclineAll) return;
    onDeclineAll();
  };

  // Back declines the request on screen, with the same guard as the button;
  // it never reaches the screens under the dialog.
  useAndroidBack(
    () => {
      handleDecline();
      return true;
    },
    { priority: APPROVAL_BACK_PRIORITY }
  );

  const requestingApp = requestMessage.requestingApp || null;
  const bodyLines = [
    requestMessage.text2,
    requestMessage.text3,
    requestMessage.text4,
  ]
    .filter((line): line is string => typeof line === 'string' && !!line)
    .map(splitDetailLine);
  // What the request is about, in a card. Never the question again.
  const summaryText =
    requestMessage.highlightedText ||
    (requestMessage.text1?.toLowerCase().includes('authenticate')
      ? t('core:approval_dialog.session_only')
      : '');
  const summaryIsAmount = looksLikeAmount(summaryText);
  const hasFees = Boolean(
    requestMessage.fee || requestMessage.appFee || requestMessage.foreignFee
  );
  const dark = theme.palette.mode === 'dark';
  const hairline = alpha(theme.palette.common.white, dark ? 0.08 : 0.06);
  const panelBg = dark ? alpha('#131922', 0.82) : alpha('#f3f6f9', 0.95);
  const wrappingTextSx = {
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
  };

  return (
    <Box
      data-testid="qortal-request-dialog"
      role="group"
      aria-label={t('core:approval_dialog.qapp_request')}
      sx={{
        backgroundColor: dark
          ? alpha('#0d1117', 0.985)
          : alpha('#ffffff', 0.985),
        backgroundImage: 'none',
        border: `1px solid ${alpha(theme.palette.common.white, dark ? 0.07 : 0.06)}`,
        borderRadius: '20px',
        boxShadow: dark
          ? '0px 28px 72px rgba(0, 0, 0, 0.52)'
          : '0px 18px 52px rgba(16, 24, 40, 0.14)',
        color: theme.palette.text.primary,
        display: 'flex',
        flexDirection: 'column',
        // The buttons stay on screen however long the request is.
        maxHeight: 'calc(100dvh - 32px)',
        maxWidth: '520px',
        overflow: 'hidden',
        width: 'min(520px, calc(100vw - 32px))',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flex: '1 1 auto',
          flexDirection: 'column',
          gap: '14px',
          minHeight: 0,
          overflowX: 'hidden',
          overflowY: 'auto',
          padding: '18px 18px 14px',
        }}
      >
        <RequestingAppHeader
          requestingApp={requestingApp}
          countdown={
            <ApprovalCountdown
              expiresAt={expiresAt}
              totalSeconds={totalSeconds}
              onTimeout={handleTimeout}
            />
          }
        />

        <TextP
          id="qortal-request-dialog-title"
          sx={{
            fontSize: '17px',
            fontWeight: 600,
            lineHeight: 1.35,
            ...wrappingTextSx,
          }}
        >
          {requestMessage.text1}
        </TextP>

        {/* A payment shows its amount first, with the recipient under it in
            the same card; other requests list their details, then the card. */}
        {bodyLines.length && !(summaryText && summaryIsAmount) ? (
          <DetailLines lines={bodyLines} />
        ) : null}

        {summaryText ? (
          <Box
            data-testid="qortal-request-summary"
            sx={{
              backgroundColor: alpha(
                theme.palette.primary.main,
                dark ? 0.1 : 0.06
              ),
              border: `1px solid ${alpha(theme.palette.primary.main, dark ? 0.24 : 0.18)}`,
              borderRadius: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              padding: summaryIsAmount ? '12px 14px' : '10px 14px',
            }}
          >
            <Typography
              sx={{
                color: theme.palette.text.primary,
                fontSize: summaryIsAmount ? '24px' : '15px',
                fontWeight: summaryIsAmount ? 700 : 600,
                lineHeight: summaryIsAmount ? 1.2 : 1.45,
                whiteSpace: 'pre-line',
                ...wrappingTextSx,
              }}
            >
              {summaryText}
            </Typography>
            {summaryIsAmount && bodyLines.length ? (
              <DetailLines lines={bodyLines} />
            ) : null}
          </Box>
        ) : null}

        {requestMessage.details && (
          <Box
            sx={{
              color: theme.palette.text.primary,
              fontSize: '14px',
              lineHeight: 1.45,
              width: '100%',
              ...wrappingTextSx,
              '& *': wrappingTextSx,
            }}
          >
            <QortalRequestDetails details={requestMessage.details} />
          </Box>
        )}

        {requestMessage.json && (
          <Box
            data-testid="qortal-request-json"
            sx={{
              backgroundColor: panelBg,
              border: `1px solid ${hairline}`,
              borderRadius: '12px',
              fontSize: '12px',
              maxHeight: '240px',
              maxWidth: '100%',
              overflow: 'auto',
              padding: '6px 8px',
              '& *': { fontSize: '12px' },
              // The viewer's own panel colour would sit inside this one.
              '& > div': { backgroundColor: 'transparent' },
            }}
          >
            <JsonView
              data={requestMessage.json}
              shouldExpandNode={allExpanded}
              style={dark ? darkStyles : defaultStyles}
            />
          </Box>
        )}

        {hasFees && (
          <Box
            sx={{
              borderTop: `1px solid ${hairline}`,
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              paddingTop: '12px',
            }}
          >
            {requestMessage.fee && (
              <FeeRow
                label={t('core:approval_dialog.fee')}
                value={`${requestMessage.fee} QORT`}
              />
            )}
            {requestMessage.appFee && (
              <FeeRow
                label={t('core:approval_dialog.app_fee')}
                value={`${requestMessage.appFee} QORT`}
              />
            )}
            {requestMessage.foreignFee && (
              <FeeRow
                label={t('core:approval_dialog.foreign_fee')}
                value={requestMessage.foreignFee}
              />
            )}
          </Box>
        )}

        {(requestMessage.checkbox1 || needsConfirm) && (
          <Box
            sx={{
              backgroundColor: panelBg,
              border: `1px solid ${alpha(
                needsConfirm
                  ? theme.palette.warning.main
                  : theme.palette.common.white,
                needsConfirm ? 0.28 : dark ? 0.06 : 0.05
              )}`,
              borderRadius: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              padding: '4px 12px',
            }}
          >
            {requestMessage.checkbox1 && (
              <FormControlLabel
                control={
                  <Checkbox
                    onChange={(e) => setCheckbox1Checked(e.target.checked)}
                    checked={checkbox1Checked}
                    edge="start"
                    tabIndex={-1}
                    disableRipple
                    sx={checkboxSx(theme)}
                  />
                }
                label={
                  <Typography
                    sx={{
                      color: theme.palette.text.primary,
                      fontSize: '14px',
                      lineHeight: 1.4,
                      ...wrappingTextSx,
                    }}
                  >
                    {requestMessage.checkbox1?.label}
                  </Typography>
                }
                sx={{ margin: 0 }}
              />
            )}
            {needsConfirm && (
              <FormControlLabel
                control={
                  <Checkbox
                    onChange={(e) => setConfirmed(e.target.checked)}
                    checked={confirmed}
                    edge="start"
                    tabIndex={-1}
                    disableRipple
                    sx={checkboxSx(theme)}
                  />
                }
                label={
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      gap: '6px',
                    }}
                  >
                    <Typography
                      sx={{
                        color: theme.palette.text.primary,
                        fontSize: '14px',
                        lineHeight: 1.4,
                        ...wrappingTextSx,
                      }}
                    >
                      {requestMessage.confirmCheckboxLabel ||
                        t('core:message.success.request_read', {
                          postProcess: 'capitalizeFirstChar',
                        })}
                    </Typography>
                    <PriorityHighIcon
                      color="warning"
                      sx={{ fontSize: '18px' }}
                    />
                  </Box>
                }
                sx={{ margin: 0 }}
              />
            )}
          </Box>
        )}

        {sendPaymentError ? (
          <ErrorText sx={{ width: '100%' }}>{sendPaymentError}</ErrorText>
        ) : null}
      </Box>

      <Box
        sx={{
          borderTop: `1px solid ${hairline}`,
          display: 'flex',
          flex: '0 0 auto',
          flexDirection: 'column',
          gap: '10px',
          padding: '12px 18px 16px',
        }}
      >
        {pendingCount > 0 ? (
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '2px 12px',
              justifyContent: 'space-between',
            }}
          >
            <Typography
              data-testid="qortal-request-pending"
              sx={{
                color: theme.palette.text.secondary,
                fontSize: '13px',
                lineHeight: 1.4,
              }}
            >
              {t('core:approval_dialog.more_waiting', {
                count: pendingCount,
              })}
            </Typography>
            {sameAppPendingCount > 0 && onDeclineAll ? (
              <Button
                data-testid="qortal-request-decline-all"
                size="small"
                variant="text"
                onClick={handleDeclineAll}
                sx={{
                  color: theme.palette.text.secondary,
                  fontSize: '13px',
                  fontWeight: 600,
                  minWidth: 0,
                  px: 1,
                  textTransform: 'none',
                }}
              >
                {t('core:approval_dialog.decline_all', {
                  count: sameAppPendingCount + 1,
                })}
              </Button>
            ) : null}
          </Box>
        ) : null}

        <Box sx={{ display: 'flex', gap: '10px' }}>
          <CustomButtonAccept
            role="button"
            customColor={theme.palette.text.primary}
            customBgColor={
              dark ? alpha('#171d27', 0.96) : alpha('#eef3f8', 0.98)
            }
            sx={{
              border: `1px solid ${hairline}`,
              boxShadow: 'none',
              filter: 'none',
              flex: 1,
              minWidth: 0,
              opacity: 1,
              transition:
                'background-color 180ms ease, border-color 180ms ease',
              '&:hover': {
                backgroundColor: dark
                  ? alpha('#21171c', 0.98)
                  : alpha('#f8eef0', 0.98),
                borderColor: alpha(theme.palette.error.main, 0.2),
                color: theme.palette.text.primary,
              },
            }}
            onClick={handleDecline}
          >
            {t('core:action.decline', { postProcess: 'capitalizeFirstChar' })}
          </CustomButtonAccept>
          <CustomButtonAccept
            role="button"
            aria-disabled={!canAccept}
            data-testid="qortal-request-accept"
            customColor="#06111c"
            customBgColor={dark ? '#76aef4' : '#6da5eb'}
            sx={{
              border: `1px solid ${alpha('#b6d3ff', 0.26)}`,
              boxShadow: 'none',
              cursor: canAccept ? 'pointer' : 'default',
              filter: 'none',
              flex: 1,
              minWidth: 0,
              opacity: canAccept ? 1 : 0.35,
              transition: 'background-color 180ms ease, opacity 180ms ease',
              '&:hover': {
                backgroundColor: dark ? '#86baf8' : '#78aff0',
                color: '#06111c',
                opacity: canAccept ? 1 : 0.35,
              },
            }}
            onClick={handleAccept}
          >
            {t('core:action.accept', { postProcess: 'capitalizeFirstChar' })}
          </CustomButtonAccept>
        </Box>
      </Box>
    </Box>
  );
}

const checkboxSx = (theme: Theme) => ({
  '&.Mui-checked': { color: theme.palette.text.secondary },
  '& .MuiSvgIcon-root': { color: theme.palette.text.secondary },
});

/** "service: VIDEO" → a label/value row; anything else stays a paragraph. */
export function splitDetailLine(line: string): {
  label: string | null;
  value: string;
} {
  const match = /^([^:\n]{1,32}):[ \t]+([\s\S]+)$/.exec(line.trim());
  if (!match || /^https?$/i.test(match[1].trim())) {
    return { label: null, value: line };
  }
  const label = match[1].trim();
  return {
    label: label.charAt(0).toLocaleUpperCase() + label.slice(1),
    value: match[2].trim(),
  };
}

/** "5 QORT", "0.25 LTC": shown large. */
export function looksLikeAmount(text: unknown): boolean {
  return (
    typeof text === 'string' &&
    /^[0-9][0-9.,\u00a0 ]*\s+[A-Za-z]{2,6}$/.test(text.trim())
  );
}

type DetailLine = { label: string | null; value: string };

function DetailLines({ lines }: { lines: DetailLine[] }) {
  const theme = useTheme();
  return (
    <Box
      id="qortal-request-dialog-description"
      sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
    >
      {lines.map((line, index) =>
        line.label ? (
          <DetailRow key={index} label={line.label} value={line.value} />
        ) : (
          <Typography
            key={index}
            sx={{
              color: alpha(theme.palette.text.secondary, 0.92),
              fontSize: '14px',
              lineHeight: 1.5,
              overflowWrap: 'anywhere',
              whiteSpace: 'pre-line',
              wordBreak: 'break-word',
            }}
          >
            {line.value}
          </Typography>
        )
      )}
    </Box>
  );
}

const QORTAL_ADDRESS = /[QA][1-9A-HJ-NP-Za-km-z]{33}/;

/**
 * "alice (Q…)" → the name, then the full address on its own line in a
 * fixed-width font, so it can be checked character by character.
 */
export function splitNameAndAddress(value: string): {
  name: string;
  address: string | null;
} {
  const withName = /^(.*\S)\s*\(([QA][1-9A-HJ-NP-Za-km-z]{33})\)$/.exec(
    value.trim()
  );
  if (withName) return { name: withName[1], address: withName[2] };
  const alone = value.trim();
  if (QORTAL_ADDRESS.test(alone) && alone.length === 34) {
    return { name: '', address: alone };
  }
  return { name: value, address: null };
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  const { name, address } = splitNameAndAddress(value);
  const valueSx = {
    color: theme.palette.text.primary,
    fontSize: '14px',
    fontWeight: 500,
    lineHeight: 1.4,
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
  };
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
      <Typography
        sx={{
          color: alpha(theme.palette.text.secondary, 0.85),
          fontSize: '12px',
          lineHeight: 1.3,
        }}
      >
        {label}
      </Typography>
      {name ? <Typography sx={valueSx}>{name}</Typography> : null}
      {address ? (
        <Typography
          sx={{
            ...valueSx,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: '12.5px',
            fontWeight: 400,
            letterSpacing: '0.01em',
          }}
        >
          {address}
        </Typography>
      ) : null}
    </Box>
  );
}

/**
 * The countdown ring. It owns the ticking clock, so only the ring re-renders
 * while the user reads. Calls `onTimeout` once the requester stops waiting.
 */
function ApprovalCountdown({
  expiresAt,
  totalSeconds,
  onTimeout,
}: {
  expiresAt: number;
  totalSeconds: number;
  onTimeout: () => void;
}) {
  const theme = useTheme();
  const [now, setNow] = useState(() => Date.now());
  const [ringEpoch, setRingEpoch] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 500);
    // Back on screen: the ring catches up with the time spent away.
    const onVisibilityChange = () => {
      tick();
      setRingEpoch((epoch) => epoch + 1);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);
  const secondsLeft = Math.min(
    totalSeconds,
    approvalSecondsLeft(expiresAt, now)
  );
  const timedOut = secondsLeft <= 0;
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;
  useEffect(() => {
    if (timedOut) onTimeoutRef.current();
  }, [timedOut]);

  return (
    <CountdownCircleTimer
      key={ringEpoch}
      isPlaying={!timedOut}
      duration={totalSeconds}
      initialRemainingTime={Math.max(0, secondsLeft)}
      colors={['#2D7FF9', '#E8A13A', '#C45151', '#C45151']}
      colorsTime={[
        totalSeconds,
        Math.min(totalSeconds, 12),
        Math.min(totalSeconds, 3),
        0,
      ]}
      size={38}
      strokeWidth={3}
      trailColor={alpha(theme.palette.common.white, 0.12)}
    >
      {() => (
        <TextP
          data-testid="qortal-request-seconds"
          sx={{ fontSize: '13px', fontWeight: 700 }}
        >
          {Math.max(0, secondsLeft)}
        </TextP>
      )}
    </CountdownCircleTimer>
  );
}

/**
 * The app that asks: its QDN icon, "Requested by <app> [SERVICE]",
 * "Qortal GO" for GO's own screens, or a warning when GO cannot tell.
 * Name and service come only from GO's appInfo, never from the payload.
 */
function RequestingAppHeader({
  requestingApp,
  countdown,
}: {
  requestingApp: RequestingApp | null;
  countdown: ReactNode;
}) {
  const theme = useTheme();
  const { t } = useTranslation(['core']);
  const internal = requestingApp?.internal === true;
  const known = internal || Boolean(requestingApp?.name);

  return (
    <Box
      data-testid="qortal-request-app"
      sx={{ display: 'flex', flexDirection: 'column', gap: '10px' }}
    >
      <Box sx={{ alignItems: 'center', display: 'flex', gap: '12px' }}>
        <RequestingAppAvatar requestingApp={requestingApp} />
        <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
          <Typography
            sx={{
              color: theme.palette.text.secondary,
              fontSize: '12px',
              lineHeight: 1.3,
            }}
          >
            {t('core:approval_dialog.requested_by')}
          </Typography>
          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '2px 8px',
              minWidth: 0,
            }}
          >
            <Typography
              data-testid="qortal-request-app-name"
              sx={{
                color: known
                  ? theme.palette.text.primary
                  : theme.palette.warning.main,
                fontSize: '17px',
                fontWeight: 700,
                lineHeight: 1.3,
                minWidth: 0,
                overflowWrap: 'anywhere',
                // A name never reorders the text around it.
                unicodeBidi: 'isolate',
              }}
            >
              {internal
                ? t('core:approval_dialog.internal_app')
                : known
                  ? requestingApp?.name
                  : t('core:approval_dialog.unknown_app')}
            </Typography>
            {known && !internal && requestingApp?.service ? (
              <Typography
                data-testid="qortal-request-app-service"
                sx={{
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: '6px',
                  color: theme.palette.text.secondary,
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  lineHeight: 1.2,
                  padding: '2px 6px',
                }}
              >
                {requestingApp.service}
              </Typography>
            ) : null}
          </Box>
        </Box>
        <Box sx={{ flex: '0 0 auto' }}>{countdown}</Box>
      </Box>
      {!known ? (
        <Typography
          sx={{
            backgroundColor: alpha(theme.palette.warning.main, 0.08),
            border: `1px solid ${alpha(theme.palette.warning.main, 0.3)}`,
            borderRadius: '12px',
            color: theme.palette.text.secondary,
            fontSize: '13px',
            lineHeight: 1.45,
            padding: '8px 12px',
          }}
        >
          {t('core:approval_dialog.unknown_app_hint')}
        </Typography>
      ) : null}
    </Box>
  );
}

/** The app's QDN icon (qortal_avatar thumbnail), with the Qortal logo as fallback. */
function RequestingAppAvatar({
  requestingApp,
}: {
  requestingApp: RequestingApp | null;
}) {
  const theme = useTheme();
  const internal = requestingApp?.internal === true;
  const name = internal ? '' : requestingApp?.name || '';
  const avatarSx = {
    bgcolor: alpha(theme.palette.primary.main, 0.12),
    borderRadius: '12px',
    flex: '0 0 auto',
    height: 44,
    width: 44,
    '& img': { objectFit: 'cover' },
  };

  if (!internal && !name) {
    return (
      <Avatar
        variant="rounded"
        sx={{
          ...avatarSx,
          bgcolor: alpha(theme.palette.warning.main, 0.14),
          color: theme.palette.warning.main,
        }}
      >
        <PriorityHighIcon />
      </Avatar>
    );
  }

  // An icon must never break the dialog: an error while drawing it would
  // decline the request, so it falls back to the Qortal logo instead. Keyed
  // by app, so a request from another app never shows the last app's icon.
  return (
    <ErrorBoundary key={name} fallback={<QappIconFrame sx={avatarSx} />}>
      <QappIcon name={name} sx={avatarSx} testId="qortal-request-app-icon" />
    </ErrorBoundary>
  );
}

function FeeRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        gap: '12px',
        justifyContent: 'space-between',
      }}
    >
      <Typography
        sx={{
          color: theme.palette.text.secondary,
          fontSize: '13px',
        }}
      >
        {label}
      </Typography>
      <TextP
        sx={{
          fontSize: '14px',
          fontWeight: 700,
          overflowWrap: 'anywhere',
          textAlign: 'right',
          wordBreak: 'break-word',
        }}
      >
        {value}
      </TextP>
    </Box>
  );
}
