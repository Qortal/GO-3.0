import {
  Avatar,
  Box,
  ButtonBase,
  InputBase,
  MenuItem,
  Select,
  Typography,
  Tooltip,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSetAtom } from 'jotai';
import SearchIcon from '@mui/icons-material/Search';
import { Spacer } from '../../common/Spacer';
import AlternateEmailIcon from '@mui/icons-material/AlternateEmail';
import CloseIcon from '@mui/icons-material/Close';
import InsertLinkIcon from '@mui/icons-material/InsertLink';
import Highlight from '@tiptap/extension-highlight';
import Mention from '@tiptap/extension-mention';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import {
  AppsSearchContainer,
  AppsSearchLeft,
  AppsSearchRight,
} from '../Apps/Apps-styles';
import IconClearInput from '../../assets/svgs/ClearInput.svg';
import { getBaseApiReact } from '../../App';
import { MessageDisplay } from './MessageDisplay';
import { useVirtualizer } from '@tanstack/react-virtual';
import { formatTimestamp } from '../../utils/time';
import { ContextMenuMentions } from '../ContextMenuMentions';
import { convert } from 'html-to-text';
import { generateHTML } from '@tiptap/react';
import ErrorBoundary from '../../common/ErrorBoundary';
import { useTranslation } from 'react-i18next';
import { isHtmlString } from '../../utils/chat';
import TextStyle from '@tiptap/extension-text-style';
import { subscribeToEvent, unsubscribeFromEvent } from '../../utils/events';
import { chatMentionUnreadAtom } from '../../atoms/global';

/** Event names used by the mobile chat header to drive these options remotely
 *  (the trigger buttons live in the header; the panels render here). */
export const CHAT_OPTION_SEARCH_EVENT = 'open-chat-search';
export const CHAT_OPTION_MENTIONS_EVENT = 'open-chat-mentions';
export const CHAT_OPTION_QMANAGER_EVENT = 'open-chat-qmanager';

const extractTextFromHTML = (htmlString = '') => {
  return convert(htmlString, {
    wordwrap: false, // Disable word wrapping
  })?.toLowerCase();
};

