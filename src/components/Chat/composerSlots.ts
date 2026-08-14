import { useEffect, useState } from 'react';
import { useAtomValue } from 'jotai';
import { mobileFullscreenComposerActiveAtom } from '../../atoms/global';

/**
 * DOM id of the row the full-screen composer keeps for pending attachments.
 * The chips are owned by the chat screen around the composer, which is covered
 * once the composer goes full screen — it portals them in here instead so the
 * user can still see, and remove, what they are about to send.
 */
export const FULLSCREEN_COMPOSER_ATTACHMENTS_SLOT_ID =
  'fullscreen-composer-attachments';

/** That row, while the full-screen composer is up; null when it is not. */
export const useFullscreenComposerAttachmentSlot = (): HTMLElement | null => {
  const fullscreenComposerActive = useAtomValue(
    mobileFullscreenComposerActiveAtom
  );
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSlot(
      fullscreenComposerActive
        ? document.getElementById(FULLSCREEN_COMPOSER_ATTACHMENTS_SLOT_ID)
        : null
    );
  }, [fullscreenComposerActive]);
  return slot;
};
