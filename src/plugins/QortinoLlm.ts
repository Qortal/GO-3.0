import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from '@capacitor/core';
import {
  isQortinoWebDebugEnabled,
  QortinoLlmWebDebug,
} from '../qortinoAgent/webDebugLlm';

export type QortinoDeviceTier = {
  totalRamBytes: number;
  availRamBytes: number;
  /** Free space on the volume the model is saved to. */
  availStorageBytes: number;
  totalStorageBytes: number;
  lowMemory: boolean;
};

export type QortinoStoragePaths = {
  rootDir: string;
  modelsDir: string;
  knowledgeDir: string;
};

export type QortinoChatMessage = {
  role: 'system' | 'user' | 'assistant' | string;
  content: string;
};

/** Sampler settings; the native side defaults to Qwen3 Instruct's own. */
export type QortinoSamplingOptions = {
  temperature?: number;
  topK?: number;
  topP?: number;
  minP?: number;
  repeatPenalty?: number;
  presencePenalty?: number;
};

export type QortinoCompleteOptions = QortinoSamplingOptions & {
  system?: string;
  messages: QortinoChatMessage[];
  contextChunks?: Array<string | { text: string }>;
  maxTokens?: number;
};

type QortinoTokenEvent = {
  token: string;
  done: boolean;
  error?: string;
};

type QortinoProgressEvent = {
  stage: string;
  detail: string;
  percent: number;
};

export interface QortinoLlmPlugin {
  getDeviceTier(): Promise<QortinoDeviceTier>;
  getStoragePaths(): Promise<QortinoStoragePaths>;
  fileExists(options: {
    relativePath?: string;
    absolutePath?: string;
  }): Promise<{ exists: boolean; path: string; size: number }>;
  readText(options: {
    relativePath?: string;
    absolutePath?: string;
  }): Promise<{ text: string; path: string }>;
  /** SHA-256 (lowercase hex) of a file under the Qortino storage root. */
  sha256File(options: {
    relativePath: string;
  }): Promise<{ sha256: string; size: number }>;
  /** Delete everything under the storage root except `keep` (relative paths). */
  cleanupStorage(options: {
    keep: string[];
  }): Promise<{ deletedFiles: number; freedBytes: number }>;
  /**
   * `url` must not carry the node API key: pass it as `apiKey`, which the
   * native side sends as an X-API-KEY header (native HTTP has no CORS).
   */
  downloadUrl(options: {
    apiKey?: string;
    url: string;
    relativePath: string;
  }): Promise<{ path: string; bytesWritten: number }>;
  cancelDownload(): Promise<void>;
  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (event: {
      bytesReceived: number;
      bytesTotal: number;
      done: boolean;
      error?: string;
    }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'verifyProgress',
    listenerFunc: (event: { bytesRead: number; bytesTotal: number }) => void
  ): Promise<PluginListenerHandle>;
  /**
   * Load a GGUF (for a split model, its first part). Thread and batch counts
   * default to what the native side picks for this phone.
   */
  loadModel(options: {
    path: string;
    nCtx?: number;
    nThreads?: number;
    /** Threads for reading prompts; defaults to nThreads. */
    nThreadsBatch?: number;
    nBatch?: number;
    nUbatch?: number;
  }): Promise<{ loaded: boolean; path: string; loadMs?: number }>;
  /** Read the system prompt into the KV cache ahead of the first question. */
  warmup(options: {
    system: string;
  }): Promise<{ ok?: boolean; warmMs?: number }>;
  unload(): Promise<void>;
  cancel(): Promise<void>;
  complete(
    options: QortinoCompleteOptions
  ): Promise<{ ok: boolean; text?: string }>;
  addListener(
    eventName: 'token',
    listenerFunc: (event: QortinoTokenEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'progress',
    listenerFunc: (event: QortinoProgressEvent) => void
  ): Promise<PluginListenerHandle>;
}

const QortinoLlm = registerPlugin<QortinoLlmPlugin>('QortinoLlm', {
  web: () => {
    // Phone-framed PC debug (qortino-debug.html) gets a working web LLM.
    if (isQortinoWebDebugEnabled()) {
      return new QortinoLlmWebDebug();
    }
    return {
      async getDeviceTier() {
        return {
          totalRamBytes: 8 * 1024 ** 3,
          availRamBytes: 4 * 1024 ** 3,
          availStorageBytes: 20 * 1024 ** 3,
          totalStorageBytes: 64 * 1024 ** 3,
          lowMemory: false,
        };
      },
      async getStoragePaths() {
        return {
          rootDir: '/tmp/qortino-agent',
          modelsDir: '/tmp/qortino-agent/models',
          knowledgeDir: '/tmp/qortino-agent/knowledge',
        };
      },
      async fileExists() {
        return { exists: false, path: '', size: 0 };
      },
      async readText() {
        throw new Error('QortinoLlm.readText is only available on native');
      },
      async sha256File() {
        throw new Error('QortinoLlm.sha256File is only available on native');
      },
      async cleanupStorage() {
        return { deletedFiles: 0, freedBytes: 0 };
      },
      async downloadUrl() {
        throw new Error('QortinoLlm.downloadUrl is only available on native');
      },
      async cancelDownload() {},
      async loadModel() {
        throw new Error('QortinoLlm is only available on the native app');
      },
      async warmup() {
        return {};
      },
      async unload() {},
      async cancel() {},
      async complete() {
        throw new Error('QortinoLlm is only available on the native app');
      },
      async addListener() {
        return { remove: async () => undefined };
      },
    };
  },
});

export function isQortinoLlmNativeAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

/** Native app, or the PC phone-frame debug page. */
export function isQortinoLlmInferenceAvailable(): boolean {
  return isQortinoLlmNativeAvailable() || isQortinoWebDebugEnabled();
}

export default QortinoLlm;
