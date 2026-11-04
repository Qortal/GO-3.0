import { Box, IconButton, InputBase, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import { motion, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQortinoSettings } from '../../../qortinoAgent/settings';

type Props = {
  onFocusChange: (focused: boolean) => void;
  onSend: (question: string) => void;
};

/**
 * The little box next to Qortino on Home, once Qortino AI is on the phone:
 * a question typed here opens Qortino in a new chat and is sent there.
 */
export function QortinoHomeComposer({ onFocusChange, onSend }: Props) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { t } = useTranslation(['core']);
  const { enterSends } = useQortinoSettings();
  const reduceMotion = Boolean(useReducedMotion());
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const canSend = text.trim().length > 0;

  // The keyboard opens over the bottom of Home, where the tab bar stays:
  // once it is up, bring the box to the middle of what is left.
  useEffect(() => {
    if (!focused) return;
    const bringIntoView = () =>
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', bringIntoView);
    const timer = window.setTimeout(bringIntoView, 450);
    return () => {
      viewport?.removeEventListener('resize', bringIntoView);
      window.clearTimeout(timer);
    };
  }, [focused]);

  const submit = () => {
    const question = text.trim();
    if (!question) return;
    setText('');
    inputRef.current?.blur();
    onSend(question);
  };

  return (
    <motion.div
      initial={
        reduceMotion ? { opacity: 0 } : { opacity: 0, x: -18, scale: 0.94 }
      }
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26, delay: 0.1 }}
      style={{ transformOrigin: '0% 50%', width: '100%' }}
    >
      <Box
        component="form"
        ref={formRef}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        sx={{
          alignItems: 'flex-end',
          background: isDark
            ? 'linear-gradient(180deg, rgba(28,34,44,0.9) 0%, rgba(17,21,28,0.96) 100%)'
            : 'linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(244,248,253,0.98) 100%)',
          border: `1px solid ${alpha('#8DB8FF', focused ? 0.62 : isDark ? 0.24 : 0.36)}`,
          borderRadius: '18px',
          boxShadow: focused
            ? `0 0 0 3px ${alpha('#8DB8FF', isDark ? 0.14 : 0.18)}, 0 12px 24px ${alpha('#000', isDark ? 0.22 : 0.08)}`
            : `0 10px 20px ${alpha('#000', isDark ? 0.18 : 0.06)}`,
          display: 'flex',
          gap: 0.25,
          maxWidth: { xs: 'calc(100% - 2px)', sm: '220px' },
          minWidth: 0,
          pl: 1.25,
          pr: 0.4,
          py: 0.4,
          transition: 'border-color 180ms ease, box-shadow 220ms ease',
        }}
      >
        <InputBase
          inputRef={inputRef}
          maxRows={3}
          multiline
          onBlur={() => {
            setFocused(false);
            onFocusChange(false);
          }}
          onChange={(event) => setText(event.target.value)}
          onFocus={() => {
            setFocused(true);
            onFocusChange(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && enterSends) {
              event.preventDefault();
              submit();
            }
          }}
          inputProps={{
            'aria-label': t('core:qortino_workspace.composer.placeholder'),
            enterKeyHint: enterSends ? 'send' : 'enter',
            maxLength: 2000,
          }}
          placeholder={t('core:qortino_workspace.composer.placeholder')}
          sx={{
            color: alpha(theme.palette.text.primary, 0.95),
            flex: 1,
            fontSize: '0.8rem',
            lineHeight: 1.35,
            minWidth: 0,
            py: 0.55,
            '& textarea::placeholder': {
              color: alpha(theme.palette.text.primary, 0.5),
              opacity: 1,
            },
          }}
          value={text}
        />
        <IconButton
          aria-label={t('core:qortino_workspace.composer.send')}
          disabled={!canSend}
          size="small"
          type="submit"
          sx={{
            background: canSend
              ? alpha('#8DB8FF', isDark ? 0.3 : 0.26)
              : 'transparent',
            color: canSend
              ? theme.palette.text.primary
              : alpha(theme.palette.text.primary, 0.32),
            height: 30,
            transition: 'background 160ms ease, transform 160ms ease',
            width: 30,
            '&:active': { transform: 'scale(0.9)' },
            '&:hover': { background: alpha('#8DB8FF', isDark ? 0.36 : 0.32) },
          }}
        >
          <ArrowUpwardRoundedIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Box>
    </motion.div>
  );
}
