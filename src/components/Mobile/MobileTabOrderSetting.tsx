import { Box, ButtonBase, Typography, alpha, useTheme } from '@mui/material';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import AppsRoundedIcon from '@mui/icons-material/AppsRounded';
import ChatRoundedIcon from '@mui/icons-material/ChatRounded';
import {
  AnimatePresence,
  Reorder,
  motion,
  useReducedMotion,
} from 'framer-motion';
import { useAtom } from 'jotai';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_MOBILE_TAB_ORDER,
  isDefaultMobileTabOrder,
  mobileTabOrderAtom,
  moveMobileTab,
  type MobileTabKey,
} from './mobileTabOrder';

const BUTTONS: Record<
  MobileTabKey,
  { Icon: typeof HomeRoundedIcon; label: [key: string, fallback: string] }
> = {
  home: { Icon: HomeRoundedIcon, label: ['bottom_buttons_home', 'Home'] },
  apps: { Icon: AppsRoundedIcon, label: ['bottom_buttons_apps', 'Apps'] },
  chat: { Icon: ChatRoundedIcon, label: ['bottom_buttons_chat', 'Chat'] },
};

/** Same size as the real round buttons (MobileTabBar, floating). */
const BUTTON_PX = 54;

/**
 * System settings row (GO phones): the round Home, Apps and Chat buttons as
 * they sit on the bottom bar, dragged sideways into a new order. The bar and
 * the sideways swipe between sections take the order when a drag ends (not
 * on every step of it, so nothing behind the dialog relays out mid-drag).
 */
