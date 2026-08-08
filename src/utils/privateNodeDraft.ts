import { getData, storeData } from './chromeStorage';

const STORAGE_KEY = 'qortalGoLastPrivateNode';

export type PrivateNodeDraft = {
  url: string;
  apikey: string;
};

export async function loadPrivateNodeDraft(): Promise<PrivateNodeDraft | null> {
  const stored = await getData<PrivateNodeDraft>(STORAGE_KEY);
  if (!stored || typeof stored !== 'object') return null;
  const url = typeof stored.url === 'string' ? stored.url.trim() : '';
  if (!url) return null;
  return {
    url,
    apikey: typeof stored.apikey === 'string' ? stored.apikey : '',
  };
}

export async function savePrivateNodeDraft(
  draft: PrivateNodeDraft
): Promise<void> {
  const url = draft.url.trim().replace(/\/+$/, '');
  if (!url) return;
  await storeData(STORAGE_KEY, {
    url,
    apikey: draft.apikey?.trim() || '',
  });
}
