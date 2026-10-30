/**
 * A Q-App notification belongs to the app that asked for it: the app the
 * person allowed in the notification settings, whose name is the card title.
 *
 * The rule an app registers may still point somewhere else. Torq's rules
 * link to Quitter and carry Quitter's avatar (Torq shows Quitter's posts),
 * so a Torq card showed Quitter's icon and opened Quitter, an app the person
 * may never have allowed. Here the link and the icon are tied back to the
 * owner. Stored rules stay as the app sent them, so they match the copies
 * synced with desktop Hubs.
 */
import { decodeQdnName, resolveRegisteredName } from './qdnNameDisplay';

const RESOURCE_PUBLISHED = 'RESOURCE_PUBLISHED';
/** How long opening a notification waits for the app's registered spelling. */
const SPELLING_WAIT_MS = 1500;

/** "qortal://APP/Quitter/post/a/b" → service, name and what follows. */
const SERVICE_LINK = /^qortal:\/\/?([A-Za-z_]+)\/([^/?#]+)(.*)$/i;
/** "qortal://Name" (a website) or "qortal://Name?x" / "qortal://Name#x". */
const NAME_LINK = /^qortal:\/\/?([^/?#]+)([?#].*)?$/i;
/** The QDN name of a node resource path or URL ("/arbitrary/IMAGE/Name/…"). */
const ARBITRARY_NAME = /\/arbitrary\/[A-Za-z_]+\/([^/?#]+)/;

type AppNotification = {
  event?: unknown;
  appName?: unknown;
  appService?: unknown;
  image?: unknown;
  link?: unknown;
  data?: { name?: unknown; [key: string]: unknown } | null;
};

type NotificationOwnerApp = { name: string; service: 'APP' | 'WEBSITE' };

const sameName = (a: string, b: string) =>
  decodeQdnName(a).toLowerCase() === decodeQdnName(b).toLowerCase();

const decodeSegment = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** The app a Q-App notification belongs to, or null for any other kind. */
export function getNotificationOwnerApp(
  notification: AppNotification | null | undefined
): NotificationOwnerApp | null {
  if (!notification || notification.event !== RESOURCE_PUBLISHED) return null;
  const name =
    typeof notification.appName === 'string'
      ? decodeQdnName(notification.appName)
      : '';
  if (!name) return null;
  const service =
    String(notification.appService ?? '').toUpperCase() === 'WEBSITE'
      ? 'WEBSITE'
      : 'APP';
  return { name, service };
}

const ownerStartLink = (owner: NotificationOwnerApp, spelling: string) =>
  `qortal://${owner.service}/${encodeURIComponent(spelling)}`;

/**
 * The link, opening the owner. A link into another app keeps its path in the
 * owner (Torq has Quitter's "post/<name>/<id>" route); anything else that is
 * not the owner's opens the owner's start page.
 */
function ownerLink(
  link: unknown,
  owner: NotificationOwnerApp,
  spelling: string
): string {
  const value = typeof link === 'string' ? link.trim() : '';
  const serviceLink = SERVICE_LINK.exec(value);
  if (serviceLink) {
    const [, service, rawName, rest] = serviceLink;
    if (sameName(decodeSegment(rawName), owner.name)) return value;
    const upper = service.toUpperCase();
    if (upper !== 'APP' && upper !== 'WEBSITE') {
      return ownerStartLink(owner, spelling);
    }
    // An identifier names a resource of the other app, not of the owner.
    const queryAt = rest.indexOf('?');
    const hashAt = rest.indexOf('#');
    if (queryAt === -1 || (hashAt !== -1 && hashAt < queryAt)) {
      return `${ownerStartLink(owner, spelling)}${rest}`;
    }
    const path = rest.slice(0, queryAt);
    const hashInQuery = rest.indexOf('#', queryAt);
    const query =
      hashInQuery === -1
        ? rest.slice(queryAt + 1)
        : rest.slice(queryAt + 1, hashInQuery);
    const hash = hashInQuery === -1 ? '' : rest.slice(hashInQuery);
    const params = new URLSearchParams(query);
    params.delete('identifier');
    const kept = params.toString();
    return `${ownerStartLink(owner, spelling)}${path}${kept ? `?${kept}` : ''}${hash}`;
  }
  const nameLink = NAME_LINK.exec(value);
  if (nameLink && !/^use-/i.test(nameLink[1])) {
    if (sameName(decodeSegment(nameLink[1]), owner.name)) return value;
  }
  return ownerStartLink(owner, spelling);
}

/**
 * The icon, showing the owner. Node images of the owner or of whoever
 * published the post (a rule may show the author's avatar) stay; another
 * name's image becomes the owner's avatar. Inline images and bundled assets
 * name nobody and stay as they are.
 */
function ownerImage(
  image: unknown,
  owner: NotificationOwnerApp,
  publisher: string,
  spelling: string
): unknown {
  if (typeof image !== 'string') return image;
  const match = ARBITRARY_NAME.exec(image);
  if (!match) return image;
  const name = decodeSegment(match[1]);
  if (sameName(name, owner.name)) return image;
  if (publisher && sameName(name, publisher)) return image;
  return `/arbitrary/THUMBNAIL/${encodeURIComponent(spelling)}/qortal_avatar?async=true`;
}

/**
 * The notification with its link and icon on the app that registered it.
 * Returns the same object when nothing points elsewhere. `spelling` is the
 * registered spelling of the owner's name (rules keep it lowercased) for a
 * rewritten link.
 */
export function pinNotificationToOwnerApp<T extends AppNotification>(
  notification: T,
  spelling?: string
): T {
  const owner = getNotificationOwnerApp(notification);
  if (!owner) return notification;
  const ownerSpelling =
    spelling && sameName(spelling, owner.name) ? spelling : owner.name;
  const publisher =
    typeof notification.data?.name === 'string' ? notification.data.name : '';
  const link =
    notification.link == null
      ? notification.link
      : ownerLink(notification.link, owner, ownerSpelling);
  const image = ownerImage(notification.image, owner, publisher, ownerSpelling);
  if (link === notification.link && image === notification.image) {
    return notification;
  }
  return { ...notification, link, image };
}

/**
 * The owner's name as registered ("Torq", not "torq"), or the name as it is
 * when the node does not answer in time. Lookups are shared and kept, so the
 * bell, which already shows the registered name, answers at once.
 */
export function getNotificationOwnerSpelling(name: string): Promise<string> {
  const fallback = decodeQdnName(name);
  if (!fallback) return Promise.resolve('');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(fallback), SPELLING_WAIT_MS);
  });
  return Promise.race([
    resolveRegisteredName(fallback).then((resolved) => resolved || fallback),
    timeout,
  ]).finally(() => clearTimeout(timer));
}

/**
 * The notification tied to its owner with the owner's registered spelling,
 * for opening it or for a tray alert. Other notifications come back as they
 * are.
 */
export async function pinNotificationToOwnerAppSpelled<
  T extends AppNotification,
>(notification: T): Promise<T> {
  const owner = getNotificationOwnerApp(notification);
  if (!owner) return notification;
  const spelling = await getNotificationOwnerSpelling(owner.name);
  return pinNotificationToOwnerApp(notification, spelling);
}
