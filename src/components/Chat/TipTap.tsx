import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Editor, EditorProvider, useCurrentEditor } from '@tiptap/react';
import { Fragment, Slice } from '@tiptap/pm/model';
import type { EditorProps as ProseMirrorEditorProps } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import { Color } from '@tiptap/extension-color';
import ListItem from '@tiptap/extension-list-item';
import TextStyle from '@tiptap/extension-text-style';
import Placeholder from '@tiptap/extension-placeholder';
import { createNamedFile } from '../../utils/namedFile';
import { stripImageFileMetadata } from '../../utils/imageCompression';
import IconButton from '@mui/material/IconButton';
import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FormatItalicIcon from '@mui/icons-material/FormatItalic';
import StrikethroughSIcon from '@mui/icons-material/StrikethroughS';
import FormatClearIcon from '@mui/icons-material/FormatClear';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered';
import CodeIcon from '@mui/icons-material/Code';
import ImageIcon from '@mui/icons-material/Image'; // Import Image icon
import FormatQuoteIcon from '@mui/icons-material/FormatQuote';
import HorizontalRuleIcon from '@mui/icons-material/HorizontalRule';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';
import KeyboardReturnRoundedIcon from '@mui/icons-material/KeyboardReturnRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import OpenInFullRoundedIcon from '@mui/icons-material/OpenInFullRounded';
import CloseFullscreenRoundedIcon from '@mui/icons-material/CloseFullscreenRounded';
import KeyboardOutlinedIcon from '@mui/icons-material/KeyboardOutlined';
import SentimentSatisfiedAltOutlinedIcon from '@mui/icons-material/SentimentSatisfiedAltOutlined';
import { ReactionPicker } from '../ReactionPicker';
import FormatHeadingIcon from '@mui/icons-material/FormatSize';
import DeveloperModeIcon from '@mui/icons-material/DeveloperMode';
import Compressor from 'compressorjs';
import Mention, { MentionPluginKey } from '@tiptap/extension-mention';
// Its alignment icons are inlined at build time instead of loaded from
// Google: see tools/vite/inlineResizeImageIcons.ts.
import ImageResize from 'tiptap-extension-resize-image';
import tippy from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import { ReactRenderer } from '@tiptap/react';
import MentionList from './MentionList';
import { isDisabledEditorEnterAtom } from '../../atoms/global.js';
import {
  alpha,
  Box,
  Checkbox,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  mobileChatComposeActiveAtom,
  mobileEmojiPanelOpenAtom,
  mobileFullscreenComposerActiveAtom,
} from '../../atoms/global.js';
import { MOBILE_CHAT_TOOLBAR_SLOT_ID } from '../Mobile/mobileChatCompose';
import { FULLSCREEN_COMPOSER_ATTACHMENTS_SLOT_ID } from './composerSlots';
import { restoreComposerTyping } from './composerKeyboard';
import {
  COMPOSER_CORNER_BUTTON_PX,
  COMPOSER_CORNER_CSS_VARS,
  COMPOSER_CORNER_ICON_PX,
  COMPOSER_DISPLACED_GUTTER,
  COMPOSER_EXPAND_ICON_PX,
  COMPOSER_FORMAT_LABEL_PX,
  COMPOSER_FOUR_SLOT_PX,
  COMPOSER_INLINE_TEXT_GUTTERS,
  COMPOSER_SEND_BUTTON_PX,
  COMPOSER_SQUEEZED_TEXT_GUTTERS,
  COMPOSER_STAGE_FLOOR,
  COMPOSER_STAGE_THREE_MAX_PX,
} from './composerCornerLayout';
import {
  closePanelOnOutsideTap,
  isPanelKeyboardSuppressed,
  setEmojiPanelHandler,
  setGifPanelHandler,
} from '../Mobile/emojiPanelBus';
import type { LibraryGif } from './gifs/libraryGifs';
import { SAFE_AREA_BOTTOM, SAFE_AREA_TOP } from '../../utils/mobileSafeArea';
import { fileToBase64 } from '../../utils/fileReading/index.js';
import { useSoftKeyboardOpen } from '../../hooks/useSoftKeyboardOpen';
import {
  getLastSoftKeyboardHeight,
  useSoftKeyboardInset,
} from '../../hooks/useSoftKeyboardInset';
import {
  getGoLayout,
  isGoLayout,
  useGoLayout,
  useShortLandscape,
  type GoLayout,
} from '../../layout/goLayout';
import { layoutSettleWaitMs, LAYOUT_SETTLE_MS } from './landscapeComposer';
import { useAndroidBack, BACK_PRIORITY } from '../../utils/androidBack';
import {
  claimKeyboardImageTarget,
  hasNativeClipboardImages,
  noteClipboardIssue,
  readClipboardImageFile,
} from '../../utils/nativeClipboardImage';
import { ClipboardImagePasteChip } from './ClipboardImagePasteChip';
import {
  cleanPastedFiles,
  describeLastCleanFailure,
} from '../../utils/cleanPastedImage';
import { executeEvent } from '../../utils/events';
import { useTranslation } from 'react-i18next';
import i18n from 'i18next';

/** True if the composer has anything sendable, including a lone space.
 *  Empty TipTap docs are "" or newline-only; those stay unsendable. */
export const composerHasSendableText = (text: string | null | undefined) =>
  /[^\n]/.test(String(text ?? ''));

const selectLayoutEpoch = (l: GoLayout) => l.epoch;

