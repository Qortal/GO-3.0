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
}
