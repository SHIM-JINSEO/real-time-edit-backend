import { HocuspocusProvider } from '@hocuspocus/provider';
import request from 'supertest';
import * as Y from 'yjs';
import { createTestApp, TestApp } from './setup-app.js';

/** Connect a Hocuspocus client and resolve once the first sync completes. */
function connect(opts: {
  url: string;
  name: string;
  token: string;
}): Promise<{ provider: HocuspocusProvider; doc: Y.Doc }> {
  const doc = new Y.Doc();
  return new Promise((resolve, reject) => {
    const provider = new HocuspocusProvider({
      url: opts.url,
      name: opts.name,
      token: opts.token,
      document: doc,
      onSynced: () => resolve({ provider, doc }),
      onAuthenticationFailed: ({ reason }) => {
        provider.destroy();
        reject(new Error(`auth failed: ${reason}`));
      },
    });
  });
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 5000,
  everyMs = 25,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

describe('Collaboration over WebSocket (e2e)', () => {
  let t: TestApp;
  let id: string;
  let shareToken: string;

  beforeAll(async () => {
    t = await createTestApp();
    const res = await request(t.httpUrl)
      .post('/api/documents')
      .send({ title: 'Shared', content: 'Hello' })
      .expect(201);
    id = res.body.id;
    shareToken = res.body.shareToken;
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('rejects a client with a wrong share token', async () => {
    await expect(
      connect({ url: t.wsUrl, name: id, token: 'wrong-token' }),
    ).rejects.toThrow(/auth failed/);
  });

  it('rejects a client for an unknown document', async () => {
    await expect(
      connect({ url: t.wsUrl, name: 'does-not-exist', token: shareToken }),
    ).rejects.toThrow(/auth failed/);
  });

  it('syncs the stored document to a new client', async () => {
    const { provider, doc } = await connect({
      url: t.wsUrl,
      name: id,
      token: shareToken,
    });
    expect(doc.getText('title').toString()).toBe('Shared');
    expect(doc.getText('content').toString()).toBe('Hello');
    provider.destroy();
  });

  it('two clients editing concurrently converge and the result is persisted', async () => {
    const a = await connect({ url: t.wsUrl, name: id, token: shareToken });
    const b = await connect({ url: t.wsUrl, name: id, token: shareToken });

    const stats = await request(t.httpUrl)
      .get('/api/collaboration/stats')
      .expect(200);
    expect(stats.body.connections).toBeGreaterThanOrEqual(2);

    // Both type "at the same time" at different positions.
    a.doc.getText('content').insert(5, ' from A');
    b.doc.getText('content').insert(0, 'B says: ');

    const expected = 'B says: Hello from A';
    await waitFor(
      () =>
        a.doc.getText('content').toString() === expected &&
        b.doc.getText('content').toString() === expected,
    );

    // Disconnecting the last client forces the debounced store to flush.
    a.provider.destroy();
    b.provider.destroy();

    await waitFor(() => false, 300).catch(() => undefined);
    const res = await request(t.httpUrl)
      .get(`/api/documents/${id}`)
      .set('x-share-token', shareToken)
      .expect(200);
    expect(res.body.content).toBe(expected);
  });

  it('a REST PATCH shows up live in a connected client', async () => {
    const a = await connect({ url: t.wsUrl, name: id, token: shareToken });

    await request(t.httpUrl)
      .patch(`/api/documents/${id}`)
      .set('x-share-token', shareToken)
      .send({ title: 'Renamed over REST' })
      .expect(200);

    await waitFor(
      () => a.doc.getText('title').toString() === 'Renamed over REST',
    );
    // Content untouched by the title-only patch.
    expect(a.doc.getText('content').toString()).toBe('B says: Hello from A');
    a.provider.destroy();
  });
});
