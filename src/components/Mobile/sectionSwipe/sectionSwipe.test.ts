import { describe, expect, it } from 'vitest';
import {
  SECTION_SURFACE_TOUCH_ACTION,
  SECTION_SWIPE_COOPERATIVE_ATTR,
  SECTION_SWIPE_IGNORE_ATTR,
  SECTION_SWIPE_SURFACE_ATTR,
  findHorizontalOwner,
  sectionTranslateX,
  touchActionOwnsHorizontal,
} from './sectionSwipe';

type FakeStyle = { overflowX?: string; touchAction?: string };

/** Builds root > ...chain, innermost last; styles by data-name. */
const build = (names: string[], styles: Record<string, FakeStyle> = {}) => {
  const root = document.createElement('div');
  let parent: Element = root;
  const nodes: Record<string, HTMLElement> = {};
  for (const name of names) {
    const [tag, label] = name.includes(':') ? name.split(':') : ['div', name];
    const node = document.createElement(tag);
    node.dataset.name = label;
    parent.appendChild(node);
    nodes[label] = node;
    parent = node;
  }
  const readStyle = (element: Element) => {
    const style = styles[(element as HTMLElement).dataset?.name ?? ''] ?? {};
    return {
      overflowX: style.overflowX ?? 'visible',
      touchAction: style.touchAction ?? 'auto',
    };
  };
  return { root, nodes, readStyle };
};

describe('touchActionOwnsHorizontal', () => {
  it('reads who handles sideways drags', () => {
    expect(touchActionOwnsHorizontal('auto')).toBe(false);
    expect(touchActionOwnsHorizontal('manipulation')).toBe(false);
    expect(touchActionOwnsHorizontal('pan-x pan-y')).toBe(false);
    expect(touchActionOwnsHorizontal('none')).toBe(true);
    expect(touchActionOwnsHorizontal('pan-y')).toBe(true);
    expect(touchActionOwnsHorizontal('pinch-zoom')).toBe(true);
  });
});

describe('findHorizontalOwner', () => {
  it('lets plain content switch sections', () => {
    const { root, nodes, readStyle } = build(['page', 'card', 'text']);
    expect(findHorizontalOwner(nodes.text, root, readStyle)).toBeNull();
  });

  it('leaves carousels, fields and media to themselves', () => {
    const carousel = build(['page', 'carousel', 'tile'], {
      carousel: { overflowX: 'auto' },
    });
    Object.defineProperty(carousel.nodes.carousel, 'scrollWidth', {
      value: 900,
    });
    Object.defineProperty(carousel.nodes.carousel, 'clientWidth', {
      value: 400,
    });
    expect(
      findHorizontalOwner(
        carousel.nodes.tile,
        carousel.root,
        carousel.readStyle
      )
    ).toBe(carousel.nodes.carousel);

    const field = build(['page', 'input:field']);
    expect(
      findHorizontalOwner(field.nodes.field, field.root, field.readStyle)
    ).toBe(field.nodes.field);

    const video = build(['page', 'video:clip']);
    expect(
      findHorizontalOwner(video.nodes.clip, video.root, video.readStyle)
    ).toBe(video.nodes.clip);
  });

  it('respects elements that handle sideways drags themselves', () => {
    const { root, nodes, readStyle } = build(['page', 'slider', 'thumb'], {
      slider: { touchAction: 'pan-y' },
    });
    expect(findHorizontalOwner(nodes.thumb, root, readStyle)).toBe(
      nodes.slider
    );
  });

  it("never stops at a section's own scroller", () => {
    const byValue = build(['scroller', 'row'], {
      scroller: { touchAction: SECTION_SURFACE_TOUCH_ACTION },
    });
    expect(
      findHorizontalOwner(byValue.nodes.row, byValue.root, byValue.readStyle)
    ).toBeNull();

    const byAttr = build(['scroller', 'row'], {
      scroller: { touchAction: 'pan-y' },
    });
    byAttr.nodes.scroller.setAttribute(SECTION_SWIPE_SURFACE_ATTR, '');
    expect(
      findHorizontalOwner(byAttr.nodes.row, byAttr.root, byAttr.readStyle)
    ).toBeNull();
  });

  it('trusts a cooperative pager to claim its own swipes', () => {
    const { root, nodes, readStyle } = build(['chat', 'pager', 'list', 'row'], {
      pager: { touchAction: 'pan-y' },
      list: { touchAction: 'pan-y' },
    });
    nodes.pager.setAttribute(SECTION_SWIPE_COOPERATIVE_ATTR, '');
    expect(findHorizontalOwner(nodes.row, root, readStyle)).toBeNull();
  });

  it('stays out of anything marked to ignore', () => {
    const { root, nodes, readStyle } = build(['chat', 'message']);
    nodes.chat.setAttribute(SECTION_SWIPE_IGNORE_ATTR, '');
    expect(findHorizontalOwner(nodes.message, root, readStyle)).toBe(
      nodes.chat
    );
  });
});

describe('sectionTranslateX', () => {
  it('puts neighbours a width to either side of the moving one', () => {
    expect(sectionTranslateX(1, 1, -100, 400)).toBe(-100);
    expect(sectionTranslateX(2, 1, -100, 400)).toBe(300);
    expect(sectionTranslateX(0, 1, -100, 400)).toBe(-500);
  });
});