const MenuBar = memo(
  ({
    setEditorRef,
    isChat,
    isDisabledEditorEnter,
    setIsDisabledEditorEnter,
    toolbarStyle = 'default',
    isMobile = false,
    toolbarInTopBar = false,
    topBarExtraActions = null,
    insertFiles,
  }: {
    setEditorRef: (editor: Editor | null) => void;
    isChat: boolean;
    isDisabledEditorEnter: boolean;
    setIsDisabledEditorEnter: (val: boolean) => void;
    toolbarStyle?: string;
    isMobile?: boolean;
    toolbarInTopBar?: boolean;
    topBarExtraActions?: ReactNode;
    insertFiles?: (files: File[]) => void | Promise<void>;
  }) => {
    const { editor } = useCurrentEditor();
    const fileInputRef = useRef(null);
    const theme = useTheme();
    const { t } = useTranslation([
      'auth',
      'core',
      'group',
      'question',
      'tutorial',
    ]);

    useEffect(() => {
      if (editor && setEditorRef) {
        setEditorRef(editor);
      }
    }, [editor, setEditorRef]);

    const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);

    useLayoutEffect(() => {
      if (!toolbarInTopBar) {
        setPortalHost(null);
        return;
      }

      const host = document.getElementById(MOBILE_CHAT_TOOLBAR_SLOT_ID);
      if (host) {
        setPortalHost(host);
        return;
      }

      const frame = requestAnimationFrame(() => {
        setPortalHost(document.getElementById(MOBILE_CHAT_TOOLBAR_SLOT_ID));
      });
      return () => cancelAnimationFrame(frame);
    }, [toolbarInTopBar]);

    const handleImageUpload = async (file) => {
      if (!file?.type?.includes('image')) return;
      let compressedFile;
      await new Promise<void>((resolve) => {
        new Compressor(file, {
          quality: 0.6,
          maxWidth: 1200,
          mimeType: 'image/webp',
          success(result) {
            compressedFile = createNamedFile([result], 'image.webp', {
              type: 'image/webp',
            });
            resolve();
          },
          error(err) {
            console.error('Image compression error:', err);
            resolve();
          },
        });
      });

      if (compressedFile) {
        // Strict mode can hand back the original WebP, EXIF and all.
        compressedFile = await stripImageFileMetadata(compressedFile);
        const reader = new FileReader();
        reader.onload = () => {
          const url = reader.result;
          if (!editor.isDestroyed) {
            editor
              .chain()
              .focus()
              .setImage({ src: url, style: 'width: auto' })
              .run();
          }
          if (fileInputRef.current) {
            fileInputRef.current.value = '';
          }
        };
        reader.readAsDataURL(compressedFile);
      }
    };

    const triggerImageUpload = () => {
      fileInputRef.current?.click(); // Trigger the file input click
    };

    const handlePaste = (event) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            event.preventDefault(); // Prevent the default paste behavior
            handleImageUpload(file); // Call the image upload function
          }
        }
      }
    };

    useEffect(() => {
      if (editor && !isChat) {
        editor.view.dom.addEventListener('paste', handlePaste);
        return () => {
          editor.view.dom.removeEventListener('paste', handlePaste);
        };
      }
    }, [editor, isChat]);

    // After every hook: returning before the paste effect above changed the
    // hook count between renders (react-hooks/rules-of-hooks).
    if (!editor) {
      return null;
    }

    // An enabled mark reads as blue on a tinted pill; a plain brightness shift
    // was too subtle to tell on/off apart at a glance.
    const iconButtonSx = (isActive: boolean) => ({
      backgroundColor: isActive
        ? alpha(theme.palette.primary.main, 0.16)
        : 'transparent',
      borderRadius: '8px',
      color: isActive
        ? theme.palette.primary.main
        : theme.palette.text.secondary,
      flexShrink: 0,
      padding: isMobile && isChat ? '6px' : isMobile ? '3px' : '4px',
      minWidth: isMobile && isChat ? 40 : undefined,
      minHeight: isMobile && isChat ? 40 : undefined,
      transition: 'background-color 120ms ease, color 120ms ease',
      '&:hover': {
        backgroundColor: isActive
          ? alpha(theme.palette.primary.main, 0.24)
          : theme.palette.action.hover,
        color: isActive
          ? theme.palette.primary.main
          : theme.palette.text.primary,
      },
    });

    const iconSize = isMobile && isChat ? '22px' : isMobile ? '18px' : '20px';

    const toolbarButtons = (
      <>
        <IconButton
          size={isMobile && isChat ? 'medium' : 'small'}
          onClick={() => editor.chain().focus().toggleBold().run()}
          disabled={!editor.can().chain().focus().toggleBold().run()}
          sx={iconButtonSx(editor.isActive('bold'))}
        >
          <FormatBoldIcon sx={{ fontSize: iconSize }} />
        </IconButton>

        <IconButton
          size={isMobile && isChat ? 'medium' : 'small'}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          disabled={!editor.can().chain().focus().toggleItalic().run()}
          sx={iconButtonSx(editor.isActive('italic'))}
        >
          <FormatItalicIcon sx={{ fontSize: iconSize }} />
        </IconButton>

        <IconButton
          size={isMobile && isChat ? 'medium' : 'small'}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          disabled={!editor.can().chain().focus().toggleStrike().run()}
          sx={iconButtonSx(editor.isActive('strike'))}
        >
          <StrikethroughSIcon sx={{ fontSize: iconSize }} />
        </IconButton>

        <IconButton
          size={isMobile && isChat ? 'medium' : 'small'}
          onClick={() => editor.chain().focus().toggleCode().run()}
          disabled={!editor.can().chain().focus().toggleCode().run()}
          sx={iconButtonSx(editor.isActive('code'))}
        >
          <CodeIcon sx={{ fontSize: iconSize }} />
        </IconButton>

        <IconButton
          size={isMobile && isChat ? 'medium' : 'small'}
          onClick={() => editor.chain().focus().unsetAllMarks().run()}
          sx={iconButtonSx(
            editor.isActive('bold') ||
              editor.isActive('italic') ||
              editor.isActive('strike') ||
              editor.isActive('code')
          )}
        >
          <FormatClearIcon sx={{ fontSize: iconSize }} />
        </IconButton>

        <IconButton
          size={isMobile && isChat ? 'medium' : 'small'}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          sx={iconButtonSx(editor.isActive('bulletList'))}
        >
          <FormatListBulletedIcon sx={{ fontSize: iconSize }} />
        </IconButton>

        <IconButton
          size={isMobile && isChat ? 'medium' : 'small'}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          sx={iconButtonSx(editor.isActive('orderedList'))}
        >
          <FormatListNumberedIcon sx={{ fontSize: iconSize }} />
        </IconButton>

        <IconButton
          size={isMobile && isChat ? 'medium' : 'small'}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          sx={iconButtonSx(editor.isActive('codeBlock'))}
        >
          <DeveloperModeIcon sx={{ fontSize: iconSize }} />
        </IconButton>

        <IconButton
          size={isMobile && isChat ? 'medium' : 'small'}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          sx={iconButtonSx(editor.isActive('blockquote'))}
        >
          <FormatQuoteIcon sx={{ fontSize: iconSize }} />
        </IconButton>

        <IconButton
          size={isMobile && isChat ? 'medium' : 'small'}
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          disabled={!editor.can().chain().focus().setHorizontalRule().run()}
          sx={iconButtonSx(false)}
        >
          <HorizontalRuleIcon sx={{ fontSize: iconSize }} />
        </IconButton>

        <IconButton
          size={isMobile && isChat ? 'medium' : 'small'}
          onClick={() =>
            editor.chain().focus().toggleHeading({ level: 1 }).run()
          }
          sx={iconButtonSx(editor.isActive('heading', { level: 1 }))}
        >
          <FormatHeadingIcon sx={{ fontSize: iconSize }} />
        </IconButton>

        <IconButton
          size={isMobile && isChat ? 'medium' : 'small'}
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().chain().focus().undo().run()}
          sx={iconButtonSx(false)}
        >
          <UndoIcon sx={{ fontSize: iconSize }} />
        </IconButton>

        <IconButton
          size={isMobile && isChat ? 'medium' : 'small'}
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().chain().focus().redo().run()}
          sx={iconButtonSx(false)}
        >
          <RedoIcon sx={{ fontSize: iconSize }} />
        </IconButton>
      </>
    );

    const mobileChatToolbarRows = isMobile && isChat && (
      <Box className="chat-format-toolbar chat-format-toolbar--two-rows">
        <Box className="chat-format-toolbar-row">
          <IconButton
            size="medium"
            onClick={() => editor.chain().focus().toggleBold().run()}
            disabled={!editor.can().chain().focus().toggleBold().run()}
            sx={iconButtonSx(editor.isActive('bold'))}
          >
            <FormatBoldIcon sx={{ fontSize: iconSize }} />
          </IconButton>
          <IconButton
            size="medium"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            disabled={!editor.can().chain().focus().toggleItalic().run()}
            sx={iconButtonSx(editor.isActive('italic'))}
          >
            <FormatItalicIcon sx={{ fontSize: iconSize }} />
          </IconButton>
          <IconButton
            size="medium"
            onClick={() => editor.chain().focus().toggleStrike().run()}
            disabled={!editor.can().chain().focus().toggleStrike().run()}
            sx={iconButtonSx(editor.isActive('strike'))}
          >
            <StrikethroughSIcon sx={{ fontSize: iconSize }} />
          </IconButton>
          <IconButton
            size="medium"
            onClick={() => editor.chain().focus().toggleCode().run()}
            disabled={!editor.can().chain().focus().toggleCode().run()}
            sx={iconButtonSx(editor.isActive('code'))}
          >
            <CodeIcon sx={{ fontSize: iconSize }} />
          </IconButton>
          <IconButton
            size="medium"
            onClick={() => editor.chain().focus().unsetAllMarks().run()}
            sx={iconButtonSx(
              editor.isActive('bold') ||
                editor.isActive('italic') ||
                editor.isActive('strike') ||
                editor.isActive('code')
            )}
          >
            <FormatClearIcon sx={{ fontSize: iconSize }} />
          </IconButton>
          <IconButton
            size="medium"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            sx={iconButtonSx(editor.isActive('bulletList'))}
          >
            <FormatListBulletedIcon sx={{ fontSize: iconSize }} />
          </IconButton>
          <IconButton
            size="medium"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            sx={iconButtonSx(editor.isActive('orderedList'))}
          >
            <FormatListNumberedIcon sx={{ fontSize: iconSize }} />
          </IconButton>
        </Box>
        <Box className="chat-format-toolbar-row">
          <IconButton
            size="medium"
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            sx={iconButtonSx(editor.isActive('codeBlock'))}
          >
            <DeveloperModeIcon sx={{ fontSize: iconSize }} />
          </IconButton>
          <IconButton
            size="medium"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            sx={iconButtonSx(editor.isActive('blockquote'))}
          >
            <FormatQuoteIcon sx={{ fontSize: iconSize }} />
          </IconButton>
          <IconButton
            size="medium"
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            disabled={!editor.can().chain().focus().setHorizontalRule().run()}
            sx={iconButtonSx(false)}
          >
            <HorizontalRuleIcon sx={{ fontSize: iconSize }} />
          </IconButton>
          <IconButton
            size="medium"
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 1 }).run()
            }
            sx={iconButtonSx(editor.isActive('heading', { level: 1 }))}
          >
            <FormatHeadingIcon sx={{ fontSize: iconSize }} />
          </IconButton>
          <IconButton
            size="medium"
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().chain().focus().undo().run()}
            sx={iconButtonSx(false)}
          >
            <UndoIcon sx={{ fontSize: iconSize }} />
          </IconButton>
          <IconButton
            size="medium"
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().chain().focus().redo().run()}
            sx={iconButtonSx(false)}
          >
            <RedoIcon sx={{ fontSize: iconSize }} />
          </IconButton>
          {/* Which way the toggle currently sits matters more than saving a
              few pixels here, so the state is spelled out rather than implied
              by an icon tint. */}
          <Box
            component="button"
            type="button"
            onClick={() => setIsDisabledEditorEnter(!isDisabledEditorEnter)}
            sx={{
              alignItems: 'center',
              backgroundColor: isDisabledEditorEnter
                ? 'transparent'
                : alpha(theme.palette.primary.main, 0.16),
              border: `1px solid ${
                isDisabledEditorEnter
                  ? theme.palette.divider
                  : alpha(theme.palette.primary.main, 0.55)
              }`,
              borderRadius: '8px',
              color: isDisabledEditorEnter
                ? theme.palette.text.secondary
                : theme.palette.primary.main,
              cursor: 'pointer',
              display: 'inline-flex',
              flexShrink: 0,
              fontFamily: 'Inter',
              fontSize: 11,
              fontWeight: 700,
              gap: '4px',
              marginLeft: '6px',
              minHeight: 34,
              padding: '0 8px',
              transition: 'background-color 120ms ease, color 120ms ease',
              whiteSpace: 'nowrap',
            }}
          >
            <KeyboardReturnRoundedIcon sx={{ fontSize: 16 }} />
            {isDisabledEditorEnter
              ? t('core:composer.enter_new_line')
              : t('core:composer.enter_send')}
          </Box>
          {topBarExtraActions}
        </Box>
      </Box>
    );

    const toolbarShell = (
      <Box
        className={isMobile && isChat ? 'chat-format-toolbar-shell' : undefined}
        sx={{
          backgroundColor: isChat
            ? toolbarInTopBar
              ? 'transparent'
              : isMobile
                ? theme.palette.background.paper
                : 'transparent'
            : theme.palette.background.paper,
          border: isChat || toolbarInTopBar ? 'none' : '1px solid',
          borderBottom: isChat && !toolbarInTopBar ? '1px solid' : undefined,
          borderColor: theme.palette.divider,
          borderRadius: isChat
            ? isMobile && !toolbarInTopBar
              ? 0
              : '8px 8px 0 0'
            : '10px 10px 0 0',
          flexShrink: 0,
          padding: toolbarInTopBar
            ? '4px 6px 2px'
            : isMobile && isChat
              ? '8px 6px 6px'
              : isMobile
                ? '6px 4px'
                : isChat
                  ? '8px 10px 10px'
                  : '6px 10px 8px',
          width: '100%',
        }}
      >
        {toolbarInTopBar
          ? // Two rows so every formatting action is visible without scrolling
            // (the single scrollable row hid half the buttons off-screen).
            mobileChatToolbarRows || (
              <Box
                className="chat-format-toolbar chat-format-toolbar--top-bar"
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  flexWrap: 'nowrap',
                  gap: 0,
                  justifyContent: 'flex-start',
                  overflowX: 'auto',
                  scrollbarWidth: 'none',
                  WebkitOverflowScrolling: 'touch',
                  width: '100%',
                  '&::-webkit-scrollbar': { display: 'none' },
                }}
              >
                {toolbarButtons}
                {topBarExtraActions}
              </Box>
            )
          : mobileChatToolbarRows || (
              <Box
                className={
                  isMobile && isChat ? 'chat-format-toolbar' : undefined
                }
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  flexWrap: isMobile ? 'nowrap' : 'wrap',
                  gap: isMobile ? 0 : '2px',
                  overflowX: isMobile ? 'auto' : 'visible',
                  scrollbarWidth: isMobile ? 'none' : undefined,
                  WebkitOverflowScrolling: 'touch',
                  '&::-webkit-scrollbar': {
                    display: isMobile ? 'none' : undefined,
                  },
                }}
              >
                {toolbarButtons}

                {isChat && !isMobile && (
                  <Box
                    sx={{
                      alignItems: 'center',
                      borderLeft: '1px solid',
                      borderColor: theme.palette.divider,
                      cursor: 'pointer',
                      display: 'flex',
                      marginLeft: '8px',
                      paddingLeft: '8px',
                    }}
                    onClick={() => {
                      setIsDisabledEditorEnter(!isDisabledEditorEnter);
                    }}
                  >
                    <Checkbox
                      edge="start"
                      tabIndex={-1}
                      disableRipple
                      checked={isDisabledEditorEnter}
                      size="small"
                      sx={{
                        '&.Mui-checked': {
                          color: theme.palette.text.secondary,
                        },
                        '& .MuiSvgIcon-root': {
                          color: theme.palette.text.secondary,
                        },
                      }}
                    />
                    <Typography
                      sx={{
                        fontSize: '13px',
                        color: theme.palette.text.secondary,
                      }}
                    >
                      {t('core:action.disable_enter', {
                        postProcess: 'capitalizeFirstChar',
                      })}
                    </Typography>
                  </Box>
                )}

                {!isChat && (
                  <>
                    <IconButton
                      size="small"
                      onClick={triggerImageUpload}
                      sx={{
                        color: theme.palette.text.secondary,
                        padding: '4px',
                        '&:hover': {
                          backgroundColor: theme.palette.action.hover,
                          color: theme.palette.text.primary,
                        },
                      }}
                    >
                      <ImageIcon sx={{ fontSize: '20px' }} />
                    </IconButton>

                    <input
                      type="file"
                      ref={fileInputRef}
                      style={{ display: 'none' }}
                      onChange={(event) => {
                        const files = Array.from(event.target.files || []);
                        if (
                          isChat &&
                          files.length > 0 &&
                          typeof insertFiles === 'function'
                        ) {
                          void insertFiles(files);
                          if (fileInputRef.current) {
                            fileInputRef.current.value = '';
                          }
                          return;
                        }
                        handleImageUpload(files[0]);
                      }}
                      accept="image/*"
                    />
                  </>
                )}
              </Box>
            )}
      </Box>
    );

    if (toolbarInTopBar) {
      if (portalHost) {
        return createPortal(toolbarShell, portalHost);
      }
      return null;
    }

    return toolbarShell;
  }
);

const extensions = [
  TextStyle,
  Color.configure({ types: [TextStyle.name, ListItem.name] }),
  StarterKit.configure({
    bulletList: {
      keepMarks: true,
      keepAttributes: false,
    },
    orderedList: {
      keepMarks: true,
      keepAttributes: false,
    },
  }),
  Placeholder.configure({
    placeholder: i18n.t('core:action.start_typing', {
      postProcess: 'capitalizeFirstChar',
    }),
  }),
  ImageResize,
];

const content = ``;

// Shared across editor instances so remounting the composer mid-keystroke
// cannot let a second Enter through the send debounce.
let lastEnterSendAt = 0;