export const MobileTabOrderSetting = () => {
  const theme = useTheme();
  const { t } = useTranslation(['group']);
  const [order, setOrder] = useAtom(mobileTabOrderAtom);
  const reduceMotion = useReducedMotion();
  const isDark = theme.palette.mode === 'dark';
  const td = (key: string, defaultValue: string) =>
    t(`group:dashboard.${key}`, { defaultValue });

  // What the row shows: the saved order, or a drag's while it lasts.
  const [shown, setShown] = useState<readonly MobileTabKey[]>(order);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const [dragging, setDragging] = useState<MobileTabKey | null>(null);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Partial<Record<MobileTabKey, HTMLDivElement | null>>>(
    {}
  );

  useEffect(() => {
    if (!dragging) setShown(order);
  }, [order, dragging]);

  const commit = (next: readonly MobileTabKey[]) => {
    setShown(next);
    if (next.some((key, i) => key !== order[i])) setOrder(next);
  };

  const onKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
    key: MobileTabKey
  ) => {
    // In the layout's reading direction: Arrow Left moves it left on screen.
    const rtl = theme.direction === 'rtl';
    const by =
      event.key === 'ArrowLeft'
        ? rtl
          ? 1
          : -1
        : event.key === 'ArrowRight'
          ? rtl
            ? -1
            : 1
          : 0;
    if (!by) return;
    event.preventDefault();
    const next = moveMobileTab(shownRef.current, key, by);
    if (next === shownRef.current) return;
    commit(next);
    // The item moved in the DOM: keep the keyboard on it.
    window.requestAnimationFrame(() => itemRefs.current[key]?.focus());
  };

  const glass = isDark
    ? alpha(theme.palette.background.paper, 0.72)
    : alpha(theme.palette.background.paper, 0.86);
  const layoutTransition = reduceMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 520, damping: 40 };
  const isDefault = isDefaultMobileTabOrder(shown);

  return (
    <Box sx={{ px: 1.35, py: 1.2 }}>
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          gap: 1,
          justifyContent: 'space-between',
          minHeight: 26,
        }}
      >
        <Typography
          sx={{
            color: theme.palette.text.primary,
            fontSize: '0.82rem',
            fontWeight: 700,
            letterSpacing: '0.01em',
          }}
        >
          {td('bottom_buttons', 'Bottom buttons')}
        </Typography>
        <AnimatePresence initial={false}>
          {isDefault ? null : (
            <motion.div
              key="reset"
              initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduceMotion ? undefined : { opacity: 0, scale: 0.9 }}
              transition={{ duration: reduceMotion ? 0 : 0.16 }}
            >
              <ButtonBase
                onClick={() => commit(DEFAULT_MOBILE_TAB_ORDER)}
                sx={{
                  borderRadius: 999,
                  color: theme.palette.primary.main,
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  px: 1,
                  py: 0.35,
                }}
              >
                {td('bottom_buttons_reset', 'Reset')}
              </ButtonBase>
            </motion.div>
          )}
        </AnimatePresence>
      </Box>
      <Typography
        sx={{
          color: theme.palette.text.secondary,
          fontSize: '0.75rem',
          lineHeight: 1.45,
          mt: 0.4,
        }}
      >
        {td(
          'bottom_buttons_desc',
          'Drag Home, Apps and Chat into the order you like. Swiping sideways between them follows the same order.'
        )}
      </Typography>

      <Box
        sx={{
          backgroundColor: isDark
            ? alpha(theme.palette.common.white, 0.05)
            : alpha(theme.palette.common.black, 0.05),
          border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
          borderRadius: '14px',
          mt: 1.1,
          px: 1,
          py: 1.1,
        }}
      >
        <Reorder.Group
          as="div"
          ref={groupRef}
          axis="x"
          values={shown as MobileTabKey[]}
          onReorder={(next: MobileTabKey[]) => setShown(next)}
          role="list"
          aria-label={td('bottom_buttons', 'Bottom buttons')}
          style={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'space-around',
            listStyle: 'none',
            margin: 0,
            padding: 0,
          }}
        >
          {shown.map((key, index) => {
            const { Icon, label } = BUTTONS[key];
            const name = td(label[0], label[1]);
            const lifted = dragging === key;
            return (
              <Reorder.Item
                as="div"
                key={key}
                value={key}
                ref={(node: HTMLDivElement | null) => {
                  itemRefs.current[key] = node;
                }}
                role="listitem"
                tabIndex={0}
                aria-label={t('group:dashboard.bottom_buttons_item_label', {
                  defaultValue:
                    '{{name}}, {{place}} of {{total}}. Use the left and right arrow keys to move it.',
                  name,
                  place: index + 1,
                  total: shown.length,
                })}
                dragConstraints={groupRef}
                dragElastic={0.12}
                transition={layoutTransition}
                whileDrag={reduceMotion ? undefined : { scale: 1.08 }}
                onDragStart={() => setDragging(key)}
                onDragEnd={() => {
                  setDragging(null);
                  commit(shownRef.current);
                }}
                onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) =>
                  onKeyDown(event, key)
                }
                style={{
                  alignItems: 'center',
                  cursor: lifted ? 'grabbing' : 'grab',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  outline: 'none',
                  position: 'relative',
                  zIndex: lifted ? 1 : 0,
                }}
              >
                <Box
                  sx={{
                    alignItems: 'center',
                    backdropFilter: 'blur(14px) saturate(140%)',
                    backgroundColor: lifted
                      ? alpha(theme.palette.primary.main, isDark ? 0.24 : 0.16)
                      : glass,
                    border: `1px solid ${
                      lifted
                        ? alpha(theme.palette.primary.main, 0.55)
                        : alpha(theme.palette.text.primary, isDark ? 0.12 : 0.1)
                    }`,
                    borderRadius: '50%',
                    boxShadow: lifted
                      ? isDark
                        ? '0 10px 22px rgba(0,0,0,0.5)'
                        : '0 10px 22px rgba(15,20,30,0.2)'
                      : isDark
                        ? '0 4px 12px rgba(0,0,0,0.35)'
                        : '0 4px 12px rgba(15,20,30,0.12)',
                    display: 'flex',
                    height: BUTTON_PX,
                    justifyContent: 'center',
                    transition:
                      'background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease',
                    width: BUTTON_PX,
                    '[role="listitem"]:focus-visible > &': {
                      outline: `2px solid ${theme.palette.primary.main}`,
                      outlineOffset: 2,
                    },
                  }}
                >
                  <Icon
                    sx={{
                      color: lifted
                        ? theme.palette.primary.main
                        : theme.palette.text.secondary,
                      fontSize: 26,
                      pointerEvents: 'none',
                    }}
                  />
                </Box>
                <Typography
                  component="span"
                  sx={{
                    color: theme.palette.text.secondary,
                    fontSize: '0.7rem',
                    fontWeight: 600,
                    lineHeight: 1,
                    pointerEvents: 'none',
                    userSelect: 'none',
                  }}
                >
                  {name}
                </Typography>
              </Reorder.Item>
            );
          })}
        </Reorder.Group>
      </Box>
    </Box>
  );
};
