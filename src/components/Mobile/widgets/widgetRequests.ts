/**
 * What a GO widget may ask GO for (qortalRequest actions that reach GO; the
 * read-only node look-ups, such as SEARCH_QDN_RESOURCES or GET_BALANCE, are
 * answered by Core's own script inside the frame and never get here).
 *
 * Widgets run without being opened, beside Home, so they get far less than
 * an open Q-App: they show things and open apps. Anything that pays,
 * publishes, signs, decrypts, saves files, sends messages, notifies or takes
 * the whole screen is refused, with a message to open the app instead. The
 * few that ask the user (account address, wallet balance) or change what is
 * on screen (opening an app) are only taken while the widgets screen is the
 * one showing, so a widget off screen never pops anything up.
 */

/** Widgets' own requests, answered by the widget screen. */
export const GO_WIDGET_SET_SIZE = 'GO_WIDGET_SET_SIZE';
export const GO_WIDGET_INFO = 'GO_WIDGET_INFO';

/** Harmless at any time: public node facts and the frame's own bookkeeping. */
const ALWAYS = new Set([
  'GET_CROSSCHAIN_SERVER_INFO',
  'GET_DAY_SUMMARY',
  'GET_FOREIGN_FEE',
  'GET_NODE_INFO',
  'GET_NODE_STATUS',
  'GET_PRIMARY_NAME',
  'GET_TX_ACTIVITY_SUMMARY',
  'IS_USING_PUBLIC_NODE',
  'LINK_TO_QDN_RESOURCE',
  'NAVIGATION_HISTORY',
  'QDN_RESOURCE_DISPLAYED',
  'WHICH_UI',
]);

/** Only while the widgets screen is showing: they ask or open something. */
const ON_SCREEN = new Set([
  'GET_USER_ACCOUNT',
  'GET_WALLET_BALANCE',
  'OPEN_NEW_TAB',
  'OPEN_USER_LOOKUP',
  'SET_TAB',
]);

type WidgetRequestVerdict =
  | { kind: 'allow' }
  | { kind: 'own' }
  | { kind: 'refuse'; reason: 'not_in_widgets' | 'not_on_screen' };

export const widgetRequestVerdict = (
  action: unknown,
  onScreen: boolean
): WidgetRequestVerdict => {
  if (action === GO_WIDGET_SET_SIZE || action === GO_WIDGET_INFO) {
    return { kind: 'own' };
  }
  if (typeof action !== 'string') {
    return { kind: 'refuse', reason: 'not_in_widgets' };
  }
  if (ALWAYS.has(action)) return { kind: 'allow' };
  if (ON_SCREEN.has(action)) {
    return onScreen
      ? { kind: 'allow' }
      : { kind: 'refuse', reason: 'not_on_screen' };
  }
  return { kind: 'refuse', reason: 'not_in_widgets' };
};

export const WIDGET_REFUSED_MESSAGES: Record<
  'not_in_widgets' | 'not_on_screen',
  string
> = {
  not_in_widgets:
    'Not available in GO widgets. Open the app for this (OPEN_NEW_TAB).',
  not_on_screen: 'The widgets screen is not showing.',
};

/**
 * What the message listener needs from a widget frame. `answer` handles the
 * widget's own requests (GO_WIDGET_*) and returns the result to send back.
 */
export interface QappWidgetPolicy {
  isOnScreen: () => boolean;
  answer: (action: string, data: Record<string, unknown>) => unknown;
}
