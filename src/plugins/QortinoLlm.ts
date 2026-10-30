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
  availStorageBytes: number;
  totalStorageBytes: number;
  recommendedPack: 'small' | 'medium' | string;
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

export type QortinoCompleteOptions = {
  system?: string;
  messages: QortinoChatMessage[];
  contextChunks?: Array<string | { text: string }>;
  maxTokens?: number;
  temperature?: number;
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
  extractZip(options: {
    zipRelativePath?: string;
    zipAbsolutePath?: string;
    destRelativePath?: string;
  }): Promise<{ extractedFiles: number; destDir: string }>;
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
  loadModel(options: {
    path: string;
    nCtx?: number;
    nThreads?: number;
  }): Promise<{ loaded: boolean; path: string }>;
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
          recommendedPack: 'small',
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
      async extractZip() {
        throw new Error('QortinoLlm.extractZip is only available on native');
      },
      async downloadUrl() {
        throw new Error('QortinoLlm.downloadUrl is only available on native');
      },
      async cancelDownload() {},
      async loadModel() {
        throw new Error('QortinoLlm is only available on the native app');
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
