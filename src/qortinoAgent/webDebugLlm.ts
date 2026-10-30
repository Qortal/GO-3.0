/**
 * Browser/PC stand-in for the native QortinoLlm Capacitor plugin.
 * Used by the phone-framed debug page so QDN + chat can be exercised without Android.
 *
 * Answer backends (in order):
 * 1. Ollama at http://127.0.0.1:11434 (if running)
 * 2. Grounded synthesizer from injected context chunks (fast QDN debugging)
 */
import { WebPlugin } from '@capacitor/core';
import type {
  QortinoCompleteOptions,
  QortinoDeviceTier,
  QortinoLlmPlugin,
  QortinoLlmStatus,
  QortinoStoragePaths,
} from '../plugins/QortinoLlm';

const OLLAMA_BASE = 'http://127.0.0.1:11434';

let modelLoaded = false;
let completing = false;
let cancelRequested = false;

function chunkText(c: string | { text: string }): string {
  return typeof c === 'string' ? c : c.text;
}

async function pickOllamaModel(): Promise<string | null> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(1200),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    const names = (data.models || []).map((m) => m.name || '').filter(Boolean);
    if (!names.length) return null;
    const prefer =
      names.find((n) => /qwen|llama3|mistral|gemma|phi/i.test(n)) || names[0];
    return prefer;
  } catch {
    return null;
  }
}

async function completeWithOllama(
  model: string,
  options: QortinoCompleteOptions,
  onToken: (token: string, done: boolean) => void
): Promise<string> {
  const context = (options.contextChunks || []).map(chunkText).filter(Boolean);
  const system =
    (options.system || 'You are Qortino.') +
    (context.length
      ? `\n\nRetrieved notes:\n${context.map((t, i) => `[${i + 1}] ${t}`).join('\n\n')}`
      : '');

  const messages = [
    { role: 'system', content: system },
    ...options.messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
  ];

  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      options: {
        temperature: options.temperature ?? 0.7,
        num_predict: options.maxTokens ?? 360,
      },
    }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`Ollama chat failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = '';
  let buffer = '';
  while (!cancelRequested) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const row = JSON.parse(trimmed) as {
          message?: { content?: string };
          done?: boolean;
        };
        const piece = row.message?.content || '';
        if (piece) {
          full += piece;
          onToken(piece, false);
        }
      } catch {
        /* ignore partial JSON */
      }
    }
  }
  onToken('', true);
  return full;
}

/** Fast grounded reply for QDN debugging when Ollama isn't running. */
function synthesizeFromContext(options: QortinoCompleteOptions): string {
  const context = (options.contextChunks || []).map(chunkText).filter(Boolean);
  const lastUser =
    [...options.messages].reverse().find((m) => m.role === 'user')?.content ||
    '';

  if (!context.length) {
    return (
      `[PC debug · no QDN notes / no Ollama]\n` +
      `I didn't get QDN context for “${lastUser.slice(0, 80)}”. ` +
      `Check the name lookup, or start Ollama locally for freer answers.`
    );
  }

  const joined = context.join('\n\n');
  // Prefer MA Helper–style ready prose when present.
  const ready =
    joined.match(
      /\[READY-TO-USE (?:NOMINATION|PROFILE SUMMARY)[^\]]*\]\n[\s\S]*?\n\n([\s\S]+?)(?=\n\[QDN |\nPlayable QDN media|$)/i
    )?.[1]?.trim() ||
    joined.match(
      /PORTFOLIO-STYLE PROFILE SUMMARY[\s\S]*?:\n([\s\S]+?)(?=\n\[QDN |\nPlayable QDN media|$)/i
    )?.[1]?.trim();
  if (ready && ready.length > 80) {
    return ready;
  }

  const role =
    joined.match(/Role statement:\s*(.+)/i)?.[1]?.trim() ||
    joined.match(/^(.*(?:Founder|Minter|Admin|non-minter).+)$/im)?.[1]?.trim();
  const name =
    joined.match(/QDN (?:dossier|user scan) for registered name "([^"]+)"/i)?.[1] ||
    joined.match(/\[QDN user scan · ([^\]]+)\]/)?.[1];
  const level = joined.match(/Account level:\s*(\d+)/i)?.[1];
  const tags = joined.match(/Tags \/ roles:\s*(.+)/i)?.[1]?.trim();
  const mediaLines = [...joined.matchAll(/^\d+\.\s*\[(video|audio|image|pdf|file)\]\s*(.+)$/gim)]
    .slice(0, 6)
    .map((m) => `• ${m[1]}: ${m[2].trim()}`);

  const publishBits = [...joined.matchAll(/^- \[(Q-Blog|Q-Tube|Quitter)\]\s*(.+)$/gim)]
    .slice(0, 3)
    .map((m) => `• ${m[1]}: ${m[2].trim()}`);

  const lines = [
    name ? `${name}${level ? ` · level ${level}` : ''}` : null,
    role || (tags ? `Roles: ${tags}` : null),
    publishBits.length ? `Recent publishes:\n${publishBits.join('\n')}` : null,
    mediaLines.length
      ? `Playable media on the cards below:\n${mediaLines.join('\n')}`
      : null,
  ].filter(Boolean);

  return lines.join('\n\n');
}