const COMPACT_ACTION_GAP = 4;
const COMPACT_BUTTON_SIZE = COMPOSER_CORNER_BUTTON_PX;
// Width the text loses to chrome in each stage, mirroring chat.css: the editor
// padding and ProseMirror's own on both sides, plus the paragraph indent that
// clears the buttons (composerCornerLayout.ts derives all of it from the button
// sizes). Underestimating these would let the text wrap inside a stage sized
// for fewer lines, which now clips rather than just looking cramped.
const INLINE_TEXT_GUTTERS = COMPOSER_INLINE_TEXT_GUTTERS;
const SQUEEZED_TEXT_GUTTERS = COMPOSER_SQUEEZED_TEXT_GUTTERS;
// A group's right edge needs one more slot while there is a message: on one
// line the expiry moves a slot inwards to make room for the discard button,
// and once the message wraps the expiry keeps the slot over send and the X
// waits one column in instead, mirroring Aa. The right indent grows by this
// much in the inline and squeezed stages (chat.css, "Discard").
const DISPLACED_EXPIRY_GUTTER = COMPOSER_DISPLACED_GUTTER;

/** Whether the discard button and the expiry both need the right edge, as
 *  chat.css sees it. Direct messages have no expiry, so their text keeps its
 *  width. */
export const composerExpiryDisplaced = (root: ParentNode): boolean =>
  Boolean(
    root.querySelector('.compact-composer-expiry') &&
    root.querySelector('.compact-composer-discard:not([data-idle])')
  );
// Canvas metrics and the real line breaker disagree by a hair, so shave the
// available width: erring towards one line too many only costs a little space,
// erring the other way hides text.
const MEASURE_SAFETY_PX = 8;
// The corner composer's stage-3 cap; chat.css reads the same value.
const COMPACT_EDITOR_MAX_HEIGHT = COMPOSER_STAGE_THREE_MAX_PX;
const COMPACT_MEASURE_FALLBACK_FONT_SIZE = '17px';
const SQUEEZE_AT_LINES = 2;
const STACK_AT_LINES = 3;
// Shortest each stage can be, the same --composer-stage-N-floor values chat.css
// reads: one row of controls, two stacked, three stacked.
const COMPOSER_STAGE_ORDER = ['inline', 'squeezed', 'stacked'] as const;
const COMPOSER_STAGE_MIN_HEIGHT = COMPOSER_STAGE_FLOOR;
// Share of the visible viewport the typing area may claim. Landscape, folded
// phones and small screens with the keyboard up leave so little height that a
// three-row composer would be most of the conversation, so those stay on a
// shorter stage and scroll instead.
const COMPOSER_MAX_VIEWPORT_SHARE = 0.45;
// COMPOSER_FOUR_SLOT_PX (composerCornerLayout.ts) is the height stage 3 needs
// for four buttons down the right edge (expand, expiry, discard, send),
// mirrored by the composer-rail container query in chat.css.
// Canvas metrics decide the stage; the browser decides the wrapping. Where the
// two disagree — a font that fell back, a mention chip wider than its text —
// the stage would clip, so the rendered height is checked once the move has
// settled and the stage bumped up if the text did not fit after all.
const COMPOSER_FIT_CHECK_MS = 260;
// Well under a line of text, well over the rounding a fractional device pixel
// ratio leaves behind: only a genuinely hidden line should move the stage.
const COMPOSER_FIT_SLACK_PX = 12;

// Long enough for --composer-chrome-duration (180ms) to have finished, so the
// caret is read against the height the box ended on rather than a frame of the
// animation.
const COMPOSER_CHROME_SETTLE_MS = 220;
// Breathing room kept under (or over) the caret so the line it sits on is not
// flush against the edge of the box.
const CARET_MARGIN_PX = 6;

type ComposerChromeKind = (typeof COMPOSER_STAGE_ORDER)[number];

/** Height the composer has to work in, keyboard and all. */
const composerViewportHeight = () =>
  window.visualViewport?.height || window.innerHeight || 0;

/** Never squeeze the typing area below roughly one line plus its padding. */
const COMPOSER_MIN_SPACE_PX = 40;
// Rounding, borders and the gap under the typing box. Small enough not to cost
// a line, big enough that the box never lands a pixel past its container.
const COMPOSER_SPACE_SLACK_PX = 6;

/**
 * Room the typing box is allowed to take. The composer bar has a height budget
 * (its max-height) that everything inside shares: attachment chips, the reply
 * strip, the formatting tray, then the text. Measuring what is left of that
 * budget — rather than what the bar happens to be tall right now, which is the
 * text's own height — is what keeps a bar full of chips and toolbars from
 * cutting the typing area down to a sliver.
 */
const measureComposerSpace = (root: HTMLElement, box: HTMLElement): number => {
  let budget: HTMLElement | null = null;
  let cap = 0;
  for (let node = root.parentElement; node; node = node.parentElement) {
    const value = parseFloat(getComputedStyle(node).maxHeight);
    if (Number.isFinite(value)) {
      budget = node;
      cap = value;
      break;
    }
  }
  // Nothing caps the composer here (desktop): it grows with its text as always.
  if (!budget) return Number.POSITIVE_INFINITY;
  const style = getComputedStyle(budget);
  const edges = {
    bottom:
      (parseFloat(style.paddingBottom) || 0) +
      (parseFloat(style.borderBottomWidth) || 0),
    top:
      (parseFloat(style.paddingTop) || 0) +
      (parseFloat(style.borderTopWidth) || 0),
  };
  const inner =
    style.boxSizing === 'border-box' ? cap - edges.top - edges.bottom : cap;
  // Everything laid out above the typing box inside that budget, whatever it
  // is nested in; the box's own height is not part of the distance.
  const above =
    box.getBoundingClientRect().top -
    (budget.getBoundingClientRect().top + edges.top);
  // Direct messages keep their attachment chip below the composer rather than
  // above it, so what follows wants its share too.
  let below = 0;
  for (let node: HTMLElement | null = root; node && node !== budget; ) {
    for (
      let sibling = node.nextElementSibling;
      sibling;
      sibling = sibling.nextElementSibling
    ) {
      const position = getComputedStyle(sibling).position;
      if (position === 'absolute' || position === 'fixed') continue;
      below += sibling.getBoundingClientRect().height;
    }
    node = node.parentElement;
  }
  return inner - above - below - COMPOSER_SPACE_SLACK_PX;
};

/** Tallest stage that fits both the viewport share and the room left in the bar. */
const composerStageCeiling = (
  spacePx = Number.POSITIVE_INFINITY
): ComposerChromeKind => {
  const budget = Math.min(
    composerViewportHeight() * COMPOSER_MAX_VIEWPORT_SHARE,
    spacePx
  );
  if (budget >= COMPOSER_STAGE_MIN_HEIGHT.stacked) return 'stacked';
  if (budget >= COMPOSER_STAGE_MIN_HEIGHT.squeezed) return 'squeezed';
  return 'inline';
};

/**
 * Whether stage 3 is capped under the height of four buttons. It stops growing
 * at the smallest of its own cap (COMPOSER_STAGE_THREE_MAX_PX), 45vh (the
 * layout viewport, as chat.css reads it) and the room left in the bar. In a
 * group, the expand button waits for a fourth slot on the right edge; a box
 * that can never get that tall could be scrolling a message it cannot show
 * whole, so it keeps expand instead.
 */
export const composerStageThreeIsShort = (
  spacePx: number,
  layoutViewportHeight: number
): boolean =>
  Math.min(
    COMPACT_EDITOR_MAX_HEIGHT,
    layoutViewportHeight * COMPOSER_MAX_VIEWPORT_SHARE,
    Number.isFinite(spacePx)
      ? Math.max(COMPOSER_MIN_SPACE_PX, Math.round(spacePx))
      : Number.POSITIVE_INFINITY
  ) < COMPOSER_FOUR_SLOT_PX;

const composerStageIndex = (kind: ComposerChromeKind) =>
  COMPOSER_STAGE_ORDER.indexOf(kind);

const clampComposerStage = (
  kind: ComposerChromeKind,
  floor: ComposerChromeKind,
  ceiling: ComposerChromeKind
): ComposerChromeKind => {
  const index = Math.min(
    Math.max(composerStageIndex(kind), composerStageIndex(floor)),
    composerStageIndex(ceiling)
  );
  return COMPOSER_STAGE_ORDER[index];
};
const COMPOSER_BLOCK_TYPES = new Set([
  'blockquote',
  'bulletList',
  'codeBlock',
  'heading',
  'horizontalRule',
  'image',
  'orderedList',
  'table',
]);

let composerMeasureCtx: CanvasRenderingContext2D | null = null;
const getComposerMeasureCtx = () => {
  if (!composerMeasureCtx) {
    composerMeasureCtx = document.createElement('canvas').getContext('2d');
  }
  return composerMeasureCtx;
};

const countParagraphWraps = (
  ctx: CanvasRenderingContext2D,
  paragraph: string,
  widthPx: number,
  stopAfter = Infinity
) => {
  if (!paragraph) return 1;
  const words = paragraph.split(/(\s+)/);
  let lines = 1;
  let used = 0;
  const fits = (text: string) => ctx.measureText(text).width <= widthPx;
  const takeFittingPrefix = (text: string) => {
    if (fits(text)) return text.length;
    let lo = 1;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(text.slice(0, mid))) lo = mid;
      else hi = mid - 1;
    }
    return Math.max(1, lo);
  };
  for (const word of words) {
    if (!word || lines >= stopAfter) continue;
    const wordWidth = ctx.measureText(word).width;
    if (wordWidth <= widthPx) {
      if (used > 0 && used + wordWidth > widthPx) {
        lines += 1;
        used = wordWidth;
      } else {
        used += wordWidth;
      }
      continue;
    }
    if (used > 0) {
      lines += 1;
      used = 0;
      if (lines >= stopAfter) return lines;
    }
    let rest = word;
    while (rest && !fits(rest)) {
      rest = rest.slice(takeFittingPrefix(rest));
      if (rest) {
        lines += 1;
        if (lines >= stopAfter) return lines;
      }
    }
    used = rest ? ctx.measureText(rest).width : 0;
  }
  return lines;
};

/** Wrapped lines the document needs at `widthPx`, counted no further than
 *  `stopAfter`. A block node (list, quote, code…) reports the cap outright:
 *  none of them belong in a one-line row. */
const composerLineCount = (
  editor: Editor,
  ctx: CanvasRenderingContext2D,
  widthPx: number,
  stopAfter: number
): number => {
  let lines = 0;
  let done = false;
  editor.state.doc.forEach((node) => {
    if (done) return;
    if (COMPOSER_BLOCK_TYPES.has(node.type.name)) {
      lines = stopAfter;
      done = true;
      return;
    }
    const text = node.textBetween(0, node.content.size, '\n', '\n');
    for (const paragraph of text.split('\n')) {
      lines += countParagraphWraps(ctx, paragraph, widthPx, stopAfter - lines);
      if (lines >= stopAfter) {
        lines = stopAfter;
        done = true;
        return;
      }
    }
  });
  return lines;
};

const composerEditorChromeKind = (
  editor: Editor | null | undefined,
  font: string,
  inlineWidthPx: number,
  squeezedWidthPx: number
): ComposerChromeKind => {
  const ctx = getComposerMeasureCtx();
  if (!editor?.state?.doc || !ctx) return 'inline';
  if (inlineWidthPx <= 0 || squeezedWidthPx <= 0) return 'inline';
  ctx.font = font;
  // Pick the smallest stage that can hold the text *at its own width*. Each
  // stage hands the text more room than the last, so asking whether the next
  // stage up would need another line is the wrong question: the answer is
  // about a width the text is not being laid out at, and the composer can
  // settle on a stage the text then overflows. Asking whether a stage still
  // fits what it is showing has one stable answer and cannot clip.
  if (
    composerLineCount(editor, ctx, inlineWidthPx, SQUEEZE_AT_LINES) <
    SQUEEZE_AT_LINES
  ) {
    return 'inline';
  }
  if (
    composerLineCount(editor, ctx, squeezedWidthPx, STACK_AT_LINES) <
    STACK_AT_LINES
  ) {
    return 'squeezed';
  }
  return 'stacked';
};

