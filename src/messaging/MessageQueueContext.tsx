import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
} from 'react';
import ShortUniqueId from 'short-unique-id';
import { describeSendError, recordSendFailure } from './sendFailureLog';

const MessageQueueContext = createContext(null);
const uid = new ShortUniqueId({ length: 8 });

export const useMessageQueue = () => useContext(MessageQueueContext);

export const MessageQueueProvider = ({ children }) => {
  const messageQueueRef = useRef([]);
  const [queueChats, setQueueChats] = useState({}); // Stores chats and status for display
  const maxRetries = 2;

  const clearStatesMessageQueueProvider = useCallback(() => {
    setQueueChats({});
    messageQueueRef.current = [];
  }, []);

  // Promise-based lock to prevent concurrent executions
  const processingPromiseRef = useRef(Promise.resolve());

  // Function to add a message to the queue
  const addToQueue = useCallback(
    (sendMessageFunc, messageObj, type, groupDirectId) => {
      const tempId = uid.rnd();
      const chatData = {
        ...messageObj,
        type,
        groupDirectId,
        signature: uid.rnd(),
        identifier: tempId,
        retries: 0, // Retry count for display purposes
        status: 'pending', // Initial status is 'pending'
      };

      // Add chat data to queueChats for status tracking
      setQueueChats((prev) => ({
        ...prev,
        [groupDirectId]: [...(prev[groupDirectId] || []), chatData],
      }));

      // Add the message to the global messageQueueRef
      messageQueueRef.current.push({
        func: sendMessageFunc,
        identifier: tempId,
        groupDirectId,
        specialId: messageObj?.message?.specialId,
        attempts: 0,
      });

      // Start processing the queue
      processQueue([], groupDirectId);
    },
    []
  );

  // Function to process the message queue
  const processQueue = useCallback((newMessages = [], groupDirectId) => {
    processingPromiseRef.current = processingPromiseRef.current
      .then(() => processQueueInternal(newMessages, groupDirectId))
      .catch((err) => console.error('Error in processQueue:', err));
  }, []);

  /**
   * Change the display row for a message that is still being sent.
   *
   * The row can be gone by the time the send finishes: the chat was left, the
   * queue was cleared, or a poll already matched the confirmed message. That
   * is normal, so a missing row is left alone rather than written through.
   */
  const patchQueuedChat = useCallback((groupDirectId, identifier, patch) => {
    setQueueChats((prev) => {
      const chats = prev[groupDirectId];
      if (!chats) return prev;
      const index = chats.findIndex((item) => item.identifier === identifier);
      if (index === -1) return prev;
      const updated = chats.slice();
      updated[index] = { ...updated[index], ...patch };
      return { ...prev, [groupDirectId]: updated };
    });
  }, []);

  // Internal function to handle queue processing
  const processQueueInternal = async (newMessages, groupDirectId) => {
    // Remove any messages from the queue that match the specialId from newMessages

    // If the queue is empty, no need to process
    if (messageQueueRef.current.length === 0) return;

    // Process messages sequentially
    while (messageQueueRef.current.length > 0) {
      const currentMessage = messageQueueRef.current[0]; // Get the first message in the queue
      const { groupDirectId, identifier } = currentMessage;
      currentMessage.attempts = (currentMessage.attempts || 0) + 1;

      // Update the chat status to 'sending'
      patchQueuedChat(groupDirectId, identifier, {
        status: 'sending',
        retries: Math.max(0, currentMessage.attempts - 1),
      });

      try {
        // Execute the function stored in the messageQueueRef

        const result = await currentMessage.func();

        if (result?.clearQueueOnSuccess) {
          setQueueChats((prev) => {
            const updatedChats = { ...prev };
            const chats = updatedChats[groupDirectId];
            if (!chats) return updatedChats;
            updatedChats[groupDirectId] = chats.filter((chat) => {
              return (
                chat.identifier !== identifier &&
                chat?.message?.specialId !== currentMessage.specialId
              );
            });
            if (updatedChats[groupDirectId].length === 0) {
              delete updatedChats[groupDirectId];
            }
            return updatedChats;
          });
        }

        // Remove the message from the queue after successful sending
        messageQueueRef.current.shift();
      } catch (error) {
        console.error('Message sending failed', error);

        const attempts = currentMessage.attempts || 1;
        // Carry the reason with the row: "failed to send" alone gives a phone
        // user (and a screenshot) nothing to act on.
        const sendError = describeSendError(error);
        if (attempts <= maxRetries) {
          patchQueuedChat(groupDirectId, identifier, {
            retries: attempts,
            status: 'failed',
            sendError,
          });
          // Avoid a tight retry loop that can publish the same chat reply
          // multiple times when the first attempt partially succeeds.
          await new Promise((resolve) => setTimeout(resolve, 750));
          continue;
        }

        recordSendFailure(groupDirectId, attempts, error);
        patchQueuedChat(groupDirectId, identifier, {
          retries: attempts,
          status: 'failed-permanent',
          sendError,
        });
        messageQueueRef.current.shift();
      }
    }
  };

  // Method to process with new messages and groupDirectId
  const processWithNewMessages = useCallback((newMessages, groupDirectId) => {
    let updatedNewMessages = newMessages;
    if (newMessages.length > 0) {
      // Remove corresponding entries in queueChats for the provided groupDirectId
      setQueueChats((prev) => {
        const updatedChats = { ...prev };
        if (updatedChats[groupDirectId]) {
          updatedNewMessages = newMessages?.map((msg) => {
            const findTempMsg = updatedChats[groupDirectId]?.find(
              (msg2) => msg2?.message?.specialId === msg?.specialId
            );
            if (findTempMsg) {
              return {
                ...msg,
                tempSignature: findTempMsg?.signature,
              };
            }
            return msg;
          });

          updatedChats[groupDirectId] = updatedChats[groupDirectId].filter(
            (chat) => {
              return !newMessages.some(
                (newMsg) => newMsg?.specialId === chat?.message?.specialId
              );
            }
          );

          // Remove messages with status 'failed-permanent'
          updatedChats[groupDirectId] = updatedChats[groupDirectId].filter(
            (chat) => {
              return chat?.status !== 'failed-permanent';
            }
          );

          // If no more chats for this group, delete the groupDirectId entry
          if (updatedChats[groupDirectId].length === 0) {
            delete updatedChats[groupDirectId];
          }
        }
        return updatedChats;
      });
    }
    // Do not wipe the whole group queue on a timer. That raced with in-flight
    // or unmatched optimistic rows and made reply/link sends vanish on the
    // sender (especially mobile) while Hub still showed the confirmed thread.

    return updatedNewMessages;
  }, []);

  return (
    <MessageQueueContext.Provider
      value={{
        addToQueue,
        queueChats,
        clearStatesMessageQueueProvider,
        processWithNewMessages,
      }}
    >
      {children}
    </MessageQueueContext.Provider>
  );
};
