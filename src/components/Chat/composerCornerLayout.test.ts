import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COMPOSER_CORNER_BUTTON_PX,
  COMPOSER_CORNER_CSS_VARS,
  COMPOSER_CORNER_ICON_PX,
  COMPOSER_DISCARD_ICON_PX,
  COMPOSER_DISMISS_BUTTON_PX,
  COMPOSER_DISMISS_ICON_PX,
  COMPOSER_DISPLACED_GUTTER,
  COMPOSER_EDGE_GUTTER_PX,
  COMPOSER_EDITOR_SIDE_PAD_PX,
  COMPOSER_FOUR_SLOT_PX,
  COMPOSER_INLINE_TEXT_GUTTERS,
  COMPOSER_SEND_BUTTON_PX,
  COMPOSER_SEND_ICON_PX,
  COMPOSER_SLOT,
  COMPOSER_SQUEEZED_TEXT_GUTTERS,
  COMPOSER_STAGE_FLOOR,
  COMPOSER_STAGE_THREE_MAX_PX,
  COMPOSER_TEXT_INDENT,
  composerTextIndent,
} from './composerCornerLayout';

const B = COMPOSER_CORNER_BUTTON_PX;
const S = COMPOSER_SEND_BUTTON_PX;
const css = readFileSync(resolve(__dirname, 'chat.css'), 'utf8');

type CssRule = {
  selectors: string[];
  declarations: Record<string, string>;
};

/** Splits a selector list on the commas that are not inside parentheses. */
const splitSelectorList = (list: string): string[] => {
  const selectors: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of list) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      selectors.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  selectors.push(current);
  return selectors
    .map((selector) =>
      selector
        .replace(/\s+/g, ' ')
        .replace(/\( /g, '(')
        .replace(/ \)/g, ')')
        .trim()
    )
    .filter(Boolean);
};

/** The innermost style rules of chat.css, at-rule wrappers dropped. */
const cssRules: CssRule[] = [
  ...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g),
].map(([, selectorList, body]) => ({
  selectors: splitSelectorList(selectorList),
  declarations: Object.fromEntries(
    body
      .split(';')
      .map((declaration) => declaration.split(':'))
      .filter((parts) => parts.length >= 2)
      .map(([property, ...value]) => [
        property.trim(),
        value.join(':').replace(/\s+/g, ' ').trim(),
      ])
  ),
}));

/** Whether the selector requires the attribute or class, or rules it out. */
const requires = (selector: string, token: string) =>
  selector.replace(/:not\([^()]*\)/g, '').includes(token);
const excludes = (selector: string, token: string) =>
  selector.includes(`:not(${token})`);

/** Pixels a declaration value stands for: a layout custom property or 0. */
const resolvePx = (value: string): number => {
  if (value === '0') return 0;
  const name = value.match(/^var\((--composer-[a-z0-9-]+)\)$/)?.[1];
  const set = name
    ? COMPOSER_CORNER_CSS_VARS[name as keyof typeof COMPOSER_CORNER_CSS_VARS]
    : undefined;
  if (!set) throw new Error(`${value} is not a corner layout value`);
  return Number.parseFloat(set);
};

/** Where the text starts with this indent, from the row's edge. */
const textEdge = (indent: number) => COMPOSER_EDGE_GUTTER_PX + indent;
// The glyphs sit inside their boxes, so a few pixels between a button's box
// and the text is plenty; none at all would let the caret touch the button.
const MIN_CLEARANCE = 4;

describe('composer corner buttons', () => {
  it('are thumb-sized on phones', () => {
    expect(B).toBeGreaterThanOrEqual(40);
    expect(S).toBeGreaterThanOrEqual(B);
    expect(COMPOSER_DISMISS_BUTTON_PX).toBeGreaterThanOrEqual(40);
  });

  it('carry icons sized for the bigger buttons', () => {
    for (const icon of [
      COMPOSER_CORNER_ICON_PX,
      COMPOSER_SEND_ICON_PX,
      COMPOSER_DISCARD_ICON_PX,
      COMPOSER_DISMISS_ICON_PX,
    ]) {
      expect(icon).toBeGreaterThanOrEqual(22);
      expect(icon).toBeLessThanOrEqual(24);
    }
  });
});

