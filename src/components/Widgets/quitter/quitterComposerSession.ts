import { atom, getDefaultStore } from 'jotai';
import type {
  PrepareVideoResult,
  VideoPrepareJob,
  CompressLevel,
} from './quitterVideoCompress';
import type { LibraryGif } from '../../Chat/gifs/libraryGifs';
import type { TorqDocNode } from './torqRichText';

export type SessionImageDraft = {
  id: string;
  file: File;
  previewUrl: string;
};

export type SessionFileDraft = {
  id: string;
  file: File;
  /** Shown on the post's file card; defaults to the file name. */
  title?: string;
  /** Published file name; defaults to the picked file's name. */
  filename?: string;
  /** Cover picture, already shrunk for publishing. */
  thumbnail?: File;
  thumbnailPreview?: string;
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

type QuitterComposerSession = {
  images: SessionImageDraft[];
  video: SessionVideoDraft | null;
  preparedVideo: PrepareVideoResult | null;
  compressPercent: number | null;
  compressLabel: string;
  status: string;
  error: string;
  compressJob: VideoPrepareJob | null;
  /** The post's body; null while nothing was written. */
  torqDoc: TorqDocNode | null;
  gifs: LibraryGif[];
  /** Null when the post has no poll. */
  pollChoices: string[] | null;
  pollAnonymous: boolean;
  files: SessionFileDraft[];
};

const emptySession = (): QuitterComposerSession => ({
  images: [],
  video: null,
  preparedVideo: null,
  compressPercent: null,
  compressLabel: '',
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

/**
 * Whether the Home composer is open (unfolded at the top of the Torq feed
 * window). Kept outside the composer, like the draft, so it survives a
 * remount, and so Home can show the window for a share while the feed is
 * turned off (the share intake opens it before the composer mounts).
 */
export const homeComposerOpenAtom = atom(false);

export function setHomeComposerOpen(open: boolean): void {
  getDefaultStore().set(homeComposerOpenAtom, open);
}

export function getQuitterComposerSession(): QuitterComposerSession {
  return session;
}

export function patchQuitterComposerSession(
  patch: Partial<QuitterComposerSession>
): void {
  session = { ...session, ...patch };
}

export function clearQuitterComposerSession(): void {
  session.images.forEach((img) => {
    if (img.previewUrl.startsWith('blob:')) URL.revokeObjectURL(img.previewUrl);
  });
  session.files.forEach((item) => {
    if (item.thumbnailPreview?.startsWith('blob:')) {
      URL.revokeObjectURL(item.thumbnailPreview);
    }
  });
  if (session.video?.previewUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(session.video.previewUrl);
  }
  session.compressJob?.cancel();
  session = emptySession();
  setHomeComposerOpen(false);
}
