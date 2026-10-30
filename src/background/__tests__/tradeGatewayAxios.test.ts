import axios from 'axios';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * background.ts posts the trade gateway update with axios (the only axios call
 * in the app). This pins down the request it sends from a WebView-like page,
 * so a library upgrade that changes it shows up here: a JSON body, the JSON
 * content type, and nothing else added.
 */

type Seen = {
  method?: string;
  headers: IncomingMessage['headers'];
  body: string;
};

let server: Server;
let baseUrl = '';
const seen: Seen[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      seen.push({ method: req.method, headers: req.headers, body });
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'POST');
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('trade gateway post through axios', () => {
  it('sends the payload as JSON and reads the JSON reply', async () => {
    const payload = {
      qortalAtAddresses: ['AT1', 'AT2'],
      qortAddress: 'Qsender',
      node: 'https://node.example',
      status: 'message-sent',
      encryptedMessageToBase58: 'abc',
      signature: 'sig',
      reference: 'ref',
      senderPublicKey: 'pub',
      sender: 'Qsender',
    };

    const res = await axios.post(
      `${baseUrl}/api/transaction/updatetxgateway`,
      payload,
      { headers: { 'Content-Type': 'application/json' } }
    );

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ ok: true });

    const post = seen.find((entry) => entry.method === 'POST');
    expect(post).toBeDefined();
    // Sent by the page's XMLHttpRequest, as in the WebView: the Node http
    // adapter would not add the page origin.
    expect(post?.headers.origin).toBe(window.location.origin);
    expect(post?.headers['content-type']).toMatch(/^application\/json/);
    expect(JSON.parse(post?.body ?? '')).toEqual(payload);
    expect(post?.headers.authorization).toBeUndefined();
    expect(post?.headers['x-api-key']).toBeUndefined();
  });
});
