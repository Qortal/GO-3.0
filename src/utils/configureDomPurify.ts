import DOMPurify from 'dompurify';
import {
  cssCanFetch,
  isAllowedMediaUrl,
  isAllowedSrcset,
  isAllowedSvgReference,
} from './remoteContentPolicy';

let openerPolicyHookInstalled = false;
let remoteContentHookInstalled = false;

function mergeRel(existing: string | null): string {
  const tokens = new Set<string>();
  if (existing) {
    for (const raw of existing.trim().split(/\s+/)) {
      if (raw) tokens.add(raw.toLowerCase());
    }
  }
  tokens.add('noopener');
  tokens.add('noreferrer');
  return [...tokens].join(' ');
}

/**
 * Links with target="_blank" must not receive window.opener in the new browsing context
 * (reverse tabnabbing). Applied to all DOMPurify.sanitize runs after this module loads.
 */
function installOpenerPolicyHook(): void {
  if (openerPolicyHookInstalled) return;
  openerPolicyHookInstalled = true;

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName !== 'A') return;
    const target = node.getAttribute('target');
    if (target == null) return;
    if (target.replace(/\s+/g, '').toLowerCase() !== '_blank') return;
    node.setAttribute('rel', mergeRel(node.getAttribute('rel')));
  });
}

/** SVG elements whose href fetches another document or image. */
const SVG_FETCHING_TAGS = new Set(['image', 'use', 'feimage']);

/** <img> elements whose src was refused, swapped for text once sanitized. */
const refusedImageSrc = new WeakMap<Node, string>();

/**
 * Untrusted HTML must not load images or media from outside servers: a remote
 * image is a tracking pixel that reports the reader's IP address and when they
 * read the message. Allowed sources are in remoteContentPolicy.ts. A refused
 * <img> becomes its URL as plain text, which chat turns into a link the reader
 * can choose to open; other refused sources are dropped. Applied to all
 * DOMPurify.sanitize runs after this module loads.
 */
function installRemoteContentHook(): void {
  if (remoteContentHookInstalled) return;
  remoteContentHookInstalled = true;

  DOMPurify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName === 'style' && cssCanFetch(node.textContent)) {
      node.textContent = '';
    }
  });

  DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
    const tag = node.nodeName.toLowerCase();
    const value = data.attrValue;
    let allowed = true;
    switch (data.attrName) {
      case 'src':
      case 'poster':
      case 'background':
      case 'data':
        allowed = isAllowedMediaUrl(value);
        break;
      case 'srcset':
        allowed = isAllowedSrcset(value);
        break;
      case 'href':
      case 'xlink:href':
        allowed = !SVG_FETCHING_TAGS.has(tag) || isAllowedSvgReference(value);
        break;
      case 'style':
        allowed = !cssCanFetch(value);
        break;
      // HTML invoker commands (allowed by default since DOMPurify 3.4.4): a
      // tapped <button commandfor=id command=...> could open or close GO's
      // own dialogs and popovers by id.
      case 'command':
      case 'commandfor':
        allowed = false;
        break;
    }
    if (allowed) return;
    data.keepAttr = false;
    if (tag === 'img' && data.attrName === 'src') {
      refusedImageSrc.set(node, value);
    }
  });

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    const src = refusedImageSrc.get(node);
    if (src === undefined) return;
    refusedImageSrc.delete(node);
    // Spaces keep the URL a separate word for linkify.
    node.replaceWith(node.ownerDocument.createTextNode(` ${src} `));
  });
}

installOpenerPolicyHook();
installRemoteContentHook();
