import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { useAtom, useAtomValue, useStore } from 'jotai';
import { Rnd } from 'react-rnd';
import {
  userInfoAtom,
  balanceAtom,
  blockedAddressesAtom,
  groupQManagerPopupSizeAtom,
} from '../../atoms/global';
import {
  decodeBase64ForUIChatMessages,
  objectToBase64,
} from '../../qdn/encryption/group-encryption';
import { ChatList } from './ChatList';
import Tiptap from './TipTap';
import './chat.css';
import { CustomButton } from '../../styles/App-styles';
import CircularProgress from '@mui/material/CircularProgress';
import { LoadingSnackbar } from '../Snackbar/LoadingSnackbar';
import {
  getBaseApiReact,
  getBaseApiReactSocket,
  QORTAL_APP_CONTEXT,
  pauseAllQueues,
  resumeAllQueues,
} from '../../App';
import { CustomizedSnackbars } from '../Snackbar/Snackbar';
import {
  MAX_SIZE_MESSAGE,
  MESSAGE_LIMIT_WARNING,
  MIN_REQUIRED_QORTS,
  PUBLIC_NOTIFICATION_CODE_FIRST_SECRET_KEY,
  TIME_MINUTES_2_IN_MILLISECONDS,
} from '../../constants/constants';
import { useMessageQueue } from '../../messaging/MessageQueueContext.tsx';
import {
  executeEvent,
  subscribeToEvent,
  unsubscribeFromEvent,
} from '../../utils/events';
import {
  getChatDraft,
  setChatDraft,
  clearChatDraft,
  groupDraftKey,
} from '../../utils/chatPersistence';
import {
  Box,
  ButtonBase,
  IconButton,
  Portal,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import ShortUniqueId from 'short-unique-id';
import { ReplyPreview } from './MessageItem';
import { ExitIcon } from '../../assets/Icons/ExitIcon';
import { RESOURCE_TYPE_NUMBER_GROUP_CHAT_REACTIONS } from '../../constants/constants';
import { getFee, isExtMsg } from '../../background/background.ts';
import { appHeighOffset, appHeighOffsetPx } from '../Desktop/CustomTitleBar';
import AppViewerContainer from '../Apps/AppViewerContainer';
import CloseIcon from '@mui/icons-material/Close';
import { throttle } from 'lodash';
import ImageIcon from '@mui/icons-material/Image';
import SendIcon from '@mui/icons-material/Send';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CreateRoundedIcon from '@mui/icons-material/CreateRounded';
import { messageHasImage } from '../../utils/chat';
import { SAFE_AREA_BOTTOM, SAFE_AREA_TOP } from '../../utils/mobileSafeArea';
import { useTranslation } from 'react-i18next';

const uid = new ShortUniqueId({ length: 5 });
const uidImages = new ShortUniqueId({ length: 12 });
const Q_MANAGER_DEFAULT_WIDTH = 400;
const Q_MANAGER_DEFAULT_HEIGHT = 600;
const Q_MANAGER_MIN_WIDTH = 360;
const Q_MANAGER_MIN_HEIGHT = 420;
const Q_MANAGER_HEADER_HEIGHT = 40;

export const ChatGroup = ({
  selectedGroup,
  secretKey,
  getSecretKey,
  myAddress,
  handleNewEncryptionNotification,
  hide,
  handleSecretKeyCreationInProgress,
  triedToFetchSecretKey,
  getTimestampEnterChatParent,
  hideView,
  isActive,
  isPrivate,
}) => {
  const userInfo = useAtomValue(userInfoAtom);
  const balance = useAtomValue(balanceAtom);
  const [qManagerPopupSize, setQManagerPopupSize] = useAtom(
    groupQManagerPopupSizeAtom
  );
  const myName = userInfo?.name;
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isLandscape = useMediaQuery('(orientation: landscape)');
  // In landscape the composer is hidden behind a pen FAB so it never covers
  // the last messages; tapping the FAB expands it from the corner.
  const composerFabMode = isMobile && isLandscape;
  const [composerOpenLandscape, setComposerOpenLandscape] = useState(false);
  const { show } = useContext(QORTAL_APP_CONTEXT);
  const jotaiStore = useStore();
  const isChatSenderBlocked = useCallback(
    (item?: { sender?: string }) => {
      const addresses = jotaiStore.get(blockedAddressesAtom);
      const sender = item?.sender;
      return !!(sender && addresses[sender]);
    },
    [jotaiStore]
  );
  const [messages, setMessages] = useState([]);
  const [chatReferences, setChatReferences] = useState({});
  const [isSending, setIsSending] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isMoved, setIsMoved] = useState(false);
  const [openSnack, setOpenSnack] = useState(false);
  const [infoSnack, setInfoSnack] = useState(null);
  const hasInitialized = useRef(false);
  const [isFocusedParent, setIsFocusedParent] = useState(false);
  const [replyMessage, setReplyMessage] = useState(null);
  const [onEditMessage, setOnEditMessage] = useState(null);
  const [isOpenQManager, setIsOpenQManager] = useState(null);
  const [isDeleteImage, setIsDeleteImage] = useState(false);
  const [messageSize, setMessageSize] = useState(0);
  const [chatImagesToSave, setChatImagesToSave] = useState([]);
  const hasInitializedWebsocket = useRef(false);
  const socketRef = useRef(null); // WebSocket reference
  const timeoutIdRef = useRef(null); // Timeout ID reference
  const groupSocketTimeoutRef = useRef(null); // Group Socket Timeout reference
  const editorRef = useRef(null);
  // Mirrors editorRef as state so effects that wire up listeners (draft saving,
  // message-size calc) re-run as soon as the editor instance is created.
  const [editorInstance, setEditorInstance] = useState(null);

  const openLandscapeComposer = useCallback(() => {
    setComposerOpenLandscape(true);
    setIsFocusedParent(true);
    setTimeout(() => {
      try {
        editorRef.current?.chain().focus().run();
      } catch {
        /* editor may not be ready yet */
      }
    }, 80);
  }, []);

  const closeLandscapeComposer = useCallback(() => {
    setComposerOpenLandscape(false);
    setIsFocusedParent(false);
    editorRef.current?.commands.blur();
  }, []);

  // Collapse the landscape composer back to the pen FAB only when switching
  // to a different group — NOT on focus/keyboard changes, so closing the
  // keyboard keeps the composer (and any typed text) open.
  useEffect(() => {
    setComposerOpenLandscape(false);
  }, [selectedGroup]);

  const { queueChats, addToQueue, processWithNewMessages } = useMessageQueue();
  const [, forceUpdate] = useReducer((x) => x + 1, 0);
  const lastReadTimestamp = useRef(null);
  const handleUpdateRef = useRef(null);
  const iframeRef = useRef(null);
  const [windowSize, setWindowSize] = useState(() =>
    typeof window !== 'undefined'
      ? {
          width: window.innerWidth,
          height: window.innerHeight,
        }
      : { width: 800, height: 600 }
  );
  const [qManagerSize, setQManagerSize] = useState(() => {
    const maxWidth =
      typeof window !== 'undefined'
        ? Math.max(Q_MANAGER_MIN_WIDTH, window.innerWidth)
        : 800;
    const maxHeight =
      typeof window !== 'undefined'
        ? Math.max(Q_MANAGER_MIN_HEIGHT, window.innerHeight - appHeighOffset)
        : 600;
    return {
      width: Math.min(
        maxWidth,
        Math.max(
          Q_MANAGER_MIN_WIDTH,
          qManagerPopupSize?.width ?? Q_MANAGER_DEFAULT_WIDTH
        )
      ),
      height: Math.min(
        maxHeight,
        Math.max(
          Q_MANAGER_MIN_HEIGHT,
          qManagerPopupSize?.height ?? Q_MANAGER_DEFAULT_HEIGHT
        )
      ),
    };
  });
  const [isResizingQManager, setIsResizingQManager] = useState(false);
  const qManagerResizeInitialSizeRef = useRef(qManagerSize);

  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);

  const maxQManagerWidth = Math.max(Q_MANAGER_MIN_WIDTH, windowSize.width);
  const maxQManagerHeight = Math.max(
    Q_MANAGER_MIN_HEIGHT,
    windowSize.height - appHeighOffset
  );

  const clampQManagerSize = useCallback(
    (size: { width: number; height: number }) => ({
      width: Math.min(
        maxQManagerWidth,
        Math.max(Q_MANAGER_MIN_WIDTH, size.width)
      ),
      height: Math.min(
        maxQManagerHeight,
        Math.max(Q_MANAGER_MIN_HEIGHT, size.height)
      ),
    }),
    [maxQManagerWidth, maxQManagerHeight]
  );

  const qManagerPosition = useMemo(
    () => ({
      x: Math.max(0, windowSize.width - qManagerSize.width),
      y: Math.max(0, windowSize.height - qManagerSize.height),
    }),
    [
      windowSize.width,
      windowSize.height,
      qManagerSize.width,
      qManagerSize.height,
    ]
  );

  useEffect(() => {
    const onResize = () => {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!qManagerPopupSize) return;
    setQManagerSize(clampQManagerSize(qManagerPopupSize));
  }, [qManagerPopupSize, clampQManagerSize]);

  useEffect(() => {
    setQManagerSize((current) => clampQManagerSize(current));
  }, [clampQManagerSize]);

  const handleQManagerResizeStart = useCallback(() => {
    qManagerResizeInitialSizeRef.current = qManagerSize;
    setIsResizingQManager(true);
  }, [qManagerSize]);

  const handleQManagerResize = useCallback(
    (
      _event,
      _direction,
      _elementRef,
      delta: { width: number; height: number }
    ) => {
      const initialSize = qManagerResizeInitialSizeRef.current;
      setQManagerSize(
        clampQManagerSize({
          width: initialSize.width + delta.width,
          height: initialSize.height + delta.height,
        })
      );
    },
    [clampQManagerSize]
  );

  const handleQManagerResizeStop = useCallback(
    (_event, _direction, elementRef: HTMLElement) => {
      const nextSize = clampQManagerSize({
        width: elementRef.offsetWidth,
        height: elementRef.offsetHeight,
      });

      setQManagerSize(nextSize);
      setQManagerPopupSize(nextSize);
      setIsResizingQManager(false);
    },
    [clampQManagerSize, setQManagerPopupSize]
  );

  const getTimestampEnterChat = async (selectedGroup) => {
    try {
      return new Promise((res, rej) => {
        window
          .sendMessage('getTimestampEnterChat')
          .then((response) => {
            if (!response?.error) {
              if (response && selectedGroup) {
                lastReadTimestamp.current =
                  response[selectedGroup] || undefined;
                window
                  .sendMessage('addTimestampEnterChat', {
                    timestamp: Date.now(),
                    groupId: selectedGroup,
                  })
                  .catch((error) => {
                    console.error(
                      'Failed to add timestamp:',
                      error.message || 'An error occurred'
                    );
                  });

                setTimeout(() => {
                  getTimestampEnterChatParent();
                }, 600);
              }

              res(response);
              return;
            }
            rej(response.error);
          })
          .catch((error) => {
            rej(
              error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                })
            );
          });
      });
    } catch (error) {
      console.log(error);
    }
  };

  useEffect(() => {
    if (!selectedGroup || !isActive) return;
    getTimestampEnterChat(selectedGroup);
  }, [selectedGroup, isActive]);

  const members = useMemo(() => {
    const uniqueMembers = new Set();

    messages.forEach((message) => {
      if (message?.senderName) {
        uniqueMembers.add(message?.senderName);
      }
    });

    return Array.from(uniqueMembers);
  }, [messages]);

  const setEditorRef = (editorInstance) => {
    editorRef.current = editorInstance;
    setEditorInstance(editorInstance);
  };

  const tempMessages = useMemo(() => {
    if (!selectedGroup) return [];
    if (queueChats[selectedGroup]) {
      return queueChats[selectedGroup]?.filter((item) => !item?.chatReference);
    }
    return [];
  }, [selectedGroup, queueChats]);

  const tempChatReferences = useMemo(() => {
    if (!selectedGroup) return [];
    if (queueChats[selectedGroup]) {
      return queueChats[selectedGroup]?.filter((item) => !!item?.chatReference);
    }
    return [];
  }, [selectedGroup, queueChats]);

  const secretKeyRef = useRef(null);

  useEffect(() => {
    if (secretKey) {
      secretKeyRef.current = secretKey;
    }
  }, [secretKey]);

  const checkForFirstSecretKeyNotification = (messages) => {
    messages?.forEach((message) => {
      try {
        const decodeMsg = atob(message.data);
        if (decodeMsg === PUBLIC_NOTIFICATION_CODE_FIRST_SECRET_KEY) {
          handleSecretKeyCreationInProgress();
          return;
        }
      } catch (error) {
        console.log(error);
      }
    });
  };

  const updateChatMessagesWithBlocksFunc = useCallback(
    (e) => {
      if (e.detail) {
        setMessages((prev) =>
          prev?.filter((item) => !isChatSenderBlocked(item))
        );
      }
    },
    [isChatSenderBlocked]
  );

  useEffect(() => {
    subscribeToEvent(
      'updateChatMessagesWithBlocks',
      updateChatMessagesWithBlocksFunc
    );

    return () => {
      unsubscribeFromEvent(
        'updateChatMessagesWithBlocks',
        updateChatMessagesWithBlocksFunc
      );
    };
  }, [updateChatMessagesWithBlocksFunc]);

  const middletierFunc = async (data: any, groupId: string) => {
    try {
      if (hasInitialized.current) {
        const dataRemovedBlock = data?.filter(
          (item) => !isChatSenderBlocked(item)
        );

        decryptMessages(dataRemovedBlock, true);
        return;
      }
      hasInitialized.current = true;
      const url = `${getBaseApiReact()}/chat/messages?txGroupId=${groupId}&encoding=BASE64&limit=0&reverse=false`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      const responseData = await response.json();
      const dataRemovedBlock = responseData?.filter((item) => {
        return !isChatSenderBlocked(item);
      });
      decryptMessages(dataRemovedBlock, false);
    } catch (error) {
      console.error(error);
    }
  };

  const decryptMessages = (encryptedMessages: any[], isInitiated: boolean) => {
    try {
      if (!secretKeyRef.current) {
        checkForFirstSecretKeyNotification(encryptedMessages);
      }
      return new Promise((res, rej) => {
        window
          .sendMessage('decryptSingle', {
            data: encryptedMessages,
            secretKeyObject: secretKeyRef.current,
          })
          .then((response) => {
            if (!response?.error) {
              const filterUIMessages = encryptedMessages.filter(
                (item) => !isExtMsg(item.data)
              );

              const decodedUIMessages =
                decodeBase64ForUIChatMessages(filterUIMessages);

              const combineUIAndExtensionMsgsBefore = [
                ...decodedUIMessages,
                ...response,
              ];

              const combineUIAndExtensionMsgs = processWithNewMessages(
                combineUIAndExtensionMsgsBefore.map((item) => ({
                  ...item,
                  ...(item?.decryptedData || {}),
                })),
                selectedGroup
              );

              res(combineUIAndExtensionMsgs);

              if (isInitiated) {
                const formatted = combineUIAndExtensionMsgs
                  .filter((rawItem) => !rawItem?.chatReference)
                  .map((item) => {
                    const additionalFields =
                      item?.data === 'NDAwMQ=='
                        ? {
                            text: `<p>${t(
                              'group:message.generic.group_key_created',
                              {
                                postProcess: 'capitalizeFirstChar',
                              }
                            )}</p>`,
                          }
                        : {};
                    return {
                      ...item,
                      id: item.signature,
                      text: item?.decryptedData?.message || '',
                      repliedTo:
                        item?.repliedTo || item?.decryptedData?.repliedTo,
                      unread:
                        item?.sender === myAddress
                          ? false
                          : !!item?.chatReference
                            ? false
                            : true,
                      isNotEncrypted: !!item?.messageText,
                      ...additionalFields,
                    };
                  });
                setMessages((prev) => [...prev, ...formatted]);
                setChatReferences((prev) => {
                  const organizedChatReferences = { ...prev };
                  combineUIAndExtensionMsgs
                    .filter(
                      (rawItem) =>
                        rawItem &&
                        rawItem.chatReference &&
                        (rawItem?.decryptedData?.type === 'reaction' ||
                          rawItem?.decryptedData?.type === 'edit' ||
                          rawItem?.type === 'edit' ||
                          rawItem?.isEdited ||
                          rawItem?.type === 'reaction')
                    )
                    .forEach((item) => {
                      try {
                        if (item?.decryptedData?.type === 'edit') {
                          organizedChatReferences[item.chatReference] = {
                            ...(organizedChatReferences[item.chatReference] ||
                              {}),
                            edit: item.decryptedData,
                          };
                        } else if (item?.type === 'edit' || item?.isEdited) {
                          organizedChatReferences[item.chatReference] = {
                            ...(organizedChatReferences[item.chatReference] ||
                              {}),
                            edit: item,
                          };
                        } else {
                          const content =
                            item?.content || item.decryptedData?.content;
                          const sender = item.sender;
                          const newTimestamp = item.timestamp;
                          const contentState =
                            item?.contentState !== undefined
                              ? item?.contentState
                              : item.decryptedData?.contentState;

                          if (
                            !content ||
                            typeof content !== 'string' ||
                            !sender ||
                            typeof sender !== 'string' ||
                            !newTimestamp
                          ) {
                            console.warn(
                              t('group:message.generic.invalid_content', {
                                postProcess: 'capitalizeFirstChar',
                              }),
                              item
                            );
                            return;
                          }

                          organizedChatReferences[item.chatReference] = {
                            ...(organizedChatReferences[item.chatReference] ||
                              {}),
                            reactions:
                              organizedChatReferences[item.chatReference]
                                ?.reactions || {},
                          };

                          organizedChatReferences[item.chatReference].reactions[
                            content
                          ] =
                            organizedChatReferences[item.chatReference]
                              .reactions[content] || [];

                          let latestTimestampForSender = null;

                          organizedChatReferences[item.chatReference].reactions[
                            content
                          ] = organizedChatReferences[
                            item.chatReference
                          ].reactions[content].filter((reaction) => {
                            if (reaction.sender === sender) {
                              latestTimestampForSender = Math.max(
                                latestTimestampForSender || 0,
                                reaction.timestamp
                              );
                            }
                            return reaction.sender !== sender;
                          });

                          if (
                            latestTimestampForSender &&
                            newTimestamp < latestTimestampForSender
                          ) {
                            return;
                          }

                          if (contentState !== false) {
                            organizedChatReferences[
                              item.chatReference
                            ].reactions[content].push(item);
                          }

                          if (
                            organizedChatReferences[item.chatReference]
                              .reactions[content].length === 0
                          ) {
                            delete organizedChatReferences[item.chatReference]
                              .reactions[content];
                          }
                        }
                      } catch (error) {
                        console.error(
                          'Error processing reaction/edit item:',
                          error,
                          item
                        );
                      }
                    });

                  return organizedChatReferences;
                });
              } else {
                let firstUnreadFound = false;
                const formatted = combineUIAndExtensionMsgs
                  .filter((rawItem) => !rawItem?.chatReference)
                  .map((item) => {
                    const additionalFields =
                      item?.data === 'NDAwMQ=='
                        ? {
                            text: `<p>${t(
                              'group:message.generic.group_key_created',
                              {
                                postProcess: 'capitalizeFirstChar',
                              }
                            )}</p>`,
                          }
                        : {};
                    const divide =
                      lastReadTimestamp.current &&
                      !firstUnreadFound &&
                      item.timestamp > lastReadTimestamp.current &&
                      myAddress !== item?.sender;

                    if (divide) {
                      firstUnreadFound = true;
                    }
                    return {
                      ...item,
                      id: item.signature,
                      text: item?.decryptedData?.message || '',
                      repliedTo:
                        item?.repliedTo || item?.decryptedData?.repliedTo,
                      isNotEncrypted: !!item?.messageText,
                      unread: false,
                      divide,
                      ...additionalFields,
                    };
                  });
                setMessages(formatted);

                setChatReferences((prev) => {
                  const organizedChatReferences = { ...prev };

                  combineUIAndExtensionMsgs
                    .filter(
                      (rawItem) =>
                        rawItem &&
                        rawItem.chatReference &&
                        (rawItem?.decryptedData?.type === 'reaction' ||
                          rawItem?.decryptedData?.type === 'edit' ||
                          rawItem?.type === 'edit' ||
                          rawItem?.isEdited ||
                          rawItem?.type === 'reaction')
                    )
                    .forEach((item) => {
                      try {
                        if (item?.decryptedData?.type === 'edit') {
                          organizedChatReferences[item.chatReference] = {
                            ...(organizedChatReferences[item.chatReference] ||
                              {}),
                            edit: item.decryptedData,
                          };
                        } else if (item?.type === 'edit' || item?.isEdited) {
                          organizedChatReferences[item.chatReference] = {
                            ...(organizedChatReferences[item.chatReference] ||
                              {}),
                            edit: item,
                          };
                        } else {
                          const content =
                            item?.content || item.decryptedData?.content;
                          const sender = item.sender;
                          const newTimestamp = item.timestamp;
                          const contentState =
                            item?.contentState !== undefined
                              ? item?.contentState
                              : item.decryptedData?.contentState;

                          if (
                            !content ||
                            typeof content !== 'string' ||
                            !sender ||
                            typeof sender !== 'string' ||
                            !newTimestamp
                          ) {
                            console.warn(
                              t('group:message.generic.invalid_content', {
                                postProcess: 'capitalizeFirstChar',
                              }),
                              item
                            );
                            return;
                          }

                          organizedChatReferences[item.chatReference] = {
                            ...(organizedChatReferences[item.chatReference] ||
                              {}),
                            reactions:
                              organizedChatReferences[item.chatReference]
                                ?.reactions || {},
                          };

                          organizedChatReferences[item.chatReference].reactions[
                            content
                          ] =
                            organizedChatReferences[item.chatReference]
                              .reactions[content] || [];

                          let latestTimestampForSender = null;

                          organizedChatReferences[item.chatReference].reactions[
                            content
                          ] = organizedChatReferences[
                            item.chatReference
                          ].reactions[content].filter((reaction) => {
                            if (reaction.sender === sender) {
                              latestTimestampForSender = Math.max(
                                latestTimestampForSender || 0,
                                reaction.timestamp
                              );
                            }
                            return reaction.sender !== sender;
                          });

                          if (
                            latestTimestampForSender &&
                            newTimestamp < latestTimestampForSender
                          ) {
                            return;
                          }

                          if (contentState !== false) {
                            organizedChatReferences[
                              item.chatReference
                            ].reactions[content].push(item);
                          }

                          if (
                            organizedChatReferences[item.chatReference]
                              .reactions[content].length === 0
                          ) {
                            delete organizedChatReferences[item.chatReference]
                              .reactions[content];
                          }
                        }
                      } catch (error) {
                        console.error(
                          'Error processing reaction item:',
                          error,
                          item
                        );
                      }
                    });

                  return organizedChatReferences;
                });
              }
            }
            rej(response.error);
          })
          .catch((error) => {
            rej(
              error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                })
            );
          });
      });
    } catch (error) {
      console.log(error);
    }
  };

  const forceCloseWebSocket = () => {
    if (socketRef.current) {
      clearTimeout(timeoutIdRef.current);
      clearTimeout(groupSocketTimeoutRef.current);
      socketRef.current.close(1000, 'forced');
      socketRef.current = null;
    }
  };

  const pingGroupSocket = () => {
    try {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send('ping');
        timeoutIdRef.current = setTimeout(() => {
          if (socketRef.current) {
            socketRef.current.close();
            clearTimeout(groupSocketTimeoutRef.current);
          }
        }, 5000); // Close if no pong in 5 seconds
      }
    } catch (error) {
      console.error('Error during ping:', error);
    }
  };

  const initWebsocketMessageGroup = () => {
    let socketLink = `${getBaseApiReactSocket()}/websockets/chat/messages?txGroupId=${selectedGroup}&encoding=BASE64&limit=100`;
    socketRef.current = new WebSocket(socketLink);

    socketRef.current.onopen = () => {
      setTimeout(pingGroupSocket, 50);
    };
    socketRef.current.onmessage = (e) => {
      try {
        if (e.data === 'pong') {
          clearTimeout(timeoutIdRef.current);
          groupSocketTimeoutRef.current = setTimeout(pingGroupSocket, 20000); // Ping every 20 seconds
        } else {
          middletierFunc(JSON.parse(e.data), selectedGroup);
          setIsLoading(false);
        }
      } catch (error) {
        console.log(error);
      }
    };
    socketRef.current.onclose = () => {
      clearTimeout(groupSocketTimeoutRef.current);
      clearTimeout(timeoutIdRef.current);
      console.warn(`WebSocket closed: ${event.reason || 'unknown reason'}`);
      if (event.reason !== 'forced' && event.code !== 1000) {
        setTimeout(() => initWebsocketMessageGroup(), 1000); // Retry after 10 seconds
      }
    };
    socketRef.current.onerror = (e) => {
      clearTimeout(groupSocketTimeoutRef.current);
      clearTimeout(timeoutIdRef.current);
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  };

  // Reset the per-room init guards when the selected group changes. ChatGroup
  // is usually remounted on a group switch, but open<->open switches can reuse
  // the instance; without this the new room would never load its history.
  useEffect(() => {
    hasInitialized.current = false;
    hasInitializedWebsocket.current = false;
  }, [selectedGroup]);

  useEffect(() => {
    if (hasInitializedWebsocket.current) return;
    if (triedToFetchSecretKey && !secretKey) {
      forceCloseWebSocket();
      setMessages([]);
      hasInitialized.current = false;
      setIsLoading(true);
      initWebsocketMessageGroup();
      // Don't rely on the socket delivering the first batch — some public
      // gateway sockets only emit pongs, leaving the chat empty. Load history
      // over REST explicitly (open groups / pre-key state).
      void middletierFunc(null, selectedGroup);
    }
  }, [triedToFetchSecretKey, secretKey, isPrivate]);

  useEffect(() => {
    if (isPrivate === null) return;
    if (isPrivate === false || !secretKey || hasInitializedWebsocket.current)
      return;
    forceCloseWebSocket();
    setMessages([]);
    // The key may have arrived AFTER a keyless socket already ran the initial
    // history fetch (which couldn't decrypt). Reset so we re-fetch and decrypt
    // the full history now that the secret key is available.
    hasInitialized.current = false;
    setIsLoading(true);
    pauseAllQueues();
    setTimeout(() => {
      resumeAllQueues();
    }, 6000);
    initWebsocketMessageGroup();
    // Explicit REST history load so private-group messages appear even if the
    // socket is slow or only sends pongs (observed on public gateway nodes).
    void middletierFunc(null, selectedGroup);
    hasInitializedWebsocket.current = true;
  }, [secretKey, isPrivate]);

  useEffect(() => {
    const logoutEventFunc = () => {
      forceCloseWebSocket();
    };
    subscribeToEvent('logout-event', logoutEventFunc);
    return () => {
      unsubscribeFromEvent('logout-event', logoutEventFunc);
      forceCloseWebSocket();
    };
  }, []);

  useEffect(() => {
    const notifications = messages.filter(
      (message) => message?.decryptedData?.type === 'notification'
    );
    if (notifications.length === 0) return;
    const latestNotification = notifications.reduce((latest, current) => {
      return current.timestamp > latest.timestamp ? current : latest;
    }, notifications[0]);
    handleNewEncryptionNotification(latestNotification);
  }, [messages]);

  const encryptChatMessage = async (
    data: string,
    secretKeyObject: any,
    reactiontypeNumber?: number
  ) => {
    try {
      return new Promise((res, rej) => {
        window
          .sendMessage('encryptSingle', {
            data,
            secretKeyObject,
            typeNumber: reactiontypeNumber,
          })
          .then((response) => {
            if (!response?.error) {
              res(response);
              return;
            }
            rej(response.error);
          })
          .catch((error) => {
            rej(
              error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                })
            );
          });
      });
    } catch (error) {
      console.log(error);
    }
  };

  const sendChatGroup = async ({
    groupId,
    typeMessage = undefined,
    chatReference = undefined,
    messageText,
  }: any) => {
    try {
      return new Promise((res, rej) => {
        window
          .sendMessage(
            'sendChatGroup',
            {
              groupId,
              typeMessage,
              chatReference,
              messageText,
            },
            TIME_MINUTES_2_IN_MILLISECONDS
          )
          .then((response) => {
            if (!response?.error) {
              res(response);
              return;
            }
            rej(response.error);
          })
          .catch((error) => {
            rej(
              error.message ||
                t('core:message.error.generic', {
                  postProcess: 'capitalizeFirstChar',
                })
            );
          });
      });
    } catch (error) {
      throw new Error(error);
    }
  };
  const clearEditorContent = () => {
    if (editorRef.current) {
      setMessageSize(0);
      editorRef.current.chain().focus().clearContent().run();
      if (myAddress && selectedGroup != null) {
        clearChatDraft(myAddress, groupDraftKey(selectedGroup));
      }
    }
  };

  const closeMobileCompose = useCallback(() => {
    if (!isMobile) return;
    setIsFocusedParent(false);
    setComposerOpenLandscape(false);
    editorRef.current?.commands.blur();
  }, [isMobile]);

  const sendMessage = async () => {
    try {
      if (messageSize > MAX_SIZE_MESSAGE) return;
      if (isPrivate === null)
        throw new Error(
          t('group:message.error:determine_group_private', {
            postProcess: 'capitalizeFirstChar',
          })
        );
      if (isSending) return;
      if (+balance < MIN_REQUIRED_QORTS)
        throw new Error(
          t('group:message.error.qortals_required', {
            quantity: MIN_REQUIRED_QORTS,
            postProcess: 'capitalizeFirstChar',
          })
        );
      pauseAllQueues();
      if (editorRef.current) {
        let htmlContent = editorRef.current.getHTML();
        const deleteImage =
          onEditMessage && isDeleteImage && messageHasImage(onEditMessage);

        const hasImage =
          chatImagesToSave?.length > 0 || onEditMessage?.images?.length > 0;
        if (
          (!htmlContent?.trim() || htmlContent?.trim() === '<p></p>') &&
          !hasImage &&
          !deleteImage
        )
          return;
        if (htmlContent?.trim() === '<p></p>') {
          htmlContent = null;
        }
        setIsSending(true);
        const message =
          isPrivate === false
            ? !htmlContent
              ? '<p></p>'
              : editorRef.current.getJSON()
            : htmlContent;
        const secretKeyObject = await getSecretKey(false, true);

        let repliedTo = replyMessage?.signature;

        if (replyMessage?.chatReference) {
          repliedTo = replyMessage?.chatReference;
        }

        const chatReference = onEditMessage?.signature;

        const publicData = isPrivate
          ? {}
          : {
              isEdited: chatReference ? true : false,
            };

        interface ImageToPublish {
          service: string;
          identifier: string;
          name: string;
          base64: string;
        }

        const imagesToPublish: ImageToPublish[] = [];

        if (deleteImage) {
          const fee = await getFee('ARBITRARY');
          await show({
            publishFee: fee.fee + ' QORT',
            message: t('core:message.question.delete_chat_image', {
              postProcess: 'capitalizeFirstChar',
            }),
          });

          await window.sendMessage('publishOnQDN', {
            data: 'RA==',
            identifier: onEditMessage?.images[0]?.identifier,
            service: onEditMessage?.images[0]?.service,
            uploadType: 'base64',
          });
        }

        if (chatImagesToSave?.length > 0) {
          const imageToSave = chatImagesToSave[0];

          const base64ToSave = isPrivate
            ? await encryptChatMessage(imageToSave, secretKeyObject)
            : imageToSave;

          // 1 represents public group, 0 is private
          const identifier = `grp-q-manager_${isPrivate ? 0 : 1}_group_${selectedGroup}_${uidImages.rnd()}`;
          imagesToPublish.push({
            service: 'IMAGE',
            identifier,
            name: myName,
            base64: base64ToSave,
          });

          const res = await window.sendMessage(
            'PUBLISH_MULTIPLE_QDN_RESOURCES',
            {
              resources: imagesToPublish,
            },
            240000,
            true
          );
          if (res?.error)
            throw new Error(
              t('core:message.error.publish_image', {
                postProcess: 'capitalizeFirstChar',
              })
            );
        }

        const images =
          imagesToPublish?.length > 0
            ? imagesToPublish.map((item) => {
                return {
                  name: item.name,
                  identifier: item.identifier,
                  service: item.service,
                  timestamp: Date.now(),
                };
              })
            : chatReference
              ? isDeleteImage
                ? []
                : onEditMessage?.images || []
              : [];

        const otherData = {
          repliedTo,
          ...(onEditMessage?.decryptedData || {}),
          type: chatReference ? 'edit' : '',
          specialId: uid.rnd(),
          images: images,
          ...publicData,
        };
        const objectMessage = {
          ...(otherData || {}),
          [isPrivate ? 'message' : 'messageText']: message,
          version: 3,
        };
        const message64: any = await objectToBase64(objectMessage);

        const encryptSingle =
          isPrivate === false
            ? JSON.stringify(objectMessage)
            : await encryptChatMessage(message64, secretKeyObject);

        const sendMessageFunc = async () => {
          return await sendChatGroup({
            groupId: selectedGroup,
            messageText: encryptSingle,
            chatReference,
          });
        };

        // Add the function to the queue
        const messageObj = {
          message: {
            text: htmlContent,
            timestamp: Date.now(),
            senderName: myName,
            sender: myAddress,
            ...(otherData || {}),
          },
          chatReference,
        };
        addToQueue(sendMessageFunc, messageObj, 'chat', selectedGroup);
        if (!onEditMessage) {
          setTimeout(() => {
            executeEvent('sent-new-message-group', {});
          }, 150);
        }

        clearEditorContent();
        setReplyMessage(null);
        setOnEditMessage(null);
        setIsDeleteImage(false);
        setChatImagesToSave([]);
        closeMobileCompose();
      }
      // send chat message
    } catch (error) {
      const errorMsg = error?.message || error;
      setInfoSnack({
        type: 'error',
        message: errorMsg,
      });
      setOpenSnack(true);
      console.error(error);
    } finally {
      setIsSending(false);
      resumeAllQueues();
    }
  };

  useEffect(() => {
    if (!editorInstance) return;

    handleUpdateRef.current = throttle(async () => {
      try {
        if (isPrivate) {
          const htmlContent = editorRef.current.getHTML();
          const message64 = await objectToBase64(JSON.stringify(htmlContent));
          const secretKeyObject = await getSecretKey(false, true);
          const encryptSingle = await encryptChatMessage(
            message64,
            secretKeyObject
          );
          setMessageSize((encryptSingle?.length || 0) + 200);
        } else {
          const htmlContent = editorRef.current.getJSON();
          const message = JSON.stringify(htmlContent);
          const size = new Blob([message]).size;
          setMessageSize(size + 300);
        }
      } catch (error) {
        // calc size error
      }
    }, 1200);

    const currentEditor = editorRef.current;

    currentEditor.on('update', handleUpdateRef.current);

    // Persist whatever is typed (but not sent) so it survives leaving and
    // returning to this group, keyed per-group and per-account.
    const saveDraft = () => {
      if (!myAddress || selectedGroup == null) return;
      try {
        setChatDraft(
          myAddress,
          groupDraftKey(selectedGroup),
          currentEditor.getHTML()
        );
      } catch {
        /* ignore */
      }
    };
    currentEditor.on('update', saveDraft);

    return () => {
      currentEditor.off('update', handleUpdateRef.current);
      currentEditor.off('update', saveDraft);
    };
  }, [editorInstance, setMessageSize, isPrivate, myAddress, selectedGroup]);

  // Restore a previously saved draft for this group once the editor is ready.
  const draftRestoredRef = useRef<string | null>(null);
  useEffect(() => {
    if (selectedGroup == null || !myAddress) return;
    const key = groupDraftKey(selectedGroup);
    const token = `${myAddress}:${key}`;
    if (draftRestoredRef.current === token) return;

    const draft = getChatDraft(myAddress, key);
    if (!draft) {
      draftRestoredRef.current = token;
      return;
    }

    let tries = 0;
    let cancelled = false;
    const restore = () => {
      if (cancelled) return;
      if (editorRef.current) {
        draftRestoredRef.current = token;
        editorRef.current.commands.setContent(draft);
        try {
          setMessageSize(new Blob([JSON.stringify(draft)]).size + 300);
        } catch {
          /* ignore */
        }
        // Surface the composer (and the restored text) so the user can keep
        // typing right away, without forcing the keyboard open.
        setIsFocusedParent(true);
        setComposerOpenLandscape(true);
      } else if (tries++ < 30) {
        setTimeout(restore, 100);
      }
    };
    const timer = setTimeout(restore, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [selectedGroup, myAddress]);

  useEffect(() => {
    if (hide) {
      setTimeout(() => setIsMoved(true), 500); // Wait for the fade-out to complete before moving
    } else {
      setIsMoved(false); // Reset the position immediately when showing
    }
  }, [hide]);

  const onReply = useCallback(
    (message) => {
      if (onEditMessage) {
        clearEditorContent();
      }
      setReplyMessage(message);
      setOnEditMessage(null);
      setIsDeleteImage(false);
      setChatImagesToSave([]);
      setIsFocusedParent(true);
      setTimeout(() => {
        editorRef?.current?.chain().focus();
      }, 250);
    },
    [onEditMessage]
  );

  const onEdit = useCallback((message) => {
    setOnEditMessage(message);
    setReplyMessage(null);
    setIsFocusedParent(true);
    setTimeout(() => {
      editorRef.current
        ?.chain()
        .focus()
        .setContent(message?.messageText || message?.text || '<p></p>')
        .run();
    }, 250);
  }, []);

  const handleReaction = useCallback(
    async (reaction, chatMessage, reactionState = true) => {
      try {
        if (isSending) return;
        if (+balance < MIN_REQUIRED_QORTS)
          throw new Error(
            t('group:message.error.qortals_required', {
              quantity: MIN_REQUIRED_QORTS,
              postProcess: 'capitalizeFirstChar',
            })
          );

        pauseAllQueues();
        setIsSending(true);

        const message = '';
        const secretKeyObject = await getSecretKey(false, true);
        const otherData = {
          specialId: uid.rnd(),
          type: 'reaction',
          content: reaction,
          contentState: reactionState,
        };
        const objectMessage = {
          message,
          ...(otherData || {}),
        };
        const message64: any = await objectToBase64(objectMessage);
        const reactiontypeNumber = RESOURCE_TYPE_NUMBER_GROUP_CHAT_REACTIONS;
        const encryptSingle =
          isPrivate === false
            ? JSON.stringify(objectMessage)
            : await encryptChatMessage(
                message64,
                secretKeyObject,
                reactiontypeNumber
              );
        const sendMessageFunc = async () => {
          return await sendChatGroup({
            groupId: selectedGroup,
            messageText: encryptSingle,
            chatReference: chatMessage.signature,
          });
        };

        // Add the function to the queue
        const messageObj = {
          message: {
            text: message,
            timestamp: Date.now(),
            senderName: myName,
            sender: myAddress,
            ...(otherData || {}),
          },
          chatReference: chatMessage.signature,
        };
        addToQueue(sendMessageFunc, messageObj, 'chat-reaction', selectedGroup);
        // send chat message
      } catch (error) {
        const errorMsg = error?.message || error;
        setInfoSnack({
          type: 'error',
          message: errorMsg,
        });
        setOpenSnack(true);
        console.error(error);
      } finally {
        setIsSending(false);
        resumeAllQueues();
      }
    },
    [isPrivate]
  );

  const openQManager = useCallback(() => {
    setIsOpenQManager(true);
  }, []);

  const insertImage = useCallback(
    (img) => {
      if (
        chatImagesToSave?.length > 0 ||
        (messageHasImage(onEditMessage) && !isDeleteImage)
      ) {
        setInfoSnack({
          type: 'error',
          message: t('core:message.generic.message_with_image', {
            postProcess: 'capitalizeFirstChar',
          }),
        });
        setOpenSnack(true);
        return;
      }
      setChatImagesToSave((prev) => [...prev, img]);
    },
    [chatImagesToSave, onEditMessage?.images, isDeleteImage]
  );

  return (
    <div
      style={{
        display: 'flex',
        flex: hide ? undefined : 1,
        flexDirection: 'column',
        height: hide ? undefined : '100%',
        left: hide && '-100000px',
        minHeight: hide ? undefined : 0,
        opacity: hide ? 0 : 1,
        padding: '10px',
        position: hide ? 'absolute' : 'relative',
        width: '100%',
      }}
    >
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden', width: '100%' }}>
        <ChatList
          chatId={selectedGroup}
          chatReferences={chatReferences}
          enableMentions
          handleReaction={handleReaction}
          hasSecretKey={!!secretKey}
          initialMessages={messages}
          isPrivate={isPrivate}
          members={members}
          myAddress={myAddress}
          myName={myName}
          onEdit={onEdit}
          onReply={onReply}
          openQManager={openQManager}
          selectedGroup={selectedGroup}
          tempChatReferences={tempChatReferences}
          tempMessages={tempMessages}
          chatOptionsHideTriggers={isMobile}
        />
      </Box>

      {(!!secretKey || isPrivate === false) && (
        <Box
          sx={{
            alignItems: isMobile ? 'stretch' : 'flex-end',
            backgroundColor: theme.palette.background.default,
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: '8px',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            flexShrink: 0,
            gap: isMobile ? '8px' : '12px',
            maxHeight: isFocusedParent && isMobile ? 'min(40vh, 280px)' : undefined,
            minHeight: isMobile ? 0 : '150px',
            overflow: 'hidden',
            padding: isMobile ? '10px' : '16px 20px 20px',
            paddingBottom: isMobile
              ? 'max(10px, env(safe-area-inset-bottom, 0px))'
              : undefined,
            position: 'relative',
            width: '100%',
            // In landscape the full-width composer wastes the space to its
            // left; float it as a compact card at the bottom-right so the
            // message list fills the whole area behind it.
            ...(composerFabMode
              ? {
                  position: 'absolute',
                  right: 8,
                  bottom: 8,
                  left: 'auto',
                  width: 'min(480px, calc(100% - 16px))',
                  maxWidth: 480,
                  zIndex: 6,
                  boxShadow:
                    theme.palette.mode === 'dark'
                      ? '0 10px 28px rgba(0,0,0,0.55)'
                      : '0 10px 28px rgba(15,20,30,0.22)',
                  transformOrigin: 'bottom right',
                  transition:
                    'transform 260ms cubic-bezier(0.2, 0, 0, 1), opacity 200ms ease',
                  transform: composerOpenLandscape
                    ? 'translateY(0) scale(1)'
                    : 'translateY(12px) scale(0.3)',
                  opacity: composerOpenLandscape ? 1 : 0,
                  pointerEvents: composerOpenLandscape ? 'auto' : 'none',
                }
              : {}),
          }}
        >
          <Box
            sx={{
              display: 'flex',
              flex: 1,
              flexDirection: 'column',
              flexShrink: 0,
              justifyContent: 'flex-end',
              minWidth: 0,
              overflow: 'auto',
            }}
          >
            <Box
              sx={{
                alignItems: 'flex-start',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '10px',
                width: '100%',
              }}
            >
              {!isDeleteImage &&
                onEditMessage &&
                messageHasImage(onEditMessage) &&
                onEditMessage?.images?.map((_, index) => (
                  <div
                    key={index}
                    style={{
                      height: '50px',
                      position: 'relative',
                      width: '50px',
                    }}
                  >
                    <ImageIcon
                      color="primary"
                      sx={{
                        borderRadius: '3px',
                        height: '100%',
                        width: '100%',
                      }}
                    />

                    <Tooltip title="Delete image">
                      <IconButton
                        onClick={() => setIsDeleteImage(true)}
                        size="small"
                        sx={{
                          position: 'absolute',
                          top: '50%',
                          left: '50%',
                          transform: 'translate(-50%, -50%)',
                          backgroundColor: (theme) =>
                            theme.palette.background.paper,
                          color: (theme) => theme.palette.text.primary,
                          borderRadius: '50%',
                          opacity: 0,
                          transition: 'opacity 0.2s',
                          boxShadow: (theme) => theme.shadows[2],
                          '&:hover': {
                            backgroundColor: (theme) =>
                              theme.palette.background.default,
                            opacity: 1,
                          },
                          pointerEvents: 'auto',
                        }}
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </div>
                ))}

              {chatImagesToSave.map((imgBase64, index) => (
                <div
                  key={index}
                  style={{
                    height: '50px',
                    position: 'relative',
                    width: '50px',
                  }}
                >
                  <img
                    src={`data:image/webp;base64,${imgBase64}`}
                    style={{
                      height: '100%',
                      width: '100%',
                      objectFit: 'contain',
                      borderRadius: '3px',
                    }}
                  />

                  <Tooltip title="Remove image">
                    <IconButton
                      onClick={() =>
                        setChatImagesToSave((prev) =>
                          prev.filter((_, i) => i !== index)
                        )
                      }
                      size="small"
                      sx={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        backgroundColor: (theme) =>
                          theme.palette.background.paper,
                        color: (theme) => theme.palette.text.primary,
                        borderRadius: '50%',
                        opacity: 0,
                        transition: 'opacity 0.2s',
                        boxShadow: (theme) => theme.shadows[2],
                        '&:hover': {
                          backgroundColor: (theme) =>
                            theme.palette.background.default,
                          opacity: 1,
                        },
                        pointerEvents: 'auto',
                      }}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </div>
              ))}
            </Box>

            {replyMessage && (
              <Box
                sx={{
                  alignItems: 'flex-start',
                  display: 'flex',
                  gap: '5px',
                  width: '100%',
                }}
              >
                <ReplyPreview message={replyMessage} />

                <ButtonBase
                  onClick={() => {
                    setReplyMessage(null);

                    setOnEditMessage(null);
                    setIsDeleteImage(false);
                    setChatImagesToSave([]);
                  }}
                >
                  <ExitIcon />
                </ButtonBase>
              </Box>
            )}

            {onEditMessage && (
              <Box
                sx={{
                  alignItems: 'flex-start',
                  display: 'flex',
                  gap: '5px',
                  width: '100%',
                }}
              >
                <ReplyPreview isEdit message={onEditMessage} />

                <ButtonBase
                  onClick={() => {
                    setReplyMessage(null);
                    setOnEditMessage(null);
                    setIsDeleteImage(false);
                    setChatImagesToSave([]);
                    clearEditorContent();
                  }}
                >
                  <ExitIcon />
                </ButtonBase>
              </Box>
            )}

            <Box
              className={isMobile ? 'mobile-chat-compose-row' : undefined}
              sx={{
                alignItems: 'flex-end',
                display: 'flex',
                gap: '6px',
                width: '100%',
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
            <Tiptap
              enableMentions
              setEditorRef={setEditorRef}
              onEnter={sendMessage}
              isChat
              disableEnter={isMobile}
              isFocusedParent={isFocusedParent}
              isReply={Boolean(replyMessage || onEditMessage)}
              setIsFocusedParent={setIsFocusedParent}
              membersWithNames={members}
              insertImage={insertImage}
            />
              </Box>
              {isMobile && isFocusedParent && (
                <>
                  <IconButton
                    aria-label={t('core:action.close', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                    disabled={isSending}
                    onClick={() => {
                      // Discard whatever was typed when dismissing the composer.
                      clearEditorContent();
                      setReplyMessage(null);
                      setOnEditMessage(null);
                      if (composerFabMode) {
                        closeLandscapeComposer();
                        return;
                      }
                      setIsFocusedParent(false);
                      editorRef.current?.commands.blur();
                    }}
                    sx={{
                      border: `1px solid ${theme.palette.divider}`,
                      flexShrink: 0,
                      height: 44,
                      width: 44,
                    }}
                  >
                    <CloseRoundedIcon sx={{ fontSize: 22 }} />
                  </IconButton>
                  <IconButton
                    aria-label={t('core:action.send', {
                      postProcess: 'capitalizeFirstChar',
                    })}
                    disabled={isSending || messageSize > MAX_SIZE_MESSAGE}
                    onClick={() => {
                      if (isSending || messageSize > MAX_SIZE_MESSAGE) return;
                      sendMessage();
                    }}
                    sx={{
                      bgcolor: theme.palette.primary.main,
                      color: theme.palette.primary.contrastText,
                      flexShrink: 0,
                      height: 44,
                      width: 44,
                      '&:hover': {
                        bgcolor: theme.palette.primary.dark,
                      },
                      '&.Mui-disabled': {
                        bgcolor: theme.palette.action.disabledBackground,
                        color: theme.palette.action.disabled,
                      },
                    }}
                  >
                    {isSending ? (
                      <CircularProgress size={20} sx={{ color: 'inherit' }} />
                    ) : (
                      <SendIcon sx={{ fontSize: 22 }} />
                    )}
                  </IconButton>
                </>
              )}
            </Box>
            {messageSize > MESSAGE_LIMIT_WARNING && (
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'flex-start',
                  position: 'relative',
                  width: '100%',
                }}
              >
                <Typography
                  sx={{
                    fontSize: '12px',
                    color:
                      messageSize > MAX_SIZE_MESSAGE
                        ? theme.palette.other.danger
                        : 'unset',
                  }}
                >
                  {t('core:message.error.message_size', {
                    maximum: MAX_SIZE_MESSAGE,
                    size: messageSize,
                    postProcess: 'capitalizeFirstChar',
                  })}
                </Typography>
              </Box>
            )}
          </Box>

          {!isMobile && (
          <Box
            sx={{
              flexShrink: 0,
              paddingBottom: '2px',
            }}
          >
            <Box
              sx={{
                alignItems: 'center',
                display: 'flex',
                gap: '8px',
                justifyContent: 'flex-start',
              }}
            >
            <CustomButton
              onClick={() => {
                if (isSending) return;
                sendMessage();
              }}
              sx={{
                alignItems: 'center',
                backgroundColor: isSending
                  ? theme.palette.action.disabledBackground
                  : theme.palette.background.paper,
                border: '1px solid',
                borderColor: theme.palette.divider,
                borderRadius: '8px',
                color: theme.palette.text.primary,
                cursor: isSending ? 'default' : 'pointer',
                display: 'inline-flex',
                gap: '6px',
                fontSize: '14px',
                fontWeight: 500,
                justifyContent: 'center',
                minHeight: '44px',
                minWidth: '88px',
                padding: '10px 16px',
                position: 'relative',
                transition:
                  'background-color 0.2s ease, border-color 0.2s ease',
                '&:hover': isSending
                  ? {}
                  : {
                      backgroundColor: theme.palette.action.hover,
                      borderColor: theme.palette.divider,
                    },
              }}
            >
              {isSending ? (
                <CircularProgress
                  size={18}
                  sx={{ color: theme.palette.text.secondary }}
                />
              ) : (
                <>
                  <SendIcon sx={{ fontSize: '18px' }} />
                  Send
                </>
              )}
            </CustomButton>
            </Box>
          </Box>
          )}
        </Box>
      )}

      {composerFabMode &&
        !composerOpenLandscape &&
        (!!secretKey || isPrivate === false) && (
          <Tooltip
            title={t('core:action.send_message', {
              postProcess: 'capitalizeFirstChar',
              defaultValue: 'Write a message',
            })}
          >
            <IconButton
              aria-label="Write a message"
              onClick={openLandscapeComposer}
              sx={{
                position: 'absolute',
                right: 14,
                bottom: 14,
                zIndex: 6,
                width: 52,
                height: 52,
                backgroundColor: theme.palette.primary.main,
                color: theme.palette.primary.contrastText,
                boxShadow:
                  theme.palette.mode === 'dark'
                    ? '0 8px 22px rgba(0,0,0,0.55)'
                    : '0 8px 22px rgba(15,20,30,0.30)',
                '@keyframes composerFabIn': {
                  from: { transform: 'scale(0.4)', opacity: 0 },
                  to: { transform: 'scale(1)', opacity: 1 },
                },
                animation: 'composerFabIn 220ms cubic-bezier(0.2, 0, 0, 1)',
                '&:hover': {
                  backgroundColor: theme.palette.primary.dark,
                },
              }}
            >
              <CreateRoundedIcon sx={{ fontSize: 24 }} />
            </IconButton>
          </Tooltip>
        )}

      {(isResizingQManager || isOpenQManager !== null) && (
        <Portal>
          {isResizingQManager && (
            <Box
              aria-hidden
              sx={{
                backgroundColor: 'transparent',
                inset: 0,
                pointerEvents: 'auto',
                position: 'fixed',
                zIndex: 1399,
              }}
            />
          )}

          {isOpenQManager !== null && (
            <Rnd
              position={isMobile ? { x: 0, y: 0 } : qManagerPosition}
              size={
                isMobile
                  ? { width: windowSize.width, height: windowSize.height }
                  : qManagerSize
              }
              minWidth={isMobile ? 0 : Q_MANAGER_MIN_WIDTH}
              minHeight={isMobile ? 0 : Q_MANAGER_MIN_HEIGHT}
              maxWidth={isMobile ? windowSize.width : maxQManagerWidth}
              maxHeight={isMobile ? windowSize.height : maxQManagerHeight}
              bounds="window"
              disableDragging
              enableResizing={
                !isMobile && isOpenQManager === true && !hideView
                  ? {
                      top: true,
                      left: true,
                      topLeft: true,
                      topRight: false,
                      right: false,
                      bottom: false,
                      bottomLeft: false,
                      bottomRight: false,
                    }
                  : false
              }
              resizeHandleStyles={{
                top: { height: 24, top: -12, zIndex: 25, cursor: 'ns-resize' },
                left: { width: 24, left: -12, zIndex: 25, cursor: 'ew-resize' },
                topLeft: {
                  width: 28,
                  height: 28,
                  left: -14,
                  top: -14,
                  zIndex: 25,
                  cursor: 'nwse-resize',
                },
              }}
              resizeHandleWrapperStyle={{ pointerEvents: 'auto' }}
              onResizeStart={handleQManagerResizeStart}
              onResize={handleQManagerResize}
              onResizeStop={handleQManagerResizeStop}
              style={{
                display: hideView || isOpenQManager !== true ? 'none' : 'block',
                position: 'fixed',
                zIndex: 1400,
              }}
            >
              <Box
                sx={{
                  backgroundColor: theme.palette.background.surface,
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                  maxWidth: '100vw',
                  overflow: 'hidden',
                  position: 'relative',
                  width: '100%',
                  ...(isMobile
                    ? {
                        // Full-screen on mobile: square edges, keep the
                        // header clear of the status bar / cutout.
                        paddingTop: SAFE_AREA_TOP,
                        paddingBottom: SAFE_AREA_BOTTOM,
                      }
                    : {
                        border: `1px solid ${alpha(theme.palette.divider, 0.82)}`,
                        borderBottom: 'none',
                        borderRadius: '8px 8px 0 0',
                        boxShadow:
                          theme.palette.mode === 'dark'
                            ? `0 -18px 46px ${alpha(theme.palette.common.black, 0.46)}, 0 -1px 0 ${alpha(theme.palette.common.white, 0.05)}`
                            : `0 -14px 36px ${alpha(theme.palette.common.black, 0.16)}, 0 -1px 0 ${alpha(theme.palette.common.white, 0.72)}`,
                        maxHeight: `calc(100dvh - ${appHeighOffsetPx})`,
                        minHeight: Q_MANAGER_MIN_HEIGHT,
                        minWidth: Q_MANAGER_MIN_WIDTH,
                      }),
                }}
              >
                <Box
                  sx={{
                    alignItems: 'center',
                    backgroundColor:
                      theme.palette.mode === 'dark'
                        ? alpha(theme.palette.background.default, 0.58)
                        : alpha(theme.palette.background.paper, 0.72),
                    borderBottom: `1px solid ${alpha(theme.palette.divider, 0.72)}`,
                    display: 'flex',
                    flex: `0 0 ${Q_MANAGER_HEADER_HEIGHT}px`,
                    gap: 1,
                    height: `${Q_MANAGER_HEADER_HEIGHT}px`,
                    justifyContent: 'space-between',
                    padding: '0 8px 0 12px',
                  }}
                >
                  <Box
                    sx={{
                      alignItems: 'center',
                      display: 'flex',
                      gap: 1,
                      minWidth: 0,
                    }}
                  >
                    <Box
                      aria-hidden
                      sx={{
                        backgroundColor: theme.palette.primary.main,
                        borderRadius: '999px',
                        boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.16)}`,
                        flexShrink: 0,
                        height: 8,
                        width: 8,
                      }}
                    />
                    <Typography
                      noWrap
                      sx={{
                        color: theme.palette.text.primary,
                        fontFamily: 'Inter',
                        fontSize: '14px',
                        fontWeight: 700,
                      }}
                    >
                      Q-Manager
                    </Typography>
                  </Box>

                  <ButtonBase
                    onClick={() => {
                      setIsOpenQManager(false);
                    }}
                    sx={{
                      alignItems: 'center',
                      borderRadius: '8px',
                      color: theme.palette.text.secondary,
                      display: 'inline-flex',
                      height: 30,
                      justifyContent: 'center',
                      transition:
                        'background-color 0.18s ease, color 0.18s ease',
                      width: 30,
                      '&:hover': {
                        backgroundColor: alpha(
                          theme.palette.text.primary,
                          0.08
                        ),
                        color: theme.palette.text.primary,
                      },
                    }}
                  >
                    <CloseIcon
                      sx={{
                        color: 'currentColor',
                        fontSize: 20,
                      }}
                    />
                  </ButtonBase>
                </Box>

                <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                  <AppViewerContainer
                    customHeight="100%"
                    app={{
                      name: 'Q-Manager',
                      path: `?groupId=${selectedGroup}`,
                      service: 'APP',
                      tabId: '5558588',
                    }}
                    isSelected
                    ref={iframeRef}
                  />
                </Box>
              </Box>
            </Rnd>
          )}
        </Portal>
      )}

      <LoadingSnackbar
        open={isLoading}
        info={{
          message: t('core:loading.chat', {
            postProcess: 'capitalizeFirstChar',
          }),
        }}
      />

      <CustomizedSnackbars
        open={openSnack}
        setOpen={setOpenSnack}
        info={infoSnack}
        setInfo={setInfoSnack}
      />
    </div>
  );
};
