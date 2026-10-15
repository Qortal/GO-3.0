// Dev-only: the main config without the file watcher, for preview pages when
// the machine's inotify limit is used up by other servers. No hot reload.
import base from '../../vite.config';

export default {
  ...base,
  server: { ...(base as any).server, watch: null },
};
