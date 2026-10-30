/**
 * Shared pdf.js loader (from /public/pdfjs) for the book reader.
 */

export type PdfJsLib = {
  GlobalWorkerOptions: { workerSrc: string };
  /** Operator codes, for walking a page's operator list. */
  OPS?: Record<string, number>;
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
          transform: number[];
        };
        getOperatorList?: () => Promise<{
          fnArray: ArrayLike<number>;
          argsArray: ArrayLike<unknown>;
        }>;
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