describe('composer text indents', () => {
  it('never indent negatively', () => {
    expect(composerTextIndent(0)).toBe(0);
  });

  it('keep the text clear of the buttons beside it at every stage', () => {
    const cases: Array<[string, number, number]> = [
      ['one line, + 😊 Aa', 3 * B, COMPOSER_TEXT_INDENT.inlineStart],
      [
        'two lines, Aa beside + / 😊',
        2 * B,
        COMPOSER_TEXT_INDENT.squeezedStart,
      ],
      ['three lines, one column', B, COMPOSER_TEXT_INDENT.stackedStart],
      [
        'one line, expiry or X beside send',
        S + B,
        COMPOSER_TEXT_INDENT.inlineEnd,
      ],
      [
        'one line, X and expiry beside send',
        S + 2 * B,
        COMPOSER_TEXT_INDENT.inlineEndDisplaced,
      ],
      ['two lines, send column', S, COMPOSER_TEXT_INDENT.squeezedEnd],
      ['X waiting one column in', S + B, COMPOSER_TEXT_INDENT.innerEnd],
    ];
    for (const [stage, buttonsReach, indent] of cases) {
      expect(
        textEdge(indent) - buttonsReach,
        `${stage}: text ${textEdge(indent)}px vs buttons ${buttonsReach}px`
      ).toBeGreaterThanOrEqual(MIN_CLEARANCE);
    }
  });

  it('needs no indent where chat.css sets none', () => {
    // chat.css has no stage-3 indent rule and zeroes the right indent on two
    // lines; growing the buttons past the editor padding needs rules there.
    expect(COMPOSER_TEXT_INDENT.stackedStart).toBe(0);
    expect(COMPOSER_TEXT_INDENT.squeezedEnd).toBe(0);
  });

  it('adds up to the width the stage prediction takes off', () => {
    expect(COMPOSER_INLINE_TEXT_GUTTERS).toBe(
      2 * COMPOSER_EDGE_GUTTER_PX +
        COMPOSER_TEXT_INDENT.inlineStart +
        COMPOSER_TEXT_INDENT.inlineEnd
    );
    expect(COMPOSER_SQUEEZED_TEXT_GUTTERS).toBe(
      2 * COMPOSER_EDGE_GUTTER_PX +
        COMPOSER_TEXT_INDENT.squeezedStart +
        COMPOSER_TEXT_INDENT.squeezedEnd
    );
    expect(COMPOSER_DISPLACED_GUTTER.inline).toBe(
      COMPOSER_TEXT_INDENT.inlineEndDisplaced - COMPOSER_TEXT_INDENT.inlineEnd
    );
    expect(COMPOSER_DISPLACED_GUTTER.squeezed).toBe(
      COMPOSER_TEXT_INDENT.innerEnd - COMPOSER_TEXT_INDENT.squeezedEnd
    );
  });

  it('leaves a 360dp phone room to type on one line', () => {
    // 360dp minus the composer band (8px a side), the card padding (5px) and
    // its border (1px): what the corner row has to work with.
    const row = 360 - 2 * (8 + 5 + 1);
    const groupWithDiscard =
      row - COMPOSER_INLINE_TEXT_GUTTERS - COMPOSER_DISPLACED_GUTTER.inline;
    expect(groupWithDiscard).toBeGreaterThanOrEqual(64);
    expect(row - COMPOSER_INLINE_TEXT_GUTTERS).toBeGreaterThanOrEqual(100);
  });
});

describe('composer stage heights', () => {
  // Box edges of a button centred `centre` px from an edge.
  const reach = (centre: number, size: number) => centre + size / 2;
  const startOf = (centre: number, size: number) => centre - size / 2;

  it('fit a row of buttons on one line', () => {
    expect(COMPOSER_STAGE_FLOOR.inline).toBeGreaterThanOrEqual(S);
  });

  it('fit two buttons down each edge on two lines', () => {
    const floor = COMPOSER_STAGE_FLOOR.squeezed;
    // + over 😊.
    expect(2 * reach(COMPOSER_SLOT.first, B)).toBeLessThanOrEqual(floor);
    // Expiry (or the X in a direct message) over send.
    expect(
      reach(COMPOSER_SLOT.first, B) + reach(COMPOSER_SLOT.send, S)
    ).toBeLessThanOrEqual(floor);
    expect(startOf(COMPOSER_SLOT.overSend, B)).toBeGreaterThanOrEqual(
      reach(COMPOSER_SLOT.send, S)
    );
    expect(reach(COMPOSER_SLOT.overSend, B)).toBeLessThanOrEqual(floor);
  });

  it('fit three buttons down each edge from three lines', () => {
    const floor = COMPOSER_STAGE_FLOOR.stacked;
    // Left: + at the top, Aa centred, 😊 at the bottom.
    expect(3 * B).toBeLessThanOrEqual(floor);
    expect(startOf(floor / 2, B)).toBeGreaterThanOrEqual(
      reach(COMPOSER_SLOT.first, B)
    );
    // Right, in a direct message: expand at the top, the X over send.
    expect(
      reach(COMPOSER_SLOT.first, B) + reach(COMPOSER_SLOT.overSend, B)
    ).toBeLessThanOrEqual(floor);
    // Right, in a group: expiry at the top, the X midway, send at the bottom.
    const middle = floor / 2 - COMPOSER_SLOT.middleShift;
    expect(startOf(middle, B)).toBeGreaterThanOrEqual(
      reach(COMPOSER_SLOT.first, B)
    );
    expect(reach(middle, B)).toBeLessThanOrEqual(
      floor - reach(COMPOSER_SLOT.send, S)
    );
  });

  it('fit four buttons down the right edge once tall enough', () => {
    expect(
      reach(COMPOSER_SLOT.first, B) + reach(COMPOSER_SLOT.fourth, B)
    ).toBeLessThanOrEqual(COMPOSER_FOUR_SLOT_PX);
    expect(startOf(COMPOSER_SLOT.fourth, B)).toBeGreaterThanOrEqual(
      reach(COMPOSER_SLOT.overSend, B)
    );
  });

  it('can always grow tall enough for four buttons, and never shrank', () => {
    expect(COMPOSER_STAGE_THREE_MAX_PX).toBeGreaterThan(COMPOSER_FOUR_SLOT_PX);
    expect(COMPOSER_STAGE_THREE_MAX_PX).toBeGreaterThanOrEqual(160);
    expect(COMPOSER_STAGE_FLOOR.squeezed).toBeGreaterThan(
      COMPOSER_STAGE_FLOOR.inline
    );
    expect(COMPOSER_STAGE_FLOOR.stacked).toBeGreaterThan(
      COMPOSER_STAGE_FLOOR.squeezed
    );
  });

  it('centres a button on the send column', () => {
    expect(2 * COMPOSER_SLOT.columnInset + B).toBe(S);
  });
});

