/**
 * Shared pdf.js loader (from /public/pdfjs) for the book reader and
 * first-page document thumbnails.
 */

export type PdfJsLib = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: {
    data: ArrayBuffer;
    /** false: fonts are drawn without compiling code from the PDF. */
    isEvalSupported?: boolean;
  }) => {
    promise: Promise<{
      numPages: number;
      getPage: (n: number) => Promise<{
        getViewport: (opts: { scale: number }) => {
          width: number;
          height: number;
        };
        render: (opts: {
          canvasContext: CanvasRenderingContext2D;
          viewport: { width: number; height: number };
        }) => { promise: Promise<void> };
      }>;
    }>;
  };
};

let pdfjsPromise: Promise<PdfJsLib> | null = null;

export async function loadPdfJs(): Promise<PdfJsLib> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const dynamicImport = new Function(
        'u',
        'return import(u)'
      ) as (u: string) => Promise<PdfJsLib>;
      const base = `${window.location.origin}/pdfjs/build`;
      const mod = await dynamicImport(`${base}/pdf.mjs`);
      mod.GlobalWorkerOptions.workerSrc = `${base}/pdf.worker.mjs`;
      return mod;
    })().catch((err) => {
      pdfjsPromise = null;
      throw err;
    });
  }
  return pdfjsPromise;
}

/** Heuristic: title / identifier / mime looks like a PDF. */
export function looksLikePdf(opts: {
  kind?: string;
  title?: string;
  identifier?: string;
  mime?: string;
}): boolean {
  if (opts.kind === 'pdf') return true;
  if (opts.mime?.includes('pdf')) return true;
  const blob = `${opts.title || ''} ${opts.identifier || ''}`;
  return /\.pdf(\b|$)/i.test(blob) || /\bpdf\b/i.test(opts.identifier || '');
}
