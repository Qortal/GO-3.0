import { useCallback, useEffect, useState } from 'react';
import { Box, ButtonBase, IconButton, Popper, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ContentPasteRoundedIcon from '@mui/icons-material/ContentPasteRounded';
import { useTranslation } from 'react-i18next';
import {
  describeClipboardImage,
  readClipboardImageFile,
} from '../../utils/nativeClipboardImage';

/** Copies already pasted or waved away: each is offered once. */
const handledStamps = new Set<number>();

type ClipboardImagePasteChipProps = {
  /** The composer has focus and can take a picture. */
  active: boolean;
  /** The composer, which the chip floats above. */
  anchorEl: HTMLElement | null;
  onPaste: (file: File) => void;
};

/**
 * On Android, while the chat composer has focus and a picture is on the
 * clipboard, a small "Paste image" chip floats above it, like a keyboard's
 * clipboard suggestion. Only whether there is a picture is checked, which
 * Android doesn't announce; the picture is read when the chip is tapped.
 */
export const ClipboardImagePasteChip = ({
  active,
  anchorEl,
  onPaste,
}: ClipboardImagePasteChipProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['group']);
  const [stamp, setStamp] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    const info = await describeClipboardImage();
    setStamp(
      info?.hasImage && !handledStamps.has(info.stamp) ? info.stamp : null
    );
  }, []);

  useEffect(() => {
    if (!active) {
      setStamp(null);
      return;
    }
    void check();
    // Back from another app, where something may just have been copied.
    const recheck = () => {
      if (!document.hidden) void check();
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [active, check]);

  const paste = async () => {
    if (stamp === null || busy) return;
    setBusy(true);
    try {
      const file = await readClipboardImageFile();
      if (file) onPaste(file);
    } finally {
      handledStamps.add(stamp);
      setStamp(null);
      setBusy(false);
    }
  };

  const dismiss = () => {
    if (stamp !== null) handledStamps.add(stamp);
    setStamp(null);
  };

  const capitalized = { postProcess: 'capitalizeFirstChar' } as const;
  const isDark = theme.palette.mode === 'dark';

  return (
    <Popper
      anchorEl={anchorEl}
      modifiers={[{ name: 'offset', options: { offset: [8, 8] } }]}
      open={Boolean(active && anchorEl && stamp !== null)}
      placement="top-start"
      sx={{ zIndex: theme.zIndex.modal - 1 }}
    >
      <Box
        // Keeps the composer focused (and the keyboard up) through the tap.
        onMouseDown={(event) => event.preventDefault()}
        onPointerDown={(event) => event.preventDefault()}
        sx={{
          alignItems: 'center',
          backgroundColor: isDark
            ? theme.palette.background.elevated
            : theme.palette.background.paper,
          borderRadius: '20px',
          boxShadow: isDark
            ? `0 0 0 1px ${alpha(theme.palette.common.white, 0.08)}, 0 8px 22px rgba(0, 0, 0, 0.45)`
            : `0 0 0 1px ${alpha(theme.palette.common.black, 0.08)}, 0 8px 20px rgba(0, 0, 0, 0.16)`,
          display: 'flex',
          pr: '2px',
          '@keyframes clipboardChipIn': {
            from: { opacity: 0, transform: 'translateY(6px) scale(0.92)' },
            to: { opacity: 1, transform: 'none' },
          },
          animation: 'clipboardChipIn 200ms cubic-bezier(0.2, 0.8, 0.2, 1)',
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        }}
      >
        <ButtonBase
          disabled={busy}
          onClick={() => void paste()}
          sx={{
            borderRadius: '20px',
            color: 'primary.main',
            fontSize: '14.5px',
            fontWeight: 600,
            gap: '8px',
            height: 40,
            pl: '14px',
            pr: '6px',
          }}
        >
          <ContentPasteRoundedIcon sx={{ fontSize: 20 }} />
          {t('group:chat_group.paste_image', capitalized)}
        </ButtonBase>
        <IconButton
          aria-label={t('group:chat_group.dismiss_paste_image', capitalized)}
          onClick={dismiss}
          size="small"
          sx={{ color: 'text.secondary', height: 36, width: 36 }}
        >
          <CloseRoundedIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Box>
    </Popper>
  );
};
