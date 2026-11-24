import { createContext, useContext, type ReactNode } from 'react';
import { useVoiceCall, type UseVoiceCallReturn } from '../hooks/useVoiceCall';
import { useDmFriendRemovalSync } from '../hooks/useDmFriendRemovalSync';

const VoiceCallContext = createContext<UseVoiceCallReturn | null>(null);

export function VoiceCallProvider({ children }: { children: ReactNode }) {
  const value = useVoiceCall();
  // GO: a friend removed on another device stops being a friend here.
  useDmFriendRemovalSync();
  return (
    <VoiceCallContext.Provider value={value}>{children}</VoiceCallContext.Provider>
  );
}

export function useVoiceCallContext(): UseVoiceCallReturn {
  const ctx = useContext(VoiceCallContext);
  if (!ctx) {
    throw new Error('useVoiceCallContext must be used within VoiceCallProvider');
  }
  return ctx;
}
