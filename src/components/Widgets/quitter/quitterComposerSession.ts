import type {
  PrepareVideoResult,
  VideoPrepareJob,
  CompressLevel,
} from './quitterVideoCompress';

export type SessionImageDraft = {
  id: string;
  file: File;
  previewUrl: string;
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
