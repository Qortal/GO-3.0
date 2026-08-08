/**
 * Minimal `electron` stand-in for running main-process chat modules inside the
 * mobile engine worker. Only `app.getPath` is consumed by the chat engine and
 * resource store (appData/temp/userData roots for its files). Paths returned
 * here are virtual roots inside the worker's OPFS-backed filesystem shim.
 */

export const app = {
  getPath(name: string): string {
    return `/qgo/${name}`;
  },
  getName(): string {
    return 'Qortal Go';
  },
};

export default { app };