type TiptapProps = {
  setEditorRef: (editorInstance: Editor | null) => void;
  onEnter: () => void | Promise<void>;
  onKeyDown?: (event: KeyboardEvent, editor: Editor) => boolean | void;
  onContentUpdate?: (editor: Editor) => void;
  disableEnter?: boolean;
  readOnly?: boolean;
  isChat?: boolean;
  /** Use chat-style composer (single bar, minimal border) without chat-only behavior (e.g. announcements keep image) */
  composerStyle?: boolean;
  maxHeightOffset?: number;
  overrideMobile?: boolean;
  customEditorHeight?: number | null;
  setIsFocusedParent?: React.Dispatch<React.SetStateAction<boolean>>;
  isFocusedParent?: boolean;
  isReply?: boolean;
  /** Composer lives inside a modal, so it must not take over the app top bar.
   *  In the phone corner layout it also keeps the popover emoji picker and
   *  has no full-screen mode: the emoji panel and the full-screen composer's
   *  attachment slot belong to the app shell and the chat under the modal. */
  inOverlay?: boolean;
  membersWithNames?: unknown[];
  mentionSuggestions?: MentionSuggestionItem[];
  enableMentions?: boolean;
  insertImage?: (image: any) => void;
  insertGif?: (gif: LibraryGif) => void;
  mobileTopBarActions?: ReactNode;
  insertFiles?: (files: File[]) => void | Promise<void>;
  compactChat?: boolean;
  compactEditorMaxHeight?: number;
  /** Right-hand cluster: expiry, discard, then send. All three are positioned
   *  by the rail CSS off `compact-composer-expiry` /
   *  `compact-composer-discard` / `compact-composer-send`, so a consumer only
   *  has to render them in that order and tag them (expiry is optional). */
  compactActions?:
    | ReactNode
    | ((state: {
        stacked: boolean;
        squeezed: boolean;
        showExpiry: boolean;
      }) => ReactNode);
  placeholder?: string;
  collapseFormattingTraySignal?: number;
};

export type MentionSuggestionItem = {
  id: string;
  label: string;
  section: 'people' | 'special' | 'channels';
  kind: 'person' | 'here' | 'everyone' | 'group' | 'channel';
  description: string;
  iconText?: string;
};

const renderMentionLabel = (node: { attrs: Record<string, unknown> }) => {
  return String(node.attrs.label ?? node.attrs.id ?? '').replace(/^@/, '');
};

