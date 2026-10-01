import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closePanelOnOutsideTap } from './emojiPanelBus';

describe('closePanelOnOutsideTap', () => {
  let composer: HTMLElement;
  let close: ReturnType<typeof vi.fn>;
  let stop: () => void;

  const add = (html: string, parent: HTMLElement = document.body) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    const el = host.firstElementChild as HTMLElement;
    parent.appendChild(el);
    return el;
  };

  const tap = (el: HTMLElement, { prevent = false } = {}) => {
    if (prevent) {
      el.addEventListener('mousedown', (event) => event.preventDefault(), {
        once: true,
      });
    }
    el.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    );
    vi.runAllTimers();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    composer = add('<div class="composer"><button>send</button></div>');
    close = vi.fn();
    stop = closePanelOnOutsideTap((t) => composer.contains(t), close);
  });

  afterEach(() => {
    stop();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('closes on a tap in the message list', () => {
    tap(add('<div class="message">hello</div>'));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes on a tap on a button outside the composer', () => {
    tap(add('<button>back</button>'));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('stays open for taps in the composer and the panel', () => {
    tap(composer.querySelector('button') as HTMLElement);
    const panel = add('<div data-emoji-panel="true"><span>😀</span></div>');
    tap(panel.querySelector('span') as HTMLElement);
    expect(close).not.toHaveBeenCalled();
  });

  it('stays open when the tap cancels the focus change', () => {
    tap(add('<button>remove chip</button>'), { prevent: true });
    expect(close).not.toHaveBeenCalled();
  });

  it('leaves text fields to the keyboard handoff, but not checkboxes', () => {
    tap(add('<input type="search" />'));
    tap(add('<textarea></textarea>'));
    tap(
      add('<div contenteditable="true"><p>x</p></div>')
        .firstElementChild as HTMLElement
    );
    expect(close).not.toHaveBeenCalled();
    tap(add('<input type="checkbox" />'));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('stays open inside menus opened from the composer', () => {
    const menu = add(
      '<div class="MuiModal-root"><li role="menuitem">1h</li></div>'
    );
    tap(menu.querySelector('li') as HTMLElement);
    expect(close).not.toHaveBeenCalled();
  });

  it('stops listening once cleaned up', () => {
    stop();
    tap(add('<div>after</div>'));
    expect(close).not.toHaveBeenCalled();
  });
});
