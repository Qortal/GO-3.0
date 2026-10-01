import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '../../i18n/i18n';
import { MessageSizeLimitLip } from './MessageSizeLimitLip';

describe('MessageSizeLimitLip', () => {
  it('renders nothing while the text is within the limit', () => {
    const { container } = render(
      <MessageSizeLimitLip maximum={4000} shakeKey={0} size={4000} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps the size error for callers that pass no split props', () => {
    render(<MessageSizeLimitLip maximum={4000} shakeKey={0} size={4523} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(alert).toHaveTextContent(/4523 bytes/);
    expect(alert).toHaveTextContent(/maximum of 4000/);
  });

  it('shows a polite notice when the text will be split', () => {
    render(
      <MessageSizeLimitLip
        maximum={4000}
        shakeKey={0}
        size={9000}
        splitParts={3}
      />
    );
    expect(screen.queryByRole('alert')).toBeNull();
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent(
      'Long message: it will be sent as 3 messages.'
    );
  });

  it('shows nothing when one trimmed part already fits', () => {
    const { container } = render(
      <MessageSizeLimitLip
        maximum={4000}
        shakeKey={0}
        size={4100}
        splitParts={1}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    [
      'too_many_parts' as const,
      'This message is too long to send, even split into 15 messages.',
    ],
    [
      'unsplittable' as const,
      'Part of this message cannot be split small enough to send.',
    ],
    [
      'edit' as const,
      'Edited messages cannot be split. Shorten it to 4000 bytes.',
    ],
  ])('shows the %s error even when a part count is known', (error, text) => {
    render(
      <MessageSizeLimitLip
        maximum={4000}
        shakeKey={0}
        size={70000}
        splitError={error}
        splitParts={4}
      />
    );
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(text);
  });

  it('uses maxParts in the too_many_parts sentence', () => {
    render(
      <MessageSizeLimitLip
        maxParts={5}
        maximum={4000}
        shakeKey={0}
        size={70000}
        splitError="too_many_parts"
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'even split into 5 messages.'
    );
  });
});