const Tiptap = ({
  setEditorRef,
  onEnter,
  onKeyDown,
  onContentUpdate,
  disableEnter = false,
  readOnly = false,
  isChat = false,
  composerStyle = false,
  maxHeightOffset,
  setIsFocusedParent,
  isFocusedParent,
  overrideMobile,
  customEditorHeight,
  isReply = false,
  inOverlay = false,
  membersWithNames = [],
  mentionSuggestions,
  enableMentions,
  insertImage,
  insertGif,
  mobileTopBarActions,
  insertFiles,
  compactChat = false,
  compactEditorMaxHeight,
  compactActions,
  placeholder,
  collapseFormattingTraySignal,
}: TiptapProps) => {
  const theme = useTheme();
  const { t } = useTranslation(['core', 'group']);
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  // Pictures from the Android clipboard and keyboards (nativeClipboardImage).
  const [composerRoot, setComposerRoot] = useState<HTMLDivElement | null>(null);
  const [composerFocused, setComposerFocused] = useState(false);
  const insertFilesRef = useRef(insertFiles);
  insertFilesRef.current = insertFiles;
  const takesPastedImages =
    isChat &&
    !readOnly &&
    typeof insertFiles === 'function' &&
    hasNativeClipboardImages();
  // Every pasted or keyboard-inserted file is cleaned of tracing data first
  // (cleanPastedImage.ts); a picture that can't be cleaned is not used.
  const insertPastedFiles = useCallback(
    async (
      files: File[],
      deliver?: (files: File[]) => void,
      route = 'paste'
    ) => {
      const cleaned = await cleanPastedFiles(files);
      if (cleaned.length < files.length) {
        noteClipboardIssue(
          `paste refused (${route}): ${describeLastCleanFailure()}`
        );
        executeEvent('openGlobalSnackBar', {
          message: t('group:chat_group.paste_image_unsafe', {
            postProcess: 'capitalizeFirstChar',
          }),
          type: 'error',
        });
      }
      if (cleaned.length === 0) return;
      if (deliver) deliver(cleaned);
      else void insertFilesRef.current?.(cleaned);
    },
    [t]
  );
  const insertPastedImage = useCallback(
    (file: File) => {
      void insertPastedFiles([file], undefined, 'keyboard or chip');
    },
    [insertPastedFiles]
  );
  useEffect(() => {
    if (!takesPastedImages || !composerFocused) return;
    return claimKeyboardImageTarget(insertPastedImage);
  }, [composerFocused, insertPastedImage, takesPastedImages]);
  const setMobileComposeActive = useSetAtom(mobileChatComposeActiveAtom);
  const emojiPanelOpen = useAtomValue(mobileEmojiPanelOpenAtom);
  const setEmojiPanelOpen = useSetAtom(mobileEmojiPanelOpenAtom);
  const setFullscreenComposerActive = useSetAtom(
    mobileFullscreenComposerActiveAtom
  );
  const compactFileInputRef = useRef<HTMLInputElement | null>(null);
  const attachResumeTypingRef = useRef(false);
  const [showFormattingTray, setShowFormattingTray] = useState(false);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [formattingTrayHost, setFormattingTrayHost] =
    useState<HTMLDivElement | null>(null);
  const editorRef = useRef(null);
  const compactRowRef = useRef<HTMLDivElement | null>(null);
  const composerRootRef = useRef<HTMLDivElement | null>(null);
  const composerEditorRef = useRef<HTMLDivElement | null>(null);
  const chromeKindRef = useRef<ComposerChromeKind>('inline');
  const stackFrameRef = useRef(0);
  const composerFitTimerRef = useRef(0);
  const caretTimerRef = useRef(0);
  // Stage the rendered text turned out to need, and the document size it
  // needed it at. Anything that long stays on it instead of being predicted
  // back down to a stage that clips it once a frame later.
  const composerFitFloorRef = useRef<{
    kind: ComposerChromeKind;
    docSize: number;
  } | null>(null);
  const composerRowWidthRef = useRef(0);

  const applyComposerChrome = useCallback(
    (root: HTMLElement, kind: ComposerChromeKind) => {
      chromeKindRef.current = kind;
      root.toggleAttribute('data-composer-stacked', kind === 'stacked');
      root.toggleAttribute('data-composer-squeezed', kind === 'squeezed');
      compactRowRef.current?.toggleAttribute(
        'data-composer-stacked',
        kind === 'stacked'
      );
      compactRowRef.current?.toggleAttribute(
        'data-composer-squeezed',
        kind === 'squeezed'
      );
    },
    []
  );
  // The chat composers hand their send cluster over, and so does the thread
  // composer on phones; desktop threads and announcements keep their own
  // bordered field and trailing buttons.
  const hasCornerActions = compactChat && Boolean(compactActions);

  // Android dismisses the soft keyboard the moment focus leaves the editor, so
  // the composer's own controls must never take it.
  const preventFocusSteal = useCallback(
    (event: { preventDefault: () => void }) => {
      event.preventDefault();
    },
    []
  );

  /**
   * The file picker is a separate activity: it takes the keyboard with it and
   * hands focus back to nothing in particular. Someone who was mid-sentence
   * when they attached something should not have to tap the composer again to
   * carry on, so the caret goes back — retried, because the activity is still
   * coming back when the file arrives and an early focus is dropped.
   */
  const resumeTypingAfterPicker = useCallback(() => {
    restoreComposerTyping(editorRef.current as Editor | null, { force: true });
    // The activity is still coming back when the file arrives, so the early
    // asks can be dropped; one more once it has settled.
    window.setTimeout(
      () =>
        restoreComposerTyping(editorRef.current as Editor | null, {
          force: true,
        }),
      700
    );
  }, []);

  useEffect(() => {
    if (collapseFormattingTraySignal === undefined) return;
    setShowFormattingTray(false);
    setComposerExpanded(false);
    if (composerRootRef.current) {
      applyComposerChrome(composerRootRef.current, 'inline');
    } else {
      chromeKindRef.current = 'inline';
    }
  }, [applyComposerChrome, collapseFormattingTraySignal]);

  /**
   * Keep the line being typed inside the visible part of the typing box.
   *
   * The editor scrolls the caret into view as the text is edited, but the box
   * around it also changes height on its own: a stage moves, the keyboard comes
   * up, an attachment chip takes a row. None of that is an edit, so nothing
   * scrolls, and on a capped box the line under the caret can end up below the
   * fold with no sign of where it went.
   */
  const keepCaretVisible = useCallback(() => {
    const editor = editorRef.current as Editor | null;
    const box = composerEditorRef.current;
    if (!editor || editor.isDestroyed || !editor.isFocused || !box) return;
    if (box.scrollHeight - box.clientHeight <= 1) return;
    let caret: { bottom: number; top: number };
    try {
      caret = editor.view.coordsAtPos(editor.state.selection.head);
    } catch {
      // Selection outlives the DOM it pointed at for a tick after a re-render.
      return;
    }
    const view = box.getBoundingClientRect();
    if (caret.bottom > view.bottom - CARET_MARGIN_PX) {
      box.scrollTop += caret.bottom - view.bottom + CARET_MARGIN_PX;
    } else if (caret.top < view.top + CARET_MARGIN_PX) {
      box.scrollTop -= view.top + CARET_MARGIN_PX - caret.top;
    }
  }, []);

  /** Now, and again once the stage has finished animating into place. */
  const scheduleCaretCheck = useCallback(() => {
    keepCaretVisible();
    window.clearTimeout(caretTimerRef.current);
    caretTimerRef.current = window.setTimeout(
      keepCaretVisible,
      COMPOSER_CHROME_SETTLE_MS
    );
  }, [keepCaretVisible]);

  // Canvas metrics are a prediction; this is the correction. Once a stage has
  // finished moving, whatever the browser actually laid out either fits the
  // stage or it does not, and a stage the text overflows is one that hides it.
  const runComposerFitCheck = useCallback(
    function fitCheck() {
      composerFitTimerRef.current = 0;
      if (
        !hasCornerActions ||
        readOnly ||
        composerExpanded ||
        document.hidden
      ) {
        return;
      }
      const editor = editorRef.current as Editor | null;
      const root = composerRootRef.current;
      const box = composerEditorRef.current;
      if (!editor?.state?.doc || !root || !box) return;
      const kind = chromeKindRef.current;
      const ceiling = composerStageCeiling(measureComposerSpace(root, box));
      // The tallest stage on this viewport is allowed to scroll: there is
      // nowhere left to grow into.
      if (composerStageIndex(kind) >= composerStageIndex(ceiling)) return;
      if (box.scrollHeight - box.clientHeight <= COMPOSER_FIT_SLACK_PX) return;
      const next = COMPOSER_STAGE_ORDER[composerStageIndex(kind) + 1];
      composerFitFloorRef.current = {
        docSize: editor.state.doc.content.size,
        kind: next,
      };
      applyComposerChrome(root, next);
      scheduleCaretCheck();
      composerFitTimerRef.current = window.setTimeout(
        fitCheck,
        COMPOSER_FIT_CHECK_MS
      );
    },
    [
      applyComposerChrome,
      composerExpanded,
      hasCornerActions,
      readOnly,
      scheduleCaretCheck,
    ]
  );

  // 1 line: + 😊 Aa in a row, expiry beside send. 2 lines: + stacks over the
  // smiley with Aa centred beside them, expiry over send. 3+ lines: both rails
  // run single-file down the edges. The editor box keeps its side padding;
  // only the inner paragraph indent changes.
  const measureSideChrome = useCallback(() => {
    if (!hasCornerActions || readOnly || composerExpanded || document.hidden) {
      return;
    }
    const editor = editorRef.current as Editor | null;
    const row = compactRowRef.current;
    const root = composerRootRef.current;
    const box = composerEditorRef.current;
    if (!editor?.state?.doc || !row || !root || !box) return;
    const rowWidth = row.clientWidth;
    // Nothing to measure against while the composer is off-screen or still
    // being laid out; keeping the stage it has beats guessing a wrong one.
    if (rowWidth <= 0) return;
    if (rowWidth !== composerRowWidthRef.current) {
      // A fold, a rotation or a resized window rewraps everything, so what the
      // text did or did not fit into at the old width says nothing now.
      composerRowWidthRef.current = rowWidth;
      composerFitFloorRef.current = null;
    }
    // The accessibility text scales change the composer font, so read the size
    // the stylesheet settled on rather than assuming the default.
    const fontSize =
      getComputedStyle(root).getPropertyValue('--composer-font-size').trim() ||
      COMPACT_MEASURE_FALLBACK_FONT_SIZE;
    // A very narrow screen can leave less room than the chrome wants; measure
    // against a sliver rather than a negative width, which would read as "one
    // line" and clip everything the user typed.
    const displaced = composerExpiryDisplaced(root);
    const predicted = composerEditorChromeKind(
      editor,
      `400 ${fontSize} Inter, system-ui, sans-serif`,
      Math.max(
        32,
        rowWidth -
          INLINE_TEXT_GUTTERS -
          (displaced ? DISPLACED_EXPIRY_GUTTER.inline : 0) -
          MEASURE_SAFETY_PX
      ),
      Math.max(
        32,
        rowWidth -
          SQUEEZED_TEXT_GUTTERS -
          (displaced ? DISPLACED_EXPIRY_GUTTER.squeezed : 0) -
          MEASURE_SAFETY_PX
      )
    );
    // Attachments and the formatting tray share the bar with the typing area;
    // hand the stage — and the stylesheet — the height they left behind.
    const space = measureComposerSpace(root, box);
    if (Number.isFinite(space)) {
      root.style.setProperty(
        '--composer-space',
        `${Math.max(COMPOSER_MIN_SPACE_PX, Math.round(space))}px`
      );
    } else {
      root.style.removeProperty('--composer-space');
    }
    const floor = composerFitFloorRef.current;
    const ceiling = composerStageCeiling(space);
    const kind = clampComposerStage(
      predicted,
      floor && editor.state.doc.content.size >= floor.docSize
        ? floor.kind
        : 'inline',
      ceiling
    );
    if (kind !== chromeKindRef.current) applyComposerChrome(root, kind);
    // A bar that cannot reach its tallest stage cannot show the whole message
    // either, and full screen is the way out of it — so the expand button has
    // to be reachable from the stage it is stuck on, not only from stage 3.
    // Both flags only place the expand button, which an overlay has none of.
    root.toggleAttribute(
      'data-composer-capped',
      !inOverlay && ceiling !== 'stacked'
    );
    // Where stage 3 can never fit four buttons down the right edge, a group
    // keeps its expand button and the discard button waits one column in.
    root.toggleAttribute(
      'data-composer-short',
      !inOverlay && composerStageThreeIsShort(space, window.innerHeight)
    );
    // The box just changed height under the caret, whether the stage moved or
    // only the room around it did.
    scheduleCaretCheck();
    // Verify the choice once the move has settled, whether or not it changed:
    // the text can outgrow a stage it already sits in.
    window.clearTimeout(composerFitTimerRef.current);
    composerFitTimerRef.current = window.setTimeout(
      runComposerFitCheck,
      COMPOSER_FIT_CHECK_MS
    );
  }, [
    applyComposerChrome,
    composerExpanded,
    hasCornerActions,
    inOverlay,
    readOnly,
    runComposerFitCheck,
    scheduleCaretCheck,
  ]);

  useLayoutEffect(() => {
    const root = composerRootRef.current;
    if (!root) return;
    const kind = composerExpanded ? 'inline' : chromeKindRef.current;
    root.toggleAttribute('data-composer-stacked', kind === 'stacked');
    root.toggleAttribute('data-composer-squeezed', kind === 'squeezed');
    compactRowRef.current?.toggleAttribute(
      'data-composer-stacked',
      kind === 'stacked'
    );
    compactRowRef.current?.toggleAttribute(
      'data-composer-squeezed',
      kind === 'squeezed'
    );
  });

  const scheduleSideChromeMeasure = useCallback(() => {
    if (!hasCornerActions || composerExpanded || document.hidden) return;
    if (stackFrameRef.current) return;
    stackFrameRef.current = window.requestAnimationFrame(() => {
      stackFrameRef.current = 0;
      measureSideChrome();
    });
  }, [composerExpanded, hasCornerActions, measureSideChrome]);

  useEffect(() => {
    return () => {
      if (stackFrameRef.current) {
        window.cancelAnimationFrame(stackFrameRef.current);
        stackFrameRef.current = 0;
      }
      window.clearTimeout(composerFitTimerRef.current);
      composerFitTimerRef.current = 0;
      window.clearTimeout(caretTimerRef.current);
      caretTimerRef.current = 0;
    };
  }, []);

  // The stage now fixes the height of the typing area, so anything that
  // rewraps the text without an edit — rotating, unfolding, the soft keyboard
  // resizing the viewport, returning to a backgrounded tab — has to re-measure
  // or the text would sit scrolled inside a box sized for the wrong line count
  // (and, on a viewport that just got shorter, in a box too tall for it).
  useEffect(() => {
    if (!hasCornerActions) return undefined;
    const remeasure = () => scheduleSideChromeMeasure();
    const viewport = window.visualViewport;
    window.addEventListener('resize', remeasure);
    window.addEventListener('orientationchange', remeasure);
    document.addEventListener('visibilitychange', remeasure);
    viewport?.addEventListener('resize', remeasure);
    return () => {
      window.removeEventListener('resize', remeasure);
      window.removeEventListener('orientationchange', remeasure);
      document.removeEventListener('visibilitychange', remeasure);
      viewport?.removeEventListener('resize', remeasure);
    };
  }, [hasCornerActions, scheduleSideChromeMeasure]);

  // Leaving the full-screen composer hands the text back to a bar that has not
  // measured it: whatever was typed up there decides the stage down here.
  useEffect(() => {
    if (composerExpanded) return;
    scheduleSideChromeMeasure();
  }, [composerExpanded, scheduleSideChromeMeasure]);

  // Attachment chips and the formatting tray are laid out above the typing box
  // and neither is the editor's to watch. Any render can have added or removed
  // one, so the room they left over is re-read after each — the measure itself
  // is a coalesced frame and touches no state, so this cannot spiral.
  useEffect(() => {
    scheduleSideChromeMeasure();
  });

  const [isDisabledEditorEnter, setIsDisabledEditorEnter] = useAtom(
    isDisabledEditorEnterAtom
  );

  // GO: a short window, which the keyboard cannot fake (it shrinks the
  // WebView) and a tablet in landscape is not. The Hub: the orientation query.
  const isLandscape = useShortLandscape();
  const keyboardOpen = useSoftKeyboardOpen();
  const keyboardInset = useSoftKeyboardInset();
  // Whether the *expanded* mobile compose layout should be shown: the formatting
  // toolbar moves into the top bar and the app's top/bottom panels hide. In
  // portrait this tracks the soft keyboard, so dismissing the keyboard drops
  // back to a compact composer (the text and the send/close/share buttons stay)
  // and restores the normal panels — without clearing focus or the draft.
  const [keyboardActive, setKeyboardActive] = useState(false);
  const keyboardWasOpenRef = useRef(false);

  // GO: when the window last changed shape, so the keyboard effect below can
  // tell a re-baselining keyboard store from the user closing the keyboard.
  const layoutEpoch = useGoLayout(selectLayoutEpoch);
  const layoutEpochSeenRef = useRef<number | null>(null);
  const layoutChangedAtRef = useRef(0);
  const [layoutSettleCheck, setLayoutSettleCheck] = useState(0);
  useLayoutEffect(() => {
    const seen = layoutEpochSeenRef.current;
    if (seen !== null && seen !== layoutEpoch) {
      layoutChangedAtRef.current = Date.now();
    }
    layoutEpochSeenRef.current = layoutEpoch;
  }, [layoutEpoch]);

  // The expanded layout takes over the app's top bar, which only makes sense
  // for the main chat composer. Inside a modal the bar is covered by the
  // dialog, so it would just leave an empty strip peeking out above it.
  // Reticulum compactChat uses the Aa formatting tray instead of portaling
  // controls into the top bar — claiming that slot would hide search and show
  // a blank grey strip while replying/typing.
  const mobileChatCompose =
    isMobile &&
    isChat &&
    !compactChat &&
    !inOverlay &&
    Boolean(isFocusedParent) &&
    (isLandscape || keyboardActive);

  // A focused composer in portrait with the keyboard dismissed: keep it visible
  // and compact (text + action buttons) rather than expanding to full compose.
  const mobileChatCompact =
    isMobile && isChat && Boolean(isFocusedParent) && !mobileChatCompose;

  useLayoutEffect(() => {
    if (!isMobile || !isChat) return;
    // The full-screen composer wants the app's top and bottom panels out of
    // the way just as much as the expanded legacy layout does.
    setMobileComposeActive(mobileChatCompose || composerExpanded);
    // …and the top bar has to leave entirely: it out-stacks the composer no
    // matter how high the overlay's z-index goes, because the chat sits in a
    // section layer that caps its descendants' stacking order.
    setFullscreenComposerActive(composerExpanded);
  }, [
    composerExpanded,
    mobileChatCompose,
    isMobile,
    isChat,
    setFullscreenComposerActive,
    setMobileComposeActive,
  ]);

  useEffect(() => {
    return () => {
      if (isMobile && isChat) {
        setMobileComposeActive(false);
        setFullscreenComposerActive(false);
      }
    };
  }, [isMobile, isChat, setFullscreenComposerActive, setMobileComposeActive]);

  // Once the composer is fully dismissed, drop the expanded keyboard layout too.
  useEffect(() => {
    if (!isFocusedParent) setKeyboardActive(false);
  }, [isFocusedParent]);

  useEffect(() => {
    if (!isMobile || !isChat) return;
    if (keyboardOpen) {
      keyboardWasOpenRef.current = true;
      setKeyboardActive(true);
      return;
    }
    if (!keyboardWasOpenRef.current) return;
    // GO: right after a rotation, fold or split resize the keyboard store
    // reports a keyboard that is still up as closed until it re-baselines.
    // Wait that out (keeping the layout) instead of blurring the composer,
    // which would take the keyboard away for good; an epoch not rendered yet
    // means the change has only just happened.
    if (isGoLayout() && !emojiPanelOpen) {
      const wait =
        getGoLayout().epoch !== layoutEpochSeenRef.current
          ? LAYOUT_SETTLE_MS
          : layoutSettleWaitMs(Date.now(), layoutChangedAtRef.current);
      if (wait > 0) {
        const timer = window.setTimeout(
          () => setLayoutSettleCheck((n) => n + 1),
          wait
        );
        return () => window.clearTimeout(timer);
      }
    }
    keyboardWasOpenRef.current = false;
    if (emojiPanelOpen) return;
    if (isLandscape) {
      setKeyboardActive(false);
      return;
    }

    // Portrait keyboard dismissed: blur FIRST so ProseMirror is no longer
    // focused, then collapse the expanded layout on the next tick. Changing the
    // toolbar/editor DOM while the editor still holds a (possibly stale)
    // selection can make ProseMirror throw while syncing the DOM selection
    // ("Failed to execute 'collapse' on 'Selection'"). The composer itself
    // stays open (isFocusedParent is untouched) so the typed text and the
    // send/close/share buttons remain visible.
    try {
      editorRef.current?.commands?.blur?.();
    } catch {
      /* ignore */
    }
    try {
      const active = document.activeElement as HTMLElement | null;
      active?.blur?.();
    } catch {
      /* ignore */
    }
    const timer = window.setTimeout(() => {
      setKeyboardActive(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    emojiPanelOpen,
    keyboardOpen,
    isLandscape,
    isMobile,
    isChat,
    layoutSettleCheck,
  ]);

  const handleImageUpload = useCallback(
    async (file) => {
      try {
        if (!file?.type?.includes('image')) return;
        if (typeof insertImage !== 'function') return;
        let compressedFile = file;
        if (file.type !== 'image/gif') {
          await new Promise<void>((resolve) => {
            new Compressor(file, {
              quality: 0.6,
              maxWidth: 1200,
              mimeType: 'image/webp',
              success(result) {
                compressedFile = result;
                resolve();
              },
              error(err) {
                console.error('Image compression error:', err);
                resolve();
              },
            });
          });
        }

        if (compressedFile) {
          // A failed compression leaves the original, and strict mode can
          // return the original WebP: neither may keep its GPS/camera data.
          const toBase64 = await fileToBase64(
            await stripImageFileMetadata(compressedFile)
          );
          insertImage?.(toBase64);
        }
      } catch (error) {
        console.error(error);
      }
    },
    [insertImage]
  );

  const extensionsFiltered = useMemo(
    () =>
      isChat
        ? extensions.filter(
            (item) => item?.name !== 'image' && item?.name !== 'placeholder'
          )
        : extensions.filter((item) => item?.name !== 'placeholder'),
    [isChat]
  );
  const placeholderExtension = useMemo(
    () =>
      Placeholder.configure({
        placeholder:
          placeholder ||
          i18n.t('core:action.start_typing', {
            postProcess: 'capitalizeFirstChar',
          }),
        showOnlyWhenEditable: false,
      }),
    [placeholder]
  );
  const setEditorRefFunc = useCallback(
    (editorInstance) => {
      editorRef.current = editorInstance;
      setEditorRef?.(editorInstance);
    },
    [setEditorRef]
  );

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(!readOnly);
    if (readOnly) {
      editor.commands.clearContent();
      editor.commands.blur();
    }
  }, [readOnly]);

  // Mobile chat swaps the popover picker for a panel that takes over the soft
  // keyboard's slot, so the composer never moves and one button toggles between
  // the two keyboards — the way Telegram does it.
  // The panel lives in the app shell, under any modal: a composer in a dialog
  // (a thread) keeps the popover picker, which opens above it.
  const useEmojiKeyboardPanel = hasCornerActions && isMobile && !inOverlay;

  const emojiPanelIntentRef = useRef<'emoji' | 'keyboard' | null>(null);

  const insertEmoji = useCallback((emoji: string) => {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) return;
    // Deliberately not focusing: that would summon the soft keyboard on top of
    // the panel the user is still picking from.
    editor.chain().insertContent(emoji).run();
  }, []);

  useEffect(() => {
    if (!useEmojiKeyboardPanel || !emojiPanelOpen) return;
    setEmojiPanelHandler(insertEmoji);
    setGifPanelHandler(
      insertGif
        ? (gif) => {
            insertGif(gif);
            setEmojiPanelOpen(false);
          }
        : null
    );
    return () => {
      setEmojiPanelHandler(null);
      setGifPanelHandler(null);
    };
  }, [
    insertEmoji,
    insertGif,
    setEmojiPanelOpen,
    useEmojiKeyboardPanel,
    emojiPanelOpen,
  ]);

  // Closing the chat must not strand the panel over the next screen.
  useEffect(() => {
    if (!useEmojiKeyboardPanel) return;
    return () => setEmojiPanelOpen(false);
  }, [useEmojiKeyboardPanel, setEmojiPanelOpen]);

  // Tapping the text area brings the real keyboard back; the panel hands the
  // slot over instead of stacking underneath it. The full-screen composer ends
  // above the slot rather than closing the panel, so the smiley swaps the two
  // keyboards there exactly as it does in the compact bar.
  useEffect(() => {
    if (!emojiPanelOpen) return;
    if (emojiPanelIntentRef.current === 'emoji') {
      // We opened the panel on purpose while the keyboard was still up; leave
      // it there until the keyboard has finished retracting.
      if (!keyboardOpen) emojiPanelIntentRef.current = null;
      return;
    }
    if (!keyboardOpen) return;
    if (isPanelKeyboardSuppressed()) return;
    const active = document.activeElement as HTMLElement | null;
    if (active?.closest('[data-emoji-panel]')) return;
    // Keep the panel mounted until the keyboard has covered most of the slot,
    // otherwise the composer drops into the gap and jumps back up.
    const covered = keyboardInset;
    const slot = getLastSoftKeyboardHeight();
    if (covered < Math.max(160, slot - 32)) return;
    emojiPanelIntentRef.current = null;
    setEmojiPanelOpen(false);
  }, [emojiPanelOpen, keyboardInset, keyboardOpen, setEmojiPanelOpen]);

  // Search-lifted: the keyboard is already up, so the effect above never sees
  // an open-transition. A tap on the composer must take the slot immediately.
  useEffect(() => {
    if (!useEmojiKeyboardPanel || !emojiPanelOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (keyboardInset <= 120 || isPanelKeyboardSuppressed()) return;
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-emoji-panel]')) return;
      if (target.closest('button')) return;
      if (
        !target.closest('.ProseMirror') &&
        !target.closest('.compact-composer-editor')
      ) {
        return;
      }
      emojiPanelIntentRef.current = 'keyboard';
      setEmojiPanelOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () =>
      document.removeEventListener('pointerdown', onPointerDown, true);
  }, [emojiPanelOpen, keyboardInset, setEmojiPanelOpen, useEmojiKeyboardPanel]);

  // The panel stands in for the keyboard, so a tap that would have closed the
  // keyboard closes it too, instead of it hanging on until the next send.
  useEffect(() => {
    if (!useEmojiKeyboardPanel || !emojiPanelOpen) return;
    return closePanelOnOutsideTap(
      (target) => Boolean(composerRootRef.current?.contains(target)),
      () => {
        emojiPanelIntentRef.current = null;
        setEmojiPanelOpen(false);
      }
    );
  }, [emojiPanelOpen, setEmojiPanelOpen, useEmojiKeyboardPanel]);

  useAndroidBack(
    () => {
      if (!emojiPanelOpen) return false;
      setEmojiPanelOpen(false);
      return true;
    },
    {
      enabled: useEmojiKeyboardPanel && emojiPanelOpen,
      priority: BACK_PRIORITY.overlay,
    }
  );

  const toggleEmojiPanel = useCallback(() => {
    if (emojiPanelOpen) {
      // Focus synchronously: Android only raises the keyboard while the tap
      // that asked for it is still being handled. The panel stays up until the
      // keyboard has covered its slot, so the composer does not drop.
      emojiPanelIntentRef.current = 'keyboard';
      try {
        editorRef.current?.commands?.focus?.();
      } catch {
        /* editor torn down */
      }
      // Search already has the keyboard up, so there is no open-transition
      // for the slot-handoff effect to watch — close now or the panel sits
      // behind the keyboard.
      if (keyboardInset > 120) setEmojiPanelOpen(false);
      return;
    }
    // Open the panel first, then dismiss the keyboard. The shell tracks the
    // retracting inset so the panel is revealed in the keyboard's place
    // instead of appearing after a gap.
    emojiPanelIntentRef.current = 'emoji';
    setEmojiPanelOpen(true);
    try {
      editorRef.current?.commands?.blur?.();
    } catch {
      /* editor torn down */
    }
    try {
      (document.activeElement as HTMLElement | null)?.blur?.();
    } catch {
      /* ignore */
    }
  }, [emojiPanelOpen, keyboardInset, setEmojiPanelOpen]);

  const users = useMemo(() => {
    if (mentionSuggestions) return mentionSuggestions;
    return (membersWithNames || [])
      ?.map((item) => {
        const label = String(item || '').trim();
        return {
          id: label,
          label,
          section: 'people' as const,
          kind: 'person' as const,
          description: 'Member',
        };
      })
      .filter((item) => item.label);
  }, [membersWithNames, mentionSuggestions]);

  const usersRef = useRef([]);
  useEffect(() => {
    usersRef.current = users; // Keep users up-to-date
  }, [users]);

  const handleFocus = useCallback(() => {
    if (isPanelKeyboardSuppressed()) {
      try {
        editorRef.current?.commands?.blur?.();
      } catch {
        /* ignore */
      }
      return;
    }
    if (emojiPanelOpen) {
      emojiPanelIntentRef.current = 'keyboard';
      if (keyboardInset > 120) setEmojiPanelOpen(false);
    }
    if (isMobile && setIsFocusedParent) {
      if (isChat) {
        setKeyboardActive(true);
      }
      setIsFocusedParent(true);
    }
  }, [
    emojiPanelOpen,
    isChat,
    isMobile,
    keyboardInset,
    setEmojiPanelOpen,
    setIsFocusedParent,
  ]);

  const additionalExtensions = useMemo(() => {
    if (!enableMentions) return [];
    return [
      Mention.configure({
        HTMLAttributes: {
          class: 'mention',
        },
        renderText: ({ node }) => renderMentionLabel(node),
        renderHTML: ({ options, node }) => [
          'span',
          options.HTMLAttributes,
          renderMentionLabel(node),
        ],
        suggestion: {
          items: ({ query }) => {
            const normalizedQuery = query.trim().toLowerCase();
            if (!normalizedQuery) return usersRef.current;
            const sectionOrder: Record<
              MentionSuggestionItem['section'],
              number
            > = {
              people: 0,
              special: 1,
              channels: 2,
            };
            const matchRank = (label: string) => {
              const normalizedLabel = label.toLowerCase();
              if (normalizedLabel === normalizedQuery) return 0;
              if (normalizedLabel.startsWith(normalizedQuery)) return 1;
              if (
                normalizedLabel
                  .split(/[\s_-]+/)
                  .some((part) => part.startsWith(normalizedQuery))
              ) {
                return 2;
              }
              return normalizedLabel.includes(normalizedQuery) ? 3 : -1;
            };
            return usersRef.current
              .map((item) => ({ item, rank: matchRank(item.label) }))
              .filter(({ rank }) => rank >= 0)
              .sort(
                (left, right) =>
                  sectionOrder[left.item.section] -
                    sectionOrder[right.item.section] ||
                  left.rank - right.rank ||
                  left.item.label.localeCompare(right.item.label)
              )
              .map(({ item }) => item);
          },
          render: () => {
            let popup; // Reference to the Tippy.js instance
            let component;

            return {
              onStart: (props) => {
                component = new ReactRenderer(MentionList, {
                  props,
                  editor: props.editor,
                });

                if (!props.clientRect) {
                  return;
                }

                popup = tippy('body', {
                  getReferenceClientRect: props.clientRect,
                  appendTo: () => document.body,
                  content: component.element,
                  showOnCreate: true,
                  interactive: true,
                  trigger: 'manual',
                  placement: 'top-start',
                  offset: [0, 16],
                  maxWidth: 'none',
                  theme: 'qchat-mention',
                });
              },

              onUpdate(props) {
                if (!component || !popup?.[0]) {
                  return;
                }

                component.updateProps(props);

                if (!props.clientRect) {
                  return;
                }

                popup[0].setProps({
                  getReferenceClientRect: props.clientRect,
                });
              },

              onKeyDown(props) {
                if (props.event.key === 'Escape') {
                  popup?.[0]?.hide();

                  return true;
                }

                return component?.ref?.onKeyDown(props);
              },

              onExit() {
                popup?.[0]?.destroy();
                component?.destroy();
              },
            };
          },
        },
      }),
    ];
  }, [enableMentions]);
  const editorExtensions = useMemo(
    () => [
      ...extensionsFiltered,
      placeholderExtension,
      ...additionalExtensions,
    ],
    [additionalExtensions, extensionsFiltered, placeholderExtension]
  );

  const handleSetIsDisabledEditorEnter = useCallback((val) => {
    setIsDisabledEditorEnter(val);
    localStorage.setItem('settings-disable-editor-enter', JSON.stringify(val));
  }, []);

  const useComposerLook = isChat || composerStyle;
  // The formatting toolbar only belongs in the expanded (keyboard-open) compose
  // layout on mobile chat; in the compact state we hide it so the normal app
  // panels can return.
  const showToolbar =
    mobileChatCompose || !isMobile || overrideMobile || !isChat;

  const editorMaxHeight =
    mobileChatCompose || mobileChatCompact
      ? '120px'
      : isMobile
        ? `calc(100svh - ${customEditorHeight || isReply ? '230px' : '190px'})`
        : customEditorHeight
          ? `${customEditorHeight}px`
          : '250px';

  const editorInlineStyle =
    mobileChatCompose || mobileChatCompact
      ? 'overflow: auto; min-height: 40px; max-height: 120px'
      : isMobile
        ? `overflow: auto; min-height: ${customEditorHeight ? '200px' : '0px'}; max-height: ${editorMaxHeight}`
        : `overflow: auto; max-height: ${editorMaxHeight}`;
  const formattingTray = (
    <MenuBar
      setEditorRef={setEditorRefFunc}
      isChat={isChat}
      // The compact chat tray uses the two-row phone layout; every other
      // surface keeps the single wrapping toolbar it already had.
      isMobile={isMobile && compactChat}
      isDisabledEditorEnter={isDisabledEditorEnter}
      setIsDisabledEditorEnter={handleSetIsDisabledEditorEnter}
      toolbarStyle={useComposerLook ? 'chat' : 'default'}
      insertFiles={insertFiles}
    />
  );
  // The tray belongs to the composer box, so it renders into a host slot right
  // above the text. Portalling keeps it inside EditorProvider, which the
  // toolbar needs to reach the editor.
  const formattingTrayPanel = formattingTrayHost
    ? createPortal(
        <Box
          // Toolbar buttons must not pull focus, or the keyboard drops away
          // under the composer as soon as the tray is used.
          onMouseDown={preventFocusSteal}
          sx={{
            borderBottom: `1px solid ${theme.palette.divider}`,
            pb: '4px',
            '& .chat-format-toolbar-shell': {
              backgroundColor: 'transparent',
              border: 'none',
              borderRadius: 0,
              padding: 0,
            },
          }}
        >
          {formattingTray}
        </Box>,
        formattingTrayHost
      )
    : null;
  // This must render inside EditorProvider so useCurrentEditor can resolve it.
  const slotBefore = compactChat
    ? showFormattingTray
      ? formattingTrayPanel
      : null
    : formattingTray;
  // The corner-button composer scrolls from its wrapper so the buttons stay
  // pinned to the box while the text moves under them.
  const editorAttributeStyle = hasCornerActions
    ? ''
    : compactChat
      ? `overflow-y: auto; overflow-x: hidden; max-height: ${
          compactEditorMaxHeight == null
            ? '50vh'
            : `${compactEditorMaxHeight}px`
        }`
      : `overflow-y: auto; overflow-x: hidden; max-height: 50vh`;

  // ProseMirror view props only reach the running view through
  // editor.setOptions(), which ends in view.updateState() and a DOM selection
  // resync. On Android that aborts an in-flight IME composition, so rebuilding
  // this object on every render made the keyboard drop characters, blank out,
  // and stall the whole app. The object handed to the editor keeps a fixed
  // identity; the bodies below are reassigned each render so they still see
  // current props.
  const liveEditorHandlersRef = useRef<Pick<
    ProseMirrorEditorProps,
    'handleDrop' | 'handleKeyDown' | 'handlePaste'
  > | null>(null);
  liveEditorHandlersRef.current = {
    handleKeyDown(view, event) {
      const mentionSuggestionActive =
        mentionSuggestions !== undefined &&
        Boolean(MentionPluginKey.getState(view.state)?.active);
      if (
        mentionSuggestionActive &&
        ['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(event.key)
      ) {
        // Let the mention suggestion plugin navigate, dismiss, or accept
        // its highlighted row before chat-level shortcuts can send/edit.
        return false;
      }
      if (typeof onKeyDown === 'function') {
        const editor = editorRef.current;
        if (editor) {
          const handled = onKeyDown(event, editor);
          if (handled) return true;
        }
      }
      if (!disableEnter && !isDisabledEditorEnter && event.key === 'Enter') {
        // An Enter that closes an IME composition (Android word suggestions,
        // CJK keyboards) is reported twice: once as a composition keydown
        // with keyCode 229 and again once the word is committed. Only the
        // committed one may send.
        if (event.isComposing || event.keyCode === 229) return false;
        if (event.shiftKey) {
          view.dispatch(
            view.state.tr.replaceSelectionWith(
              view.state.schema.nodes.hardBreak.create()
            )
          );
          return true;
        } else {
          // A held Enter auto-repeats; every repeat would be another send.
          if (event.repeat) return true;
          if (typeof onEnter === 'function') {
            // Mobile keyboards can deliver repeated Enter before React
            // re-renders the sending latch — debounce the send trigger.
            // Kept outside the editor so a remount cannot reopen the window.
            const now = Date.now();
            if (now - lastEnterSendAt < 500) return true;
            lastEnterSendAt = now;
            onEnter();
          }
          return true;
        }
      }
      return false;
    },
    handlePaste(view, event) {
      if (!isChat) return false;
      const items = event.clipboardData?.items;
      if (!items) return false;
      const files = Array.from(event.clipboardData?.files || []);
      const pastedText = event.clipboardData?.getData('text/plain');

      // On Android a picture is read from the clipboard by the app itself:
      // what the WebView hands over may be missing, or a file that can no
      // longer be read once the paste is over. The WebView's own file is
      // only the fallback.
      if (
        takesPastedImages &&
        !pastedText &&
        !event.clipboardData?.getData('text/html') &&
        files.every((file) => file.type?.startsWith('image/'))
      ) {
        event.preventDefault();
        void readClipboardImageFile().then((file) => {
          if (file) void insertPastedFiles([file], undefined, 'clipboard');
          else if (files.length > 0) {
            void insertPastedFiles(files, undefined, 'webview');
          }
        });
        return true;
      }

      if (typeof insertFiles === 'function' && files.length > 0) {
        event.preventDefault();
        void insertPastedFiles(files);
        return true;
      }

      if (typeof insertImage !== 'function') return false;

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            event.preventDefault(); // Block the default paste
            void insertPastedFiles([file], ([clean]) =>
              handleImageUpload(clean)
            );
            return true; // Let ProseMirror know we handled it
          }
        }
      }

      // Preserve paragraph spacing when pasting plain text (double newline = new paragraph)
      const text = pastedText;
      if (text != null && text !== '') {
        event.preventDefault();
        const schema = view.state.schema;
        const paragraphs = text.split(/\n\n+/);
        const paragraphNodes = paragraphs.map((block) => {
          if (block === '') {
            return schema.nodes.paragraph.create(null, Fragment.empty);
          }
          const parts = block.split('\n');
          const content = parts.flatMap((t, i) => {
            // ProseMirror does not allow empty text nodes; skip empty parts
            if (t === '') {
              return i === 0 ? [] : [schema.nodes.hardBreak.create()];
            }
            return i === 0
              ? [schema.text(t)]
              : [schema.nodes.hardBreak.create(), schema.text(t)];
          });
          return schema.nodes.paragraph.create(null, Fragment.from(content));
        });
        const fragment = Fragment.from(paragraphNodes);
        const slice = new Slice(fragment, 0, 0);
        view.dispatch(view.state.tr.replaceSelection(slice));
        return true;
      }

      return false; // fallback to default behavior otherwise
    },
    handleDrop(_view, event) {
      if (!isChat) return false;
      const files = Array.from(event.dataTransfer?.files || []);
      if (files.length > 0 && typeof insertFiles === 'function') {
        event.preventDefault();
        void insertFiles(files);
        return true;
      }
      if (typeof insertImage !== 'function') return false;
      const image = files.find((file) => file.type.startsWith('image/'));
      if (!image) return false;
      event.preventDefault();
      handleImageUpload(image);
      return true;
    },
  };

  // The soft keyboard's return key shows what Enter does here: a send key
  // when it sends, the new-line arrow when it types a new line.
  const enterSends =
    !disableEnter && !isDisabledEditorEnter && typeof onEnter === 'function';
  const editorProps = useMemo<ProseMirrorEditorProps>(
    () => ({
      attributes: {
        class: 'tiptap-prosemirror',
        enterkeyhint: enterSends ? 'send' : 'enter',
        style: editorAttributeStyle,
      },
      handleDrop: (view, event, slice, moved) =>
        liveEditorHandlersRef.current?.handleDrop?.(view, event, slice, moved),
      handleKeyDown: (view, event) =>
        liveEditorHandlersRef.current?.handleKeyDown?.(view, event),
      handlePaste: (view, event, slice) =>
        liveEditorHandlersRef.current?.handlePaste?.(view, event, slice),
    }),
    [editorAttributeStyle, enterSends]
  );

  const editorProvider = (
    <EditorProvider
      editable={!readOnly}
      slotBefore={slotBefore}
      extensions={editorExtensions}
      content={content}
      onCreate={({ editor }) => {
        setEditorRefFunc(editor);
        editor.setEditable(!readOnly);
        if (readOnly) {
          editor.commands.clearContent();
          editor.commands.blur();
        }
        scheduleSideChromeMeasure();
      }}
      onFocus={() => {
        handleFocus();
        setComposerFocused(true);
      }}
      onBlur={() => {
        setComposerFocused(false);
      }}
      onUpdate={({ editor }) => {
        onContentUpdate?.(editor);
        scheduleSideChromeMeasure();
      }}
      editorProps={editorProps}
    />
  );

  const compactActionsNode =
    typeof compactActions === 'function'
      ? compactActions({
          stacked: false,
          squeezed: false,
          showExpiry: true,
        })
      : compactActions;
  const cornerButtonPx = COMPACT_BUTTON_SIZE;

  const cornerButtonSx = {
    borderRadius: '50%',
    color: theme.palette.text.secondary,
    flexShrink: 0,
    height: `${cornerButtonPx}px`,
    padding: 0,
    width: `${cornerButtonPx}px`,
  };
  // Outside the corner layout (the thread and announcement composers) the
  // buttons keep the bordered look that matches the discussion composer's
  // field, at the corner buttons' thumb size on phones.
  const plainCompactButtonPx = isMobile ? COMPOSER_CORNER_BUTTON_PX : 34;
  const compactButtonSx = hasCornerActions
    ? cornerButtonSx
    : {
        border: `1px solid ${theme.palette.divider}`,
        borderRadius: '8px',
        color: theme.palette.text.secondary,
        flexShrink: 0,
        height: plainCompactButtonPx,
        width: plainCompactButtonPx,
      };
  const compactIconsGrown = hasCornerActions || isMobile;

  const attachLabel = t('core:action.add_attachment', {
    postProcess: 'capitalizeFirstChar',
  });
  const attachControl = (
    <>
      <Tooltip title={attachLabel}>
        <span style={{ display: 'inline-flex' }}>
          <IconButton
            aria-label={attachLabel}
            disabled={readOnly || typeof insertFiles !== 'function'}
            onClick={() => {
              attachResumeTypingRef.current = Boolean(
                editorRef.current?.isFocused
              );
              compactFileInputRef.current?.click();
            }}
            onMouseDown={preventFocusSteal}
            size="small"
            sx={{ backgroundColor: 'transparent', ...compactButtonSx }}
          >
            <AddRoundedIcon
              sx={{
                fontSize: compactIconsGrown ? COMPOSER_CORNER_ICON_PX : 19,
              }}
            />
          </IconButton>
        </span>
      </Tooltip>
      <input
        multiple
        ref={compactFileInputRef}
        style={{ display: 'none' }}
        type="file"
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          if (files.length > 0 && typeof insertFiles === 'function') {
            void insertFiles(files);
          }
          event.currentTarget.value = '';
          if (attachResumeTypingRef.current) {
            attachResumeTypingRef.current = false;
            resumeTypingAfterPicker();
          }
        }}
      />
    </>
  );

  const formatLabel = t('core:action.formatting', {
    postProcess: 'capitalizeFirstChar',
  });
  const formatControl = (
    <Tooltip title={formatLabel}>
      <IconButton
        aria-label={formatLabel}
        aria-pressed={showFormattingTray}
        disabled={readOnly}
        onClick={() => setShowFormattingTray((show) => !show)}
        onMouseDown={preventFocusSteal}
        size="small"
        sx={{
          backgroundColor: showFormattingTray
            ? theme.palette.action.selected
            : 'transparent',
          fontFamily: 'Inter',
          fontSize: compactIconsGrown ? COMPOSER_FORMAT_LABEL_PX : 13,
          fontWeight: 700,
          ...compactButtonSx,
          color: showFormattingTray
            ? theme.palette.text.primary
            : theme.palette.text.secondary,
        }}
      >
        Aa
      </IconButton>
    </Tooltip>
  );

  const emojiLabel = emojiPanelOpen
    ? t('core:composer.keyboard', { postProcess: 'capitalizeFirstChar' })
    : t('core:composer.emoji', { postProcess: 'capitalizeFirstChar' });
  const emojiControl = useEmojiKeyboardPanel ? (
    <Tooltip title={emojiLabel}>
      <span style={{ display: 'inline-flex' }}>
        <IconButton
          aria-label={emojiLabel}
          disabled={readOnly}
          onClick={() => {
            toggleEmojiPanel();
          }}
          onMouseDown={preventFocusSteal}
          onPointerDown={preventFocusSteal}
          size="small"
          sx={{ backgroundColor: 'transparent', ...compactButtonSx }}
        >
          {emojiPanelOpen ? (
            <KeyboardOutlinedIcon sx={{ fontSize: COMPOSER_CORNER_ICON_PX }} />
          ) : (
            <SentimentSatisfiedAltOutlinedIcon
              sx={{ fontSize: COMPOSER_CORNER_ICON_PX }}
            />
          )}
        </IconButton>
      </span>
    </Tooltip>
  ) : (
    <Box
      sx={{
        alignItems: 'center',
        display: 'inline-flex',
        flexShrink: 0,
        justifyContent: 'center',
        opacity: readOnly ? 0.4 : 1,
        pointerEvents: readOnly ? 'none' : undefined,
      }}
    >
      {/* Only the corner rails show this, so it takes a corner slot's size. */}
      <ReactionPicker
        buttonSize={COMPACT_BUTTON_SIZE}
        compactComposer
        iconSize={COMPOSER_CORNER_ICON_PX}
        neutralIcon
        onGifSelect={insertGif}
        onReaction={(emoji: string) => {
          editorRef.current?.chain().focus().insertContent(emoji).run();
        }}
      />
    </Box>
  );

  const expandLabel = composerExpanded
    ? t('core:composer.shrink', { postProcess: 'capitalizeFirstChar' })
    : t('core:composer.expand', { postProcess: 'capitalizeFirstChar' });
  const expandControl = (
    <Tooltip title={expandLabel}>
      <IconButton
        aria-label={expandLabel}
        onClick={() => setComposerExpanded((expanded) => !expanded)}
        onMouseDown={preventFocusSteal}
        size="small"
        sx={cornerButtonSx}
      >
        {composerExpanded ? (
          <CloseFullscreenRoundedIcon
            sx={{ fontSize: COMPOSER_EXPAND_ICON_PX }}
          />
        ) : (
          <OpenInFullRoundedIcon sx={{ fontSize: COMPOSER_EXPAND_ICON_PX }} />
        )}
      </IconButton>
    </Tooltip>
  );

  const secondaryCompactActions = (
    <>
      {attachControl}
      {formatControl}
    </>
  );

  if (compactChat) {
    return (
      <Box
        ref={composerRootRef}
        className={`tiptap-chat-composer tiptap-chat-composer--compact${
          hasCornerActions ? ' tiptap-chat-composer--corners' : ''
        }${composerExpanded ? ' tiptap-chat-composer--expanded' : ''}`}
        sx={{
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          minHeight: 0,
          minWidth: 0,
          overflow: composerExpanded ? 'visible' : 'hidden',
          position: 'relative',
          zIndex: 1,
          backgroundColor: 'transparent',
          ...(composerExpanded && {
            backgroundColor: theme.palette.background.default,
            // "Fixed" here resolves against the shell's content box (ancestors
            // carry transforms), and the shell already gives the emoji panel
            // its slot as bottom padding — so this edge follows the panel on
            // its own, and offsetting it again would take that space twice.
            bottom: 0,
            left: 0,
            padding: `calc(${SAFE_AREA_TOP} + 8px) 10px ${
              emojiPanelOpen
                ? '10px'
                : 'max(10px, var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))'
            }`,
            position: 'fixed',
            right: 0,
            top: 0,
            // Above the compose top bar (1400), which would otherwise show as
            // a grey strip across the top of the full-screen composer.
            zIndex: 1450,
          }),
          '--text-primary': theme.palette.text.primary,
          '--text-secondary': theme.palette.text.secondary,
          '--background-default': theme.palette.background.default,
          '--background-secondary': theme.palette.background.paper,
          '--code-block-bg': theme.palette.background.paper,
          '--code-block-accent': theme.palette.primary.main,
          '--code-block-border': theme.palette.divider,
          '--composer-bg': 'transparent',
          '--composer-border': theme.palette.divider,
          // Button sizes, offsets, indents and stage floors for the corner
          // layout in chat.css, all derived from the button sizes.
          ...(hasCornerActions && COMPOSER_CORNER_CSS_VARS),
        }}
      >
        {hasCornerActions ? (
          // Telegram-style box: the controls sit in the corners of a fixed
          // gutter on each side and the text keeps the full width between them,
          // so growing the message never reshuffles the buttons.
          <>
            {composerExpanded && (
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  flexShrink: 0,
                  gap: 1,
                  pb: 1,
                }}
              >
                <Typography
                  sx={{
                    color: theme.palette.text.secondary,
                    fontSize: 13,
                    fontWeight: 600,
                    letterSpacing: '0.02em',
                    textTransform: 'uppercase',
                  }}
                >
                  {t('core:composer.title')}
                </Typography>
                <Box sx={{ ml: 'auto' }}>{expandControl}</Box>
              </Box>
            )}
            {composerExpanded && (
              <Box
                id={FULLSCREEN_COMPOSER_ATTACHMENTS_SLOT_ID}
                sx={{
                  flexShrink: 0,
                  // Enough attachments to fill the screen would leave nowhere
                  // to type; past a third of it they scroll.
                  maxHeight: '33vh',
                  overflowY: 'auto',
                  width: '100%',
                }}
              />
            )}
            <Box
              className="tiptap-format-tray-host"
              ref={setFormattingTrayHost}
              sx={{ flexShrink: 0, width: '100%' }}
            />
            <Box
              className="compact-composer-row"
              ref={compactRowRef}
              onClick={(event) => {
                if (readOnly) return;
                if ((event.target as HTMLElement).closest('button')) return;
                editorRef.current?.commands?.focus?.();
              }}
              sx={{
                alignItems: 'stretch',
                display: 'flex',
                flex: 1,
                flexDirection: composerExpanded ? 'column' : 'row',
                gap: `${COMPACT_ACTION_GAP}px`,
                minHeight: composerExpanded
                  ? 0
                  : `${COMPOSER_SEND_BUTTON_PX}px`,
                minWidth: 0,
                overflow: 'visible',
                position: 'relative',
                width: '100%',
              }}
            >
              <Box
                aria-disabled={readOnly}
                className="compact-composer-editor"
                ref={composerEditorRef}
                sx={{
                  cursor: readOnly ? 'not-allowed' : undefined,
                  flex: 1,
                  maxHeight: composerExpanded
                    ? 'none'
                    : compactEditorMaxHeight != null
                      ? `${compactEditorMaxHeight}px`
                      : hasCornerActions
                        ? `${COMPACT_EDITOR_MAX_HEIGHT}px`
                        : '50vh',
                  minHeight: 0,
                  minWidth: 0,
                  overflowX: 'hidden',
                  overflowY: 'auto',
                  pointerEvents: readOnly ? 'none' : undefined,
                  opacity: readOnly ? 0.68 : 1,
                  position: 'relative',
                  '& .tiptap p.is-editor-empty:first-child::before': {
                    display: readOnly ? 'none' : undefined,
                  },
                  '& .tiptap-prosemirror': composerExpanded
                    ? { minHeight: '100%' }
                    : undefined,
                }}
              >
                {readOnly && (
                  <Typography
                    aria-hidden="true"
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: 15,
                      left: 10,
                      lineHeight: 1.4,
                      overflow: 'hidden',
                      pointerEvents: 'none',
                      position: 'absolute',
                      right: 4,
                      textOverflow: 'ellipsis',
                      top: 7,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t('group:chat_group.admins_only_write')}
                  </Typography>
                )}
                {editorProvider}
              </Box>
              <Box
                className="compact-composer-overlay"
                onMouseDown={preventFocusSteal}
                sx={
                  composerExpanded
                    ? {
                        alignItems: 'center',
                        display: 'flex',
                        flexShrink: 0,
                        gap: `${COMPACT_ACTION_GAP}px`,
                        pt: 1,
                        width: '100%',
                      }
                    : {
                        bottom: 0,
                        display: 'flex',
                        justifyContent: 'space-between',
                        left: 0,
                        pointerEvents: 'none',
                        position: 'absolute',
                        right: 0,
                        top: 0,
                        zIndex: 2,
                      }
                }
              >
                <Box className="compact-composer-rail compact-composer-rail--left">
                  <Box
                    className="compact-composer-attach"
                    sx={{ display: 'inline-flex' }}
                  >
                    {attachControl}
                  </Box>
                  <Box
                    className="compact-composer-emoji"
                    sx={{ display: 'inline-flex' }}
                  >
                    {emojiControl}
                  </Box>
                  <Box
                    className="compact-composer-format"
                    sx={{ display: 'inline-flex' }}
                  >
                    {formatControl}
                  </Box>
                </Box>
                <Box className="compact-composer-rail compact-composer-rail--right">
                  {/* The full-screen composer shares its attachment slot and
                      the app-shell flags with the chat composer under a
                      dialog, so a thread's composer scrolls instead. */}
                  {!inOverlay && (
                    <Box className="compact-composer-expand">
                      {expandControl}
                    </Box>
                  )}
                  {compactActionsNode}
                </Box>
              </Box>
            </Box>
          </>
        ) : (
          <>
            <Box
              className="tiptap-format-tray-host"
              ref={setFormattingTrayHost}
              sx={{ flexShrink: 0, width: '100%' }}
            />
            <Box
              sx={{
                // Controls sit on the input's centre line rather than its
                // baseline, which keeps the row balanced as the editor grows.
                alignItems: 'center',
                display: 'flex',
                gap: 0.5,
                minHeight: 42,
                width: '100%',
              }}
            >
              {/* Editor leads the row so the typing area gets the full width;
                the attach/format controls are grouped at the trailing edge. */}
              <Box
                aria-disabled={readOnly}
                sx={{
                  cursor: readOnly ? 'not-allowed' : undefined,
                  flex: 1,
                  pointerEvents: readOnly ? 'none' : undefined,
                  minWidth: 0,
                  opacity: readOnly ? 0.68 : 1,
                  position: 'relative',
                  '& .tiptap p.is-editor-empty:first-child::before': {
                    display: readOnly ? 'none' : undefined,
                  },
                }}
              >
                {readOnly && (
                  <Typography
                    aria-hidden="true"
                    sx={{
                      color: theme.palette.text.secondary,
                      fontSize: 15,
                      left: 10,
                      lineHeight: 1.4,
                      overflow: 'hidden',
                      pointerEvents: 'none',
                      position: 'absolute',
                      right: 10,
                      textOverflow: 'ellipsis',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      whiteSpace: 'nowrap',
                      zIndex: 2,
                    }}
                  >
                    {t('group:chat_group.admins_only_write')}
                  </Typography>
                )}
                {editorProvider}
              </Box>
              <Box
                sx={{
                  alignItems: 'center',
                  display: 'flex',
                  flexShrink: 0,
                  gap: 0.5,
                }}
              >
                {secondaryCompactActions}
              </Box>
            </Box>
          </>
        )}
      </Box>
    );
  }

  return (
    <Box
      ref={setComposerRoot}
      className={
        useComposerLook
          ? mobileChatCompose
            ? 'tiptap-chat-composer tiptap-chat-composer--mobile-compose'
            : 'tiptap-chat-composer'
          : undefined
      }
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        justifyContent: 'space-between',
        '--text-primary': theme.palette.text.primary,
        '--text-secondary': theme.palette.text.secondary,
        '--background-default': theme.palette.background.default,
        '--background-secondary': theme.palette.background.paper,
        '--code-block-bg': theme.palette.background.paper,
        '--code-block-accent': theme.palette.primary.main,
        '--code-block-border': theme.palette.divider,
        ...(useComposerLook && {
          '--composer-bg': theme.palette.background.default,
          '--composer-border': theme.palette.divider,
        }),
      }}
    >
      {editorProvider}
      {takesPastedImages && (
        <ClipboardImagePasteChip
          active={composerFocused}
          anchorEl={composerRoot}
          onPaste={insertPastedImage}
        />
      )}
    </Box>
  );
};

export default Tiptap;
