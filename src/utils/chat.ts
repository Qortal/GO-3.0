import { QORTAL_PROTOCOL } from '../constants/constants';

export function buildImageEmbedLink(image?: {
  name?: string;
  identifier?: string;
  service?: string;
  fileHash?: string;
  reticulumResource?: boolean;
  dataUrl?: string;
  base64?: string;
  mimeType?: string;
  libraryGif?: boolean;
  timestamp?: number;
}): string | null {
  if (image?.reticulumResource && image?.fileHash) return null;
  if (image?.dataUrl) return image.dataUrl;
  if (image?.base64) {
    return `data:${image.mimeType || 'image/webp'};base64,${image.base64}`;
  }
  if (!image?.name || !image.identifier || !image.service) return null;

  const isLibraryGif =
    image.libraryGif === true ||
    (image.service === 'IMAGE' &&
      String(image.identifier).startsWith('gif-')) ||
    image.mimeType === 'image/gif';
  const mimeType = isLibraryGif
    ? 'image%2Fgif'
    : image.mimeType
      ? encodeURIComponent(image.mimeType)
      : 'image%2Fpng';
  const base = `${QORTAL_PROTOCOL}use-embed/IMAGE?name=${image.name}&identifier=${image.identifier}&service=${image.service}&mimeType=${mimeType}&timestamp=${image?.timestamp || ''}`;

  const isEncrypted = image.identifier.startsWith('grp-q-manager_0');
  return isEncrypted ? `${base}&encryptionType=group` : base;
}

export const messageHasImage = (message) => {
  return (
    Array.isArray(message?.images) &&
    ((message.images[0]?.reticulumResource &&
      message.images[0]?.fileHash) ||
      message.images[0]?.dataUrl ||
      message.images[0]?.base64 ||
      (message.images[0]?.identifier &&
        message.images[0]?.name &&
        message.images[0]?.service))
  );
};

export function isHtmlString(value) {
  return typeof value === 'string' && /<[^>]+>/.test(value.trim());
}