describe('chat.css corner layout', () => {
  const cornerRules = css.slice(
    css.indexOf('Composer chrome rails'),
    css.indexOf('@media (prefers-reduced-motion: reduce)')
  );

  it('waits for exactly four buttons before expand comes back', () => {
    const query = css.match(
      /@container composer-rail \(min-height: (\d+(?:\.\d+)?)px\)/
    );
    expect(query?.[1]).toBe(String(COMPOSER_FOUR_SLOT_PX));
  });

  it('reads only custom properties that something sets', () => {
    const declared = new Set(
      [...css.matchAll(/(--composer-[a-z0-9-]+)\s*:/g)].map((match) => match[1])
    );
    const fromLayout = new Set(Object.keys(COMPOSER_CORNER_CSS_VARS));
    // Set by TipTap itself: the room the bar has left, and the colours.
    const fromComponent = new Set([
      '--composer-space',
      '--composer-bg',
      '--composer-border',
    ]);
    const used = new Set(
      [...css.matchAll(/var\((--composer-[a-z0-9-]+)/g)].map(
        (match) => match[1]
      )
    );
    for (const name of used) {
      expect(
        declared.has(name) || fromLayout.has(name) || fromComponent.has(name),
        `${name} is never set`
      ).toBe(true);
    }
    for (const name of fromLayout) {
      expect(used.has(name), `${name} is never read`).toBe(true);
    }
  });

  it('places the controls from the layout, not from pixel literals', () => {
    const literals = [
      ...cornerRules.matchAll(
        /\b(left|right|top):\s*(?:calc\([^;]*?)?(?<![\w-])([1-9]\d*(?:\.\d+)?)px/g
      ),
    ].map((match) => match[0]);
    expect(literals).toEqual([]);
  });

  describe('text indents', () => {
    // The paragraph rules of each stage, picked out by the stage attributes
    // and the discard button their selectors wait for.
    const STACKED = '[data-composer-stacked]';
    const SQUEEZED = '[data-composer-squeezed]';
    const CAPPED = '[data-composer-capped]';
    const DISCARD = ':has(.compact-composer-discard:not([data-idle]))';
    const paragraphRule = (
      matches: (selector: string) => boolean
    ): Record<string, string> => {
      const found = cssRules.filter((rule) =>
        rule.selectors.some(
          (selector) =>
            selector.endsWith('.compact-composer-editor .tiptap > *') &&
            !requires(selector, '.tiptap-chat-composer--expanded') &&
            matches(selector)
        )
      );
      if (found.length !== 1) {
        throw new Error(`expected one paragraph rule, found ${found.length}`);
      }
      return found[0].declarations;
    };
    const stages = () => ({
      inline: paragraphRule(
        (selector) =>
          excludes(selector, STACKED) &&
          excludes(selector, SQUEEZED) &&
          !selector.includes(DISCARD)
      ),
      squeezed: paragraphRule(
        (selector) =>
          requires(selector, SQUEEZED) &&
          excludes(selector, STACKED) &&
          !selector.includes(DISCARD)
      ),
      inlineDisplaced: paragraphRule(
        (selector) =>
          excludes(selector, STACKED) &&
          excludes(selector, SQUEEZED) &&
          selector.includes(DISCARD)
      ),
      squeezedDisplaced: paragraphRule(
        (selector) =>
          requires(selector, SQUEEZED) &&
          !requires(selector, STACKED) &&
          !requires(selector, CAPPED) &&
          selector.includes(DISCARD)
      ),
      // Two lines that can grow no further: the X shares the inner column
      // in a direct message too.
      cappedDisplaced: paragraphRule(
        (selector) =>
          requires(selector, CAPPED) &&
          requires(selector, SQUEEZED) &&
          selector.includes(DISCARD)
      ),
    });

    it('reads the indent each stage clears its buttons with', () => {
      const {
        cappedDisplaced,
        inline,
        inlineDisplaced,
        squeezed,
        squeezedDisplaced,
      } = stages();
      expect(inline['padding-left']).toBe(
        'var(--composer-indent-inline-start)'
      );
      expect(inline['padding-right']).toBe('var(--composer-indent-inline-end)');
      expect(squeezed['padding-left']).toBe(
        'var(--composer-indent-squeezed-start)'
      );
      expect(squeezed['padding-right']).toBe('0');
      expect(inlineDisplaced['padding-right']).toBe(
        'var(--composer-indent-inline-end-displaced)'
      );
      expect(squeezedDisplaced['padding-right']).toBe(
        'var(--composer-indent-inner-end)'
      );
      expect(cappedDisplaced['padding-right']).toBe(
        'var(--composer-indent-inner-end)'
      );
    });

    it('takes off the width the stage prediction allows for', () => {
      const { inline, inlineDisplaced, squeezed, squeezedDisplaced } = stages();
      // TipTap decides a message fits on one line, or two, by the width left
      // after these gutters; text laid out narrower than predicted would
      // wrap before the stage changes.
      expect(
        2 * COMPOSER_EDGE_GUTTER_PX +
          resolvePx(inline['padding-left']) +
          resolvePx(inline['padding-right'])
      ).toBe(COMPOSER_INLINE_TEXT_GUTTERS);
      expect(
        2 * COMPOSER_EDGE_GUTTER_PX +
          resolvePx(squeezed['padding-left']) +
          resolvePx(squeezed['padding-right'])
      ).toBe(COMPOSER_SQUEEZED_TEXT_GUTTERS);
      expect(
        resolvePx(inlineDisplaced['padding-right']) -
          resolvePx(inline['padding-right'])
      ).toBe(COMPOSER_DISPLACED_GUTTER.inline);
      expect(
        resolvePx(squeezedDisplaced['padding-right']) -
          resolvePx(squeezed['padding-right'])
      ).toBe(COMPOSER_DISPLACED_GUTTER.squeezed);
    });

    it('starts from the editor and text padding the layout assumes', () => {
      const editor = cssRules.find((rule) =>
        rule.selectors.includes(
          '.tiptap-chat-composer--corners .compact-composer-editor'
        )
      )?.declarations;
      expect(editor?.['padding-left']).toBe('var(--composer-editor-pad)');
      expect(editor?.['padding-right']).toBe('var(--composer-editor-pad)');
      // ProseMirror's own side padding on phones.
      const phoneText = cssRules.find((rule) =>
        rule.selectors.includes(
          '.tiptap-chat-composer:not(.tiptap-chat-composer--mobile-focus) .tiptap-prosemirror'
        )
      )?.declarations;
      expect(phoneText?.padding?.split(' ').pop()).toBe(
        `${COMPOSER_EDGE_GUTTER_PX - COMPOSER_EDITOR_SIDE_PAD_PX}px`
      );
    });
  });

  it('lets a direct message grow as tall as a group', () => {
    // The phone DM row caps the text of the composers it holds; the corner
    // composer's own stages decide its height instead.
    const uncapped = cssRules.find((rule) =>
      rule.selectors.includes(
        '.mobile-chat-compose-row .tiptap-chat-composer--corners .tiptap-prosemirror'
      )
    );
    expect(uncapped?.declarations['max-height']).toBe('none');
    const capped = cssRules.findIndex((rule) =>
      rule.selectors.includes(
        '.mobile-chat-compose-row .tiptap-chat-composer .tiptap-prosemirror'
      )
    );
    expect(cssRules.indexOf(uncapped!)).toBeGreaterThan(capped);
  });

  it('matches the layout values it is handed', () => {
    expect(COMPOSER_CORNER_CSS_VARS['--composer-button']).toBe(`${B}px`);
    expect(COMPOSER_CORNER_CSS_VARS['--composer-send']).toBe(`${S}px`);
    expect(COMPOSER_CORNER_CSS_VARS['--composer-stage-3-max']).toBe(
      `${COMPOSER_STAGE_THREE_MAX_PX}px`
    );
  });
});
