import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ANDROID_BACK_EVENT } from '../../bridge/capacitorBridge';
import { BACK_PRIORITY, useAndroidBack } from '../../utils/androidBack';
import { AvatarPreviewModal } from './AvatarPreviewModal';

const pressAndroidBack = () => {
  const event = new CustomEvent(ANDROID_BACK_EVENT, { cancelable: true });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
};

/** A list section underneath, as Group.tsx registers it on phones. */
const SectionBack = ({ onBack }: { onBack: () => boolean }) => {
  useAndroidBack(onBack, { priority: BACK_PRIORITY.section });
  return null;
};

describe('AvatarPreviewModal', () => {
  it('closes on Android back before the screen beneath sees it', () => {
    const onClose = vi.fn();
    const sectionBack = vi.fn(() => true);
    const { unmount } = render(
      <>
        <SectionBack onBack={sectionBack} />
        <AvatarPreviewModal open src="blob:test/1" onClose={onClose} />
      </>
    );

    const event = pressAndroidBack();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sectionBack).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    unmount();
  });

  it('leaves back alone while closed or without a picture', () => {
    const onClose = vi.fn();
    const sectionBack = vi.fn(() => true);
    const { rerender, unmount } = render(
      <>
        <SectionBack onBack={sectionBack} />
        <AvatarPreviewModal open={false} src="blob:test/1" onClose={onClose} />
      </>
    );

    pressAndroidBack();
    rerender(
      <>
        <SectionBack onBack={sectionBack} />
        <AvatarPreviewModal open src={null} onClose={onClose} />
      </>
    );
    pressAndroidBack();

    expect(onClose).not.toHaveBeenCalled();
    expect(sectionBack).toHaveBeenCalledTimes(2);
    unmount();
  });
});