export const ChatOptions = ({
  messages: untransformedMessages,
  goToMessage,
  members,
  myName,
  selectedGroup,
  openQManager,
  isPrivate,
  hideTriggers = false,
}) => {
  const [mode, setMode] = useState('default');
  const [searchValue, setSearchValue] = useState('');
  const [selectedMember, setSelectedMember] = useState(0);
  const setMentionUnread = useSetAtom(chatMentionUnreadAtom);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { t } = useTranslation([
    'auth',
    'core',
    'group',
    'question',
    'tutorial',
  ]);
  const parentRef = useRef(null);
  const parentRefMentions = useRef(null);
  const [lastMentionTimestamp, setLastMentionTimestamp] = useState(null);
  const [debouncedValue, setDebouncedValue] = useState(''); // Debounced value

  const messages = useMemo(() => {
    return untransformedMessages?.map((item) => {
      if (item?.messageText) {
        let transformedMessage = item?.messageText;
        const isHtml = isHtmlString(item?.messageText);
        try {
          transformedMessage = isHtml
            ? item?.messageText
            : generateHTML(item?.messageText, [
                StarterKit,
                Underline,
                Highlight,
                Mention,
                TextStyle,
              ]);
          return {
            ...item,
            messageText: transformedMessage,
          };
        } catch (error) {
          console.log(error);
        }
      } else return item;
    });
  }, [untransformedMessages]);

  const getTimestampMention = async () => {
    try {
      return new Promise((res, rej) => {
        window
          .sendMessage('getTimestampMention')
          .then((response) => {
            if (!response?.error) {
              if (response && selectedGroup && response[selectedGroup]) {
                setLastMentionTimestamp(response[selectedGroup]);
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
    if (mode === 'mentions' && selectedGroup) {
      window
        .sendMessage('addTimestampMention', {
          timestamp: Date.now(),
          groupId: selectedGroup,
        })
        .then((res) => {
          getTimestampMention();
        })
        .catch((error) => {
          console.error(
            'Failed to add timestamp:',
            error.message || 'An error occurred'
          );
        });
    }
  }, [mode, selectedGroup]);

  useEffect(() => {
    getTimestampMention();
  }, []);

  // Debounce logic
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(searchValue);
    }, 350);

    // Cleanup timeout if searchValue changes before the timeout completes
    return () => {
      clearTimeout(handler);
    };
  }, [searchValue]); // Runs effect when searchValue changes

  const searchedList = useMemo(() => {
    if (!debouncedValue?.trim()) {
      if (selectedMember) {
        return messages
          .filter((message) => message?.senderName === selectedMember)
          ?.sort((a, b) => b?.timestamp - a?.timestamp);
      }
      return [];
    }

    if (selectedMember) {
      return messages
        .filter(
          (message) =>
            message?.senderName === selectedMember &&
            extractTextFromHTML(
              isPrivate ? message?.messageText : message?.decryptedData?.message
            )?.includes(debouncedValue.toLowerCase())
        )
        ?.sort((a, b) => b?.timestamp - a?.timestamp);
    }

    return messages
      .filter((message) =>
        extractTextFromHTML(
          isPrivate === false
            ? message?.messageText
            : message?.decryptedData?.message
        )?.includes(debouncedValue.toLowerCase())
      )
      ?.sort((a, b) => b?.timestamp - a?.timestamp);
  }, [debouncedValue, messages, selectedMember, isPrivate]);

  const mentionList = useMemo(() => {
    if (!messages || messages.length === 0 || !myName) return [];
    if (isPrivate === false) {
      return messages
        .filter((message) =>
          extractTextFromHTML(message?.messageText)?.includes(
            `@${myName?.toLowerCase()}`
          )
        )
        ?.sort((a, b) => b?.timestamp - a?.timestamp);
    }

    return messages
      .filter((message) =>
        extractTextFromHTML(message?.decryptedData?.message)?.includes(
          `@${myName?.toLowerCase()}`
        )
      )
      ?.sort((a, b) => b?.timestamp - a?.timestamp);
  }, [messages, myName, isPrivate]);

  // Triggers may live in the mobile chat header instead of the floating strip;
  // listen for their events and open the matching panel.
  useEffect(() => {
    const openSearch = () => {
      setSearchValue('');
      setSelectedMember(0);
      setMode('search');
    };
    const openMentions = () => {
      setSearchValue('');
      setSelectedMember(0);
      setMode('mentions');
    };
    const openQManagerEvent = () => {
      setMode('default');
      setSearchValue('');
      setSelectedMember(0);
      openQManager?.();
    };
    subscribeToEvent(CHAT_OPTION_SEARCH_EVENT, openSearch);
    subscribeToEvent(CHAT_OPTION_MENTIONS_EVENT, openMentions);
    subscribeToEvent(CHAT_OPTION_QMANAGER_EVENT, openQManagerEvent);
    return () => {
      unsubscribeFromEvent(CHAT_OPTION_SEARCH_EVENT, openSearch);
      unsubscribeFromEvent(CHAT_OPTION_MENTIONS_EVENT, openMentions);
      unsubscribeFromEvent(CHAT_OPTION_QMANAGER_EVENT, openQManagerEvent);
    };
  }, [openQManager]);

  // Publish whether there are unread @mentions so the header trigger can show
  // the unread accent even when the floating strip is hidden.
  const hasUnreadMentions =
    mentionList?.length > 0 &&
    (!lastMentionTimestamp || lastMentionTimestamp < mentionList[0]?.timestamp);
  useEffect(() => {
    setMentionUnread(hasUnreadMentions);
    return () => setMentionUnread(false);
  }, [hasUnreadMentions, setMentionUnread]);

  const rowVirtualizer = useVirtualizer({
    count: searchedList.length,
    getItemKey: useCallback(
      (index) => searchedList[index].signature,
      [searchedList]
    ),
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80, // Provide an estimated height of items, adjust this as needed
    overscan: 10, // Number of items to render outside the visible area to improve smoothness
  });

  const rowVirtualizerMentions = useVirtualizer({
    count: mentionList.length,
    getItemKey: useCallback(
      (index) => mentionList[index].signature,
      [mentionList]
    ),
    getScrollElement: () => parentRefMentions.current,
    estimateSize: () => 80, // Provide an estimated height of items, adjust this as needed
    overscan: 10, // Number of items to render outside the visible area to improve smoothness
  });

  if (mode === 'mentions') {
    return (
      <Box
        sx={{
          backgroundColor: theme.palette.background.default,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'auto',
          ...(isMobile
            ? {
                bottom: 0,
                height: '100%',
                left: 0,
                position: 'absolute',
                right: 0,
                top: 0,
                width: '100%',
                zIndex: 8,
              }
            : {
                borderBottomLeftRadius: '20px',
                borderTopLeftRadius: '20px',
                flexGrow: 0,
                flexShrink: 0,
                height: '100%',
                width: '300px',
              }),
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'space-between',
            padding: isMobile ? '12px 16px' : '10px',
          }}
        >
          {isMobile ? (
            <Typography
              sx={{
                color: theme.palette.text.primary,
                fontSize: '1rem',
                fontWeight: 700,
              }}
            >
              {t('core:message.generic.mentioned', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          ) : (
            <Box />
          )}

          <ButtonBase
            onClick={() => {
              setMode('default');
            }}
            sx={{
              borderRadius: '50%',
              padding: isMobile ? '6px' : 0,
            }}
          >
            <CloseIcon
              sx={{
                color: theme.palette.text.primary,
              }}
            />
          </ButtonBase>
        </Box>

        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            width: '100%',
          }}
        >
          {mentionList?.length === 0 && (
            <Typography
              sx={{
                fontSize: '14px',
                fontWeight: 400,
                color: theme.palette.text.primary,
              }}
            >
              {t('core:message.generic.no_results', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          )}

          <Box
            sx={{
              display: 'flex',
              height: '100%',
              width: '100%',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                position: 'relative',
                width: '100%',
              }}
            >
              <div
                ref={parentRefMentions}
                className="List"
                style={{
                  display: 'flex',
                  flexGrow: 1,
                  height: '0px',
                  overflow: 'auto',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    height: rowVirtualizerMentions.getTotalSize(),
                    width: '100%',
                  }}
                >
                  <div
                    style={{
                      left: 0,
                      position: 'absolute',
                      top: 0,
                      width: '100%',
                    }}
                  >
                    {rowVirtualizerMentions
                      .getVirtualItems()
                      .map((virtualRow) => {
                        const index = virtualRow.index;
                        let message = mentionList[index];
                        return (
                          <div
                            data-index={virtualRow.index} //needed for dynamic row height measurement
                            ref={rowVirtualizerMentions.measureElement} //measure dynamic row height
                            key={message.signature}
                            style={{
                              alignItems: 'center',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '5px',
                              left: '50%', // Move to the center horizontally
                              overscrollBehavior: 'none',
                              padding: '10px 0',
                              position: 'absolute',
                              top: 0,
                              transform: `translateY(${virtualRow.start}px) translateX(-50%)`, // Adjust for centering
                              width: '100%', // Control width (90% of the parent)
                            }}
                          >
                            <ShowMessage
                              messages={messages}
                              goToMessage={goToMessage}
                              message={message}
                              onSelect={() => setMode('default')}
                            />
                          </div>
                        );
                      })}
                  </div>
                </div>
              </div>
            </div>
          </Box>
        </Box>
      </Box>
    );
  }

  if (mode === 'search') {
    return (
      <Box
        sx={{
          backgroundColor: theme.palette.background.paper,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'auto',
          ...(isMobile
            ? {
                bottom: 0,
                height: '100%',
                left: 0,
                position: 'absolute',
                right: 0,
                top: 0,
                width: '100%',
                zIndex: 8,
              }
            : {
                borderBottomLeftRadius: '20px',
                borderTopLeftRadius: '20px',
                flexGrow: 0,
                flexShrink: 0,
                height: '98%',
                width: '300px',
              }),
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            justifyContent: 'space-between',
            padding: isMobile ? '12px 16px' : '10px',
          }}
        >
          {isMobile ? (
            <Typography
              sx={{
                color: theme.palette.text.primary,
                fontSize: '1rem',
                fontWeight: 700,
              }}
            >
              {t('core:action.search_chat_text', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          ) : (
            <Box />
          )}

          <ButtonBase
            onClick={() => {
              setMode('default');
            }}
            sx={{
              borderRadius: '50%',
              padding: isMobile ? '6px' : 0,
            }}
          >
            <CloseIcon
              sx={{
                color: theme.palette.text.primary,
              }}
            />
          </ButtonBase>
        </Box>

        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            width: '100%',
          }}
        >
          <AppsSearchContainer>
            <AppsSearchLeft>
              <SearchIcon
                sx={{
                  color: theme.palette.text.primary,
                }}
              />
              <InputBase
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                sx={{ ml: 1, flex: 1 }}
                placeholder={t('core:action.search_chat_text', {
                  postProcess: 'capitalizeFirstChar',
                })}
                inputProps={{
                  'aria-label': t('core:action.search_apps', {
                    postProcess: 'capitalizeFirstChar',
                  }),
                  fontSize: '16px',
                  fontWeight: 400,
                }}
              />
            </AppsSearchLeft>

            <AppsSearchRight>
              {searchValue && (
                <ButtonBase
                  onClick={() => {
                    setSearchValue('');
                  }}
                >
                  <img src={IconClearInput} />
                </ButtonBase>
              )}
            </AppsSearchRight>
          </AppsSearchContainer>

          <Box
            sx={{
              alignItems: 'center',
              display: 'flex',
              gap: '8px',
              justifyContent: 'space-between',
              padding: '10px',
              width: isMobile ? '90%' : undefined,
            }}
          >
            <Select
              id="demo-simple-select"
              label={t('core:sort.by_member', {
                postProcess: 'capitalizeFirstChar',
              })}
              labelId="demo-simple-select-label"
              onChange={(e) => setSelectedMember(e.target.value)}
              size="small"
              value={selectedMember}
              sx={isMobile ? { flex: 1 } : undefined}
            >
              <MenuItem value={0}>
                <em>
                  {t('core:sort.by_member', {
                    postProcess: 'capitalizeFirstChar',
                  })}
                </em>
              </MenuItem>

              {members?.map((member) => {
                return (
                  <MenuItem key={member} value={member}>
                    {member}
                  </MenuItem>
                );
              })}
            </Select>

            {!!selectedMember && (
              <CloseIcon
                onClick={() => {
                  setSelectedMember(0);
                }}
                sx={{
                  cursor: 'pointer',
                  color: theme.palette.text.primary,
                }}
              />
            )}
          </Box>

          {debouncedValue && searchedList?.length === 0 && (
            <Typography
              sx={{
                fontSize: '11px',
                fontWeight: 400,
                color: theme.palette.text.secondary,
              }}
            >
              {t('core:message.generic.no_results', {
                postProcess: 'capitalizeFirstChar',
              })}
            </Typography>
          )}

          <Box
            sx={{
              display: 'flex',
              height: '100%',
              width: '100%',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                position: 'relative',
                width: '100%',
              }}
            >
              <div
                ref={parentRef}
                className="List"
                style={{
                  display: 'flex',
                  flexGrow: 1,
                  height: '0px',
                  overflow: 'auto',
                  position: 'relative',
                }}
              >
                <div
                  style={{
                    height: rowVirtualizer.getTotalSize(),
                    width: '100%',
                  }}
                >
                  <div
                    style={{
                      left: 0,
                      position: 'absolute',
                      top: 0,
                      width: '100%',
                    }}
                  >
                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                      const index = virtualRow.index;
                      let message = searchedList[index];
                      return (
                        <div
                          data-index={virtualRow.index} //needed for dynamic row height measurement
                          ref={rowVirtualizer.measureElement} //measure dynamic row height
                          key={message.signature}
                          style={{
                            alignItems: 'center',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '5px',
                            left: '50%', // Move to the center horizontally
                            overscrollBehavior: 'none',
                            padding: '10px 0',
                            position: 'absolute',
                            top: 0,
                            transform: `translateY(${virtualRow.start}px) translateX(-50%)`, // Adjust for centering
                            width: '100%', // Control width (90% of the parent)
                          }}
                        >
                          <ErrorBoundary
                            fallback={
                              <Typography>
                                {t('group:message.generic.invalid_data', {
                                  postProcess: 'capitalizeFirstChar',
                                })}
                              </Typography>
                            }
                          >
                            <ShowMessage
                              message={message}
                              goToMessage={goToMessage}
                              messages={messages}
                              onSelect={() => setMode('default')}
                            />
                          </ErrorBoundary>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </Box>
        </Box>
      </Box>
    );
  }

  if (hideTriggers) {
    // Triggers are rendered elsewhere (mobile chat header); only the panels
    // (search/mentions) above are owned by this component.
    return null;
  }

  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        ...(isMobile
          ? {
              // Floating overlay strip: the message list keeps its full width.
              flexDirection: 'row',
              position: 'absolute',
              right: 0,
              top: 0,
              width: 'auto',
              zIndex: 5,
            }
          : {
              flexDirection: 'column',
              gap: '20px',
              height: '100%',
              width: '50px',
            }),
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          width: '100%',
          ...(isMobile
            ? {
                backdropFilter: 'blur(10px)',
                backgroundColor: alpha(theme.palette.background.paper, 0.72),
                border: `1px solid ${alpha(theme.palette.text.primary, 0.08)}`,
                borderTop: 'none',
                borderRight: 'none',
                borderBottomLeftRadius: '18px',
                boxShadow: '0 6px 18px rgba(0,0,0,0.28)',
                flexDirection: 'row',
                gap: '22px',
                padding: '9px 14px',
                WebkitBackdropFilter: 'blur(10px)',
              }
            : {
                backgroundColor: theme.palette.background.paper,
                borderBottomLeftRadius: '20px',
                borderTopLeftRadius: '20px',
                flexDirection: 'column',
                gap: '20px',
                minHeight: '200px',
                padding: '10px',
              }),
        }}
      >
        <ButtonBase
          onClick={() => {
            setMode('search');
          }}
        >
          <Tooltip
            title={
              <span
                style={{
                  color: theme.palette.text.primary,
                  fontSize: '14px',
                  fontWeight: 700,
                }}
              >
                {t('core:action.search', { postProcess: 'capitalizeAll' })}
              </span>
            }
            placement="left"
            arrow
            sx={{ fontSize: '24' }}
            slotProps={{
              tooltip: {
                sx: {
                  color: theme.palette.text.primary,
                  backgroundColor: theme.palette.background.default,
                },
              },
              arrow: {
                sx: {
                  color: theme.palette.text.secondary,
                },
              },
            }}
          >
            <SearchIcon />
          </Tooltip>
        </ButtonBase>

        <ButtonBase
          onClick={() => {
            setMode('default');
            setSearchValue('');
            setSelectedMember(0);
            openQManager();
          }}
        >
          <Tooltip
            title={
              <span
                style={{
                  color: theme.palette.text.primary,
                  fontSize: '14px',
                  fontWeight: 700,
                }}
              >
                {t('core:q_apps.q_manager', { postProcess: 'capitalizeAll' })}
              </span>
            }
            placement="left"
            arrow
            sx={{ fontSize: '24' }}
            slotProps={{
              tooltip: {
                sx: {
                  color: theme.palette.text.primary,
                  backgroundColor: theme.palette.background.default,
                },
              },
              arrow: {
                sx: {
                  color: theme.palette.text.secondary,
                },
              },
            }}
          >
            <InsertLinkIcon sx={{ color: theme.palette.text.primary }} />
          </Tooltip>
        </ButtonBase>

        <ContextMenuMentions
          getTimestampMention={getTimestampMention}
          groupId={selectedGroup}
        >
          <ButtonBase
            onClick={() => {
              setMode('mentions');
              setSearchValue('');
              setSelectedMember(0);
            }}
          >
            <Tooltip
              title={
                <span
                  style={{
                    color: theme.palette.text.primary,
                    fontSize: '14px',
                    fontWeight: 700,
                  }}
                >
                  {t('core:message.generic.mentioned', {
                    postProcess: 'capitalizeAll',
                  })}
                </span>
              }
              placement="left"
              arrow
              sx={{ fontSize: '24' }}
              slotProps={{
                tooltip: {
                  sx: {
                    color: theme.palette.text.primary,
                    backgroundColor: theme.palette.background.default,
                  },
                },
                arrow: {
                  sx: {
                    color: theme.palette.text.secondary,
                  },
                },
              }}
            >
              <AlternateEmailIcon
                sx={{
                  color: hasUnreadMentions
                    ? theme.palette.other.unread
                    : theme.palette.text.primary,
                }}
              />
            </Tooltip>
          </ButtonBase>
        </ContextMenuMentions>
      </Box>
    </Box>
  );
};

const ShowMessage = ({ message, goToMessage, messages, onSelect }) => {
  const theme = useTheme();

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        padding: '0px 20px',
        width: '100%',
      }}
    >
      <Box
        sx={{
          alignItems: 'center',
          background: theme.palette.background.surface,
          display: 'flex',
          justifyContent: 'space-between',
          width: '100%',
        }}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            gap: '15px',
          }}
        >
          <Avatar
            sx={{
              backgroundColor: theme.palette.background.default,
              color: theme.palette.text.primary,
              height: '25px',
              width: '25px',
            }}
            alt={message?.senderName}
            src={`${getBaseApiReact()}/arbitrary/THUMBNAIL/${
              message?.senderName
            }/qortal_avatar?async=true`}
          >
            {message?.senderName?.charAt(0)}
          </Avatar>

          <Typography
            sx={{
              fontWight: 600,
              fontFamily: 'Inter',
            }}
          >
            {message?.senderName}
          </Typography>
        </Box>
      </Box>

      <Spacer height="5px" />

      <Typography
        sx={{
          fontSize: '12px',
        }}
      >
        {formatTimestamp(message.timestamp)}
      </Typography>

      <Box
        style={{
          cursor: 'pointer',
        }}
        onClick={() => {
          const findMsgIndex = messages.findIndex(
            (item) => item?.signature === message?.signature
          );
          if (findMsgIndex !== -1) {
            goToMessage(findMsgIndex);
          }
          // Close the search/mentions panel so the selected message is
          // visible and gets scrolled to in the chat.
          onSelect?.();
        }}
      >
        {message?.messageText && (
          <MessageDisplay htmlContent={message?.messageText} />
        )}
        {message?.decryptedData?.message && (
          <MessageDisplay
            htmlContent={message?.decryptedData?.message || '<p></p>'}
          />
        )}
      </Box>
    </Box>
  );
};
