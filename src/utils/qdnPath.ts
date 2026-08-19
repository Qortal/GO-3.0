/** Encode one QDN path segment without double-encoding. */
export function encodeQdnPathSegment(value: unknown): string {
  const rawValue = String(value ?? '');
  try {
    return encodeURIComponent(decodeURIComponent(rawValue));
  } catch {
    return encodeURIComponent(rawValue);
  }
}

export function qdnResourcePath(location: {
  service: string;
  name: string;
  identifier?: string;
}): string {
  const parts = [
    encodeQdnPathSegment(location.service),
    encodeQdnPathSegment(location.name),
  ];
  if (location.identifier) {
    parts.push(encodeQdnPathSegment(location.identifier));
  }
  return parts.join('/');
}
