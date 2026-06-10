import { registerPlugin } from '@capacitor/core';

export interface NativePOWPlugin {
  computeProofOfWork(options: {
    chatBytes: unknown;
    difficulty: number;
  }): Promise<{ nonce: string | number }>;
}

const NativePOW = registerPlugin<NativePOWPlugin>('NativePOW');

export default NativePOW;