async function streamText(
  text: string,
  onToken: (token: string, done: boolean) => void
): Promise<void> {
  const parts = text.split(/(\s+)/);
  for (const part of parts) {
    if (cancelRequested) break;
    if (!part) continue;
    onToken(part, false);
    await new Promise((r) => window.setTimeout(r, part.trim() ? 12 : 0));
  }
  onToken('', true);
}

export class QortinoLlmWebDebug extends WebPlugin implements QortinoLlmPlugin {
  async getDeviceTier(): Promise<QortinoDeviceTier> {
    return {
      totalRamBytes: 16 * 1024 ** 3,
      availRamBytes: 8 * 1024 ** 3,
      availStorageBytes: 40 * 1024 ** 3,
      totalStorageBytes: 128 * 1024 ** 3,
      recommendedPack: 'small',
      lowMemory: false,
    };
  }

  async getStoragePaths(): Promise<QortinoStoragePaths> {
    return {
      rootDir: '/tmp/qortino-agent-debug',
      modelsDir: '/tmp/qortino-agent-debug/models',
      knowledgeDir: '/tmp/qortino-agent-debug/knowledge',
    };
  }

  async writeChunk() {
    throw new Error('writeChunk not used in PC debug');
  }
  async fileExists() {
    return { exists: true, path: 'web-debug', size: 1 };
  }
  async readText() {
    throw new Error('readText not used in PC debug');
  }
  async deletePath() {
    return { deleted: false };
  }
  async extractZip() {
    throw new Error('extractZip not used in PC debug');
  }
  async downloadUrl() {
    throw new Error('downloadUrl not used in PC debug');
  }
  async copyFileIntoAgent() {
    throw new Error('copyFileIntoAgent not used in PC debug');
  }
  async cancelDownload() {}

  async loadModel() {
    modelLoaded = true;
    return { loaded: true, path: 'web-debug' };
  }

  async loadEmbedder() {
    return { loaded: true, path: 'web-debug-embed' };
  }

  async unload() {
    modelLoaded = false;
  }

  async cancel() {
    cancelRequested = true;
    completing = false;
  }

  async getStatus(): Promise<QortinoLlmStatus> {
    return {
      modelLoaded,
      embedderLoaded: false,
      completing,
      javaUsedMemoryBytes: 0,
      javaMaxMemoryBytes: 0,
    };
  }

  async embed() {
    return { vector: [0], dimensions: 1 };
  }

  async complete(options: QortinoCompleteOptions) {
    cancelRequested = false;
    completing = true;
    const emit = (token: string, done: boolean, error?: string) => {
      void this.notifyListeners('token', { token, done, error });
    };
    const progress = (detail: string, percent: number) => {
      void this.notifyListeners('progress', {
        stage: 'complete',
        detail,
        percent,
      });
    };

    try {
      console.info('[Qortino Debug] complete()', {
        messages: options.messages,
        contextChunks: options.contextChunks,
        maxTokens: options.maxTokens,
      });

      progress('Checking for local Ollama…', 8);
      const model = await pickOllamaModel();
      let text = '';
      if (model) {
        progress(`Streaming from Ollama · ${model}`, 20);
        text = await completeWithOllama(model, options, emit);
      } else {
        progress('No Ollama — grounding from QDN notes…', 30);
        text = synthesizeFromContext(options);
        await streamText(text, emit);
      }
      return { ok: true, text };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'PC debug complete failed';
      emit('', true, msg);
      return { ok: false, text: msg };
    } finally {
      completing = false;
    }
  }
}

export function isQortinoWebDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('qortinoDebug') === '1') return true;
    if (window.location.pathname.endsWith('qortino-debug.html')) return true;
    if (window.location.hash.includes('qortino-debug')) return true;
  } catch {
    /* ignore */
  }
  return false;
}
