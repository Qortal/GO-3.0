/**
 * Plain-text export of a Qortino assistant bubble — includes card shelves
 * (profiles / admin lists / owned names / media) not only `content`.
 */
import type { OfficialResourceLink } from '../../../qortinoAgent/officialResources';
import type { MatchedQApp } from '../../../qortinoAgent/qAppCatalog';
import type { QdnMediaItem } from '../../../qortinoAgent/qdnMedia';
import type { QdnPublishedSite } from '../../../qortinoAgent/qdnPublishedSites';
import type { QdnProfileCard, QuitterPostCard } from '../../../qortinoAgent/qdnLookup';
import type { OwnedNameRow } from '../../../qortinoAgent/qdnRoster';
import { formatRegistered } from '../../../qortinoAgent/qdnRoster';

type ClipboardBubble = {
  content?: string;
  profiles?: QdnProfileCard[];
  ownedNames?: OwnedNameRow[];
  publishedSites?: QdnPublishedSite[];
  quitterPosts?: QuitterPostCard[];
  apps?: MatchedQApp[];
  links?: OfficialResourceLink[];
  media?: QdnMediaItem[];
};

function formatProfileBlock(p: QdnProfileCard, index: number): string {
  const primary = (p.primaryName || p.name).trim();
  const headBits = [`${index + 1}. ${primary}`];
  if (
    p.nameRole === 'secondary' &&
    p.name.trim().toLowerCase() !== primary.toLowerCase()
  ) {
    headBits.push(`(also as ${p.name})`);
  }
  headBits.push(`Level ${p.level}`);
  if (p.tags?.length) headBits.push(p.tags.join(', '));
  const lines = [headBits.join(' · '), p.address];
  if (p.characterSummary?.trim()) lines.push(p.characterSummary.trim());
  if (p.description?.trim()) lines.push(p.description.trim());
  return lines.join('\n');
}

/** Full visible answer as plain text for copy / teach-report. */
export function formatAssistantBubbleForClipboard(m: ClipboardBubble): string {
  const parts: string[] = [];

  if (m.profiles?.length) {
    parts.push(m.profiles.map((p, i) => formatProfileBlock(p, i)).join('\n\n'));
  }

  if (m.content?.trim()) {
    parts.push(m.content.trim());
  }

  if (m.ownedNames?.length) {
    parts.push(
      'Registered names:\n' +
        m.ownedNames
          .map((n) => {
            const when = formatRegistered(n.registered);
            const primary = n.isPrimary ? ' (primary)' : '';
            return `• ${n.name}${primary} — ${when}`;
          })
          .join('\n')
    );
  }

  if (m.publishedSites?.length) {
    parts.push(
      'Published sites:\n' +
        m.publishedSites
          .map(
            (s) =>
              `• ${s.name} (${s.service === 'APP' ? 'Q-App' : 'Website'})`
          )
          .join('\n')
    );
  }

  if (m.quitterPosts?.length) {
    parts.push(
      'Recent Quitter:\n' +
        m.quitterPosts
          .map((p) => `• ${p.text.trim()}`)
          .filter((line) => line.length > 2)
          .join('\n')
    );
  }

  if (m.apps?.length) {
    parts.push(
      'Q-Apps:\n' +
        m.apps
          .map((a) => {
            const title = a.entry.title || a.entry.name;
            const summary = a.entry.summary?.trim();
            return summary ? `• ${title} — ${summary}` : `• ${title}`;
          })
          .join('\n')
    );
  }

  if (m.links?.length) {
    parts.push(
      'Links:\n' +
        m.links
          .map((l) => {
            const target =
              l.href ||
              (l.service && l.name
                ? `qortal://${l.service}/${l.name}`
                : '');
            return target ? `• ${l.label}: ${target}` : `• ${l.label}`;
          })
          .join('\n')
    );
  }

  if (m.media?.length) {
    parts.push(
      'Media:\n' +
        m.media
          .map((item) => {
            const title = item.title?.trim() || item.identifier || 'item';
            const by = item.name ? ` — ${item.name}` : '';
            return `• [${item.kind}] ${title}${by}`;
          })
          .join('\n')
    );
  }

  return parts.join('\n\n').trim();
}
