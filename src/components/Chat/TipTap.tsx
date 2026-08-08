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
import StarterKit from '@tiptap/starter-kit';
import { Color } from '@tiptap/extension-color';
import ListItem from '@tiptap/extension-list-item';
import TextStyle from '@tiptap/extension-text-style';
import Placeholder from '@tiptap/extension-placeholder';
import { createNamedFile } from '../../utils/namedFile';
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
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import FormatHeadingIcon from '@mui/icons-material/FormatSize';
import DeveloperModeIcon from '@mui/icons-material/DeveloperMode';
import Compressor from 'compressorjs';
import Mention, { MentionPluginKey } from '@tiptap/extension-mention';
import ImageResize from 'tiptap-extension-resize-image'; // Import the ResizeImage extension
import tippy from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import { ReactRenderer } from '@tiptap/react';
import MentionList from './MentionList';
import { isDisabledEditorEnterAtom } from '../../atoms/global.js';
import {
  Box,
  Checkbox,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useAtom, useSetAtom } from 'jotai';
import { mobileChatComposeActiveAtom } from '../../atoms/global.js';
import { MOBILE_CHAT_TOOLBAR_SLOT_ID } from '../Mobile/mobileChatCompose';
import { fileToBase64 } from '../../utils/fileReading/index.js';
import { useSoftKeyboardOpen } from '../../hooks/useSoftKeyboardOpen';
import { useTranslation } from 'react-i18next';
import i18n from 'i18next';

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
        setPortalHost(
          document.getElementById(MOBILE_CHAT_TOOLBAR_SLOT_ID)
        );
      });
      return () => cancelAnimationFrame(frame);
    }, [toolbarInTopBar]);

    if (!editor) {
      return null;
    }

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

    const iconButtonSx = (isActive: boolean) => ({
      color: isActive
        ? theme.palette.text.primary
        : theme.palette.text.secondary,
      flexShrink: 0,
      padding: isMobile && isChat ? '6px' : isMobile ? '3px' : '4px',
      minWidth: isMobile && isChat ? 40 : undefined,
      minHeight: isMobile && isChat ? 40 : undefined,
      '&:hover': {
        backgroundColor: theme.palette.action.hover,
        color: theme.palette.text.primary,
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
          padding:
            toolbarInTopBar
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
        {toolbarInTopBar ? (
          // Two rows so every formatting action is visible without scrolling
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
        ) : (
          mobileChatToolbarRows || (
        <Box
          className={isMobile && isChat ? 'chat-format-toolbar' : undefined}
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
                  if (isChat && files.length > 0 && typeof insertFiles === 'function') {
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
        ))}
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
  membersWithNames?: unknown[];
  mentionSuggestions?: MentionSuggestionItem[];
  enableMentions?: boolean;
  insertImage?: (image: any) => void;
  mobileTopBarActions?: ReactNode;
  insertFiles?: (files: File[]) => void | Promise<void>;
  compactChat?: boolean;
  compactEditorMaxHeight?: number;
  compactActions?: ReactNode;
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
  membersWithNames = [],
  mentionSuggestions,
  enableMentions,
  insertImage,
  mobileTopBarActions,
  insertFiles,
  compactChat = false,
  compactEditorMaxHeight,
  compactActions,
  placeholder,
  collapseFormattingTraySignal,
}: TiptapProps) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const setMobileComposeActive = useSetAtom(mobileChatComposeActiveAtom);
  const compactFileInputRef = useRef<HTMLInputElement | null>(null);
  const [showFormattingTray, setShowFormattingTray] = useState(false);

  useEffect(() => {
    if (collapseFormattingTraySignal === undefined) return;
    setShowFormattingTray(false);
  }, [collapseFormattingTraySignal]);
  const [isDisabledEditorEnter, setIsDisabledEditorEnter] = useAtom(
    isDisabledEditorEnterAtom
  );

  const isLandscape = useMediaQuery('(orientation: landscape)');
  const keyboardOpen = useSoftKeyboardOpen();
  // Whether the *expanded* mobile compose layout should be shown: the formatting
  // toolbar moves into the top bar and the app's top/bottom panels hide. In
  // portrait this tracks the soft keyboard, so dismissing the keyboard drops
  // back to a compact composer (the text and the send/close/share buttons stay)
  // and restores the normal panels — without clearing focus or the draft.
  const [keyboardActive, setKeyboardActive] = useState(false);
  const keyboardWasOpenRef = useRef(false);

  const mobileChatCompose =
    isMobile &&
    isChat &&
    Boolean(isFocusedParent) &&
    (isLandscape || keyboardActive);

  // A focused composer in portrait with the keyboard dismissed: keep it visible
  // and compact (text + action buttons) rather than expanding to full compose.
  const mobileChatCompact =
    isMobile && isChat && Boolean(isFocusedParent) && !mobileChatCompose;

  useLayoutEffect(() => {
    if (!isMobile || !isChat) return;
    setMobileComposeActive(mobileChatCompose);
  }, [mobileChatCompose, isMobile, isChat, setMobileComposeActive]);

  useEffect(() => {
    return () => {
      if (isMobile && isChat) {
        setMobileComposeActive(false);
      }
    };
  }, [isMobile, isChat, setMobileComposeActive]);

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
    keyboardWasOpenRef.current = false;
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
  }, [keyboardOpen, isLandscape, isMobile, isChat]);

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
          const toBase64 = await fileToBase64(compressedFile);
          insertImage?.(toBase64);
        }
      } catch (error) {
        console.error(error);
      }
    },
    [insertImage]
  );

  const extensionsFiltered = isChat
    ? extensions.filter((item) => item?.name !== 'image' && item?.name !== 'placeholder')
    : extensions.filter((item) => item?.name !== 'placeholder');
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
  const editorRef = useRef(null);
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

  const users = useMemo(() => {
    if (mentionSuggestions) return mentionSuggestions;
    return (membersWithNames || [])?.map((item) => {
      const label = String(item || '').trim();
      return {
        id: label,
        label,
        section: 'people' as const,
        kind: 'person' as const,
        description: 'Member',
      };
    }).filter((item) => item.label);
  }, [membersWithNames, mentionSuggestions]);

  const usersRef = useRef([]);
  useEffect(() => {
    usersRef.current = users; // Keep users up-to-date
  }, [users]);

  const handleFocus = useCallback(() => {
    if (isMobile && setIsFocusedParent) {
      if (isChat) {
        setKeyboardActive(true);
      }
      setIsFocusedParent(true);
    }
  }, [isMobile, isChat, setIsFocusedParent]);

  const handleBlur = () => {
    const htmlContent = editorRef.current?.getHTML();
    if (!htmlContent?.trim() || htmlContent?.trim() === '<p></p>') {
      // Set focus state based on content
    }
  };

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
      isDisabledEditorEnter={isDisabledEditorEnter}
      setIsDisabledEditorEnter={handleSetIsDisabledEditorEnter}
      toolbarStyle={useComposerLook ? 'chat' : 'default'}
      insertFiles={insertFiles}
    />
  );
  // This must render inside EditorProvider so useCurrentEditor can resolve it.
  const slotBefore = compactChat ? (
    showFormattingTray ? (
      <Box
        sx={{
          backgroundColor: theme.palette.background.paper,
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: '8px',
          bottom: 'calc(100% + 8px)',
          boxShadow: '0 10px 28px rgba(0, 0, 0, 0.28)',
          left: 0,
          p: 0.5,
          position: 'absolute',
          right: 0,
          zIndex: 3,
        }}
      >
        {formattingTray}
      </Box>
    ) : null
  ) : (
    formattingTray
  );
  const editorProvider = (
    <EditorProvider
      editable={!readOnly}
      slotBefore={slotBefore}
      extensions={[...extensionsFiltered, placeholderExtension, ...additionalExtensions]}
      content={content}
      onCreate={({ editor }) => {
        setEditorRefFunc(editor);
        editor.setEditable(!readOnly);
        if (readOnly) {
          editor.commands.clearContent();
          editor.commands.blur();
        }
        editor.on('blur', handleBlur); // Listen for blur event
      }}
      onUpdate={({ editor }) => {
        editor.on('blur', handleBlur); // Ensure blur is updated
        onContentUpdate?.(editor);
      }}
      editorProps={{
        attributes: {
          class: 'tiptap-prosemirror',
          style: compactChat
            ? `overflow-y: auto; overflow-x: hidden; max-height: ${
                compactEditorMaxHeight == null
                  ? '50vh'
                  : `${compactEditorMaxHeight}px`
              }`
            : `overflow-y: auto; overflow-x: hidden; max-height: 50vh`,
        },
        handleKeyDown(view, event) {
          const mentionSuggestionActive =
            mentionSuggestions !== undefined &&
            Boolean(MentionPluginKey.getState(view.state)?.active);
          if (
            mentionSuggestionActive &&
            ['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(
              event.key
            )
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
          if (
            !disableEnter &&
            !isDisabledEditorEnter &&
            event.key === 'Enter'
          ) {
            if (event.shiftKey) {
              view.dispatch(
                view.state.tr.replaceSelectionWith(
                  view.state.schema.nodes.hardBreak.create()
                )
              );
              return true;
            } else {
              if (typeof onEnter === 'function') {
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

          if (typeof insertFiles === 'function') {
            const files = Array.from(event.clipboardData?.files || []);
            if (files.length > 0) {
              event.preventDefault();
              void insertFiles(files);
              return true;
            }
          }

          if (typeof insertImage !== 'function') return false;

          for (const item of items) {
            if (item.type.startsWith('image/')) {
              const file = item.getAsFile();
              if (file) {
                event.preventDefault(); // Block the default paste
                handleImageUpload(file); // Custom handler
                return true; // Let ProseMirror know we handled it
              }
            }
          }

          // Preserve paragraph spacing when pasting plain text (double newline = new paragraph)
          const text = event.clipboardData?.getData('text/plain');
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
                  : [
                      schema.nodes.hardBreak.create(),
                      schema.text(t),
                    ];
              });
              return schema.nodes.paragraph.create(
                null,
                Fragment.from(content)
              );
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
      }}
    />
  );

  if (compactChat) {
    return (
      <Box
        className="tiptap-chat-composer tiptap-chat-composer--compact"
        sx={{
          display: 'flex',
          flex: 1,
          flexDirection: 'column',
          minWidth: 0,
          overflow: 'visible',
          position: 'relative',
          zIndex: 1,
          '--text-primary': theme.palette.text.primary,
          '--text-secondary': theme.palette.text.secondary,
          '--background-default': theme.palette.background.default,
          '--background-secondary': theme.palette.background.paper,
          '--code-block-bg': theme.palette.background.paper,
          '--code-block-accent': theme.palette.primary.main,
          '--code-block-border': theme.palette.divider,
          '--composer-bg': theme.palette.background.default,
          '--composer-border': theme.palette.divider,
        }}
      >
        <Box
          sx={{
            alignItems: 'flex-start',
            display: 'flex',
            gap: 0.5,
            minHeight: 44,
            width: '100%',
          }}
        >
          <Tooltip title="Add attachment">
            <span>
              <IconButton
                disabled={readOnly || disableEnter || typeof insertFiles !== 'function'}
                onClick={() => compactFileInputRef.current?.click()}
                size="small"
                sx={{
                  backgroundColor: 'transparent',
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: '8px',
                  color: theme.palette.text.secondary,
                  flexShrink: 0,
                  height: 34,
                  mt: '5px',
                  width: 34,
                }}
              >
                <AddRoundedIcon sx={{ fontSize: 20 }} />
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
            }}
          />
          <Tooltip title="Formatting">
            <IconButton
              disabled={readOnly}
              onClick={() => setShowFormattingTray((show) => !show)}
              size="small"
              sx={{
                backgroundColor: showFormattingTray
                  ? theme.palette.action.selected
                  : 'transparent',
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: '8px',
                color: showFormattingTray
                  ? theme.palette.text.primary
                  : theme.palette.text.secondary,
                flexShrink: 0,
                fontFamily: 'Inter',
                fontSize: 14,
                fontWeight: 700,
                height: 34,
                mt: '5px',
                width: 34,
              }}
            >
              Aa
            </IconButton>
          </Tooltip>
          {compactActions}
          <Box
            aria-disabled={readOnly}
            sx={{
              cursor: readOnly ? 'not-allowed' : undefined,
              flex: 1,
              pointerEvents: readOnly ? 'none' : undefined,
              minWidth: 0,
              mt: '5px',
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
                Only group admins can write in this channel
              </Typography>
            )}
            {editorProvider}
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box
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
    </Box>
  );
};

export default Tiptap;
