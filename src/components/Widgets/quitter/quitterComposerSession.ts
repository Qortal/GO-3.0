import type {
  PrepareVideoResult,
  VideoPrepareJob,
  CompressLevel,
} from './quitterVideoCompress';
import type { LibraryGif } from '../../Chat/gifs/libraryGifs';
import type { TorqDocNode } from './torqRichText';

export type ComposerTarget = 'quitter' | 'torq';

export type SessionImageDraft = {
  id: string;
  file: File;
  previewUrl: string;
};

export type SessionFileDraft = {
  id: string;
  file: File;
};

export type SessionVideoDraft = {
  file: File | null;
  nativePath?: string;
  mimeType?: string;
  size: number;
  previewUrl: string;
  fileName: string;
  title: string;
  description: string;
  category: number;
  duration: number;
  videoImage?: string;
  /** Q-Tube hover frames (4 data URLs). */
  extracts?: string[];
  compressLevel: CompressLevel;
};

export type QuitterComposerSession = {
  text: string;
  images: SessionImageDraft[];
  video: SessionVideoDraft | null;
  preparedVideo: PrepareVideoResult | null;
  compressPercent: number | null;
  compressLabel: string;
  expanded: boolean;
  status: string;
  error: string;
  compressJob: VideoPrepareJob | null;
  /** Torq body; null until the user first switches to Torq. */
  torqDoc: TorqDocNode | null;
  gifs: LibraryGif[];
  /** Null when the post has no poll. */
  pollChoices: string[] | null;
  pollAnonymous: boolean;
  files: SessionFileDraft[];
};

const emptySession = (): QuitterComposerSession => ({
  text: '',
  images: [],
  video: null,
  preparedVideo: null,
  compressPercent: null,
  compressLabel: '',
  expanded: false,
  status: '',
  error: '',
  compressJob: null,
  torqDoc: null,
  gifs: [],
  pollChoices: null,
  pollAnonymous: false,
  files: [],
});

let session: QuitterComposerSession = emptySession();
const listeners = new Set<() => void>();

export function getQuitterComposerSession(): QuitterComposerSession {
  return session;
}

export function patchQuitterComposerSession(
  patch: Partial<QuitterComposerSession>
): void {
  session = { ...session, ...patch };
  listeners.forEach((listener) => listener());
}

export function subscribeQuitterComposerSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearQuitterComposerSession(): void {
  session.images.forEach((img) => {
    if (img.previewUrl.startsWith('blob:')) URL.revokeObjectURL(img.previewUrl);
  });
  if (session.video?.previewUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(session.video.previewUrl);
  }
  session.compressJob?.cancel();
  session = emptySession();
  listeners.forEach((listener) => listener());
}

const TARGET_STORAGE_KEY = 'go-home-composer-target';

/** Quitter or Torq, as the user last chose it (survives restarts). */
export function readComposerTarget(): ComposerTarget {
  try {
    return localStorage.getItem(TARGET_STORAGE_KEY) === 'torq'
      ? 'torq'
      : 'quitter';
  } catch {
    return 'quitter';
  }
}

export function writeComposerTarget(target: ComposerTarget): void {
  try {
    localStorage.setItem(TARGET_STORAGE_KEY, target);
  } catch {
    // private mode / quota — the choice just won't persist
  }
}
