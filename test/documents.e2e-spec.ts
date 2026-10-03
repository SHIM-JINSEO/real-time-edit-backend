import request from 'supertest';
import { createTestApp, TestApp } from './setup-app.js';

describe('Documents REST API (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('GET /api/health responds ok', async () => {
    await request(t.httpUrl)
      .get('/api/health')
      .expect(200)
      .expect((res) => expect(res.body.status).toBe('ok'));
  });

  it('runs the full CRUD + share-token lifecycle', async () => {
    // Create
    const created = await request(t.httpUrl)
      .post('/api/documents')
      .send({ title: 'CRDT talk', content: 'intro' })
      .expect(201);
    const { id, shareToken } = created.body;
    expect(id).toBeTruthy();
    expect(shareToken).toBeTruthy();
    expect(created.body).not.toHaveProperty('yjsState');

    // List (public, no tokens)
    const list = await request(t.httpUrl).get('/api/documents').expect(200);
    const item = list.body.find((d: any) => d.id === id);
    expect(item).toMatchObject({ title: 'CRDT talk' });
    expect(item).not.toHaveProperty('shareToken');
    expect(item).not.toHaveProperty('content');

    // Read requires a token
    await request(t.httpUrl).get(`/api/documents/${id}`).expect(401);
    await request(t.httpUrl)
      .get(`/api/documents/${id}`)
      .set('x-share-token', 'wrong')
      .expect(403);
    await request(t.httpUrl)
      .get(`/api/documents/${id}?token=${shareToken}`)
      .expect(200)
      .expect((res) => expect(res.body.content).toBe('intro'));

    // Share-link bootstrap
    await request(t.httpUrl)
      .get(`/api/documents/shared/${shareToken}`)
      .expect(200)
      .expect((res) => expect(res.body.id).toBe(id));
    await request(t.httpUrl).get('/api/documents/shared/nope').expect(404);

    // Update (goes through the live Y.Doc) and persists
    await request(t.httpUrl)
      .patch(`/api/documents/${id}`)
      .set('x-share-token', shareToken)
      .send({ title: 'CRDT talk v2', content: 'intro + body' })
      .expect(200)
      .expect((res) =>
        expect(res.body).toMatchObject({
          title: 'CRDT talk v2',
          content: 'intro + body',
        }),
      );
    await request(t.httpUrl)
      .get(`/api/documents/${id}`)
      .set('x-share-token', shareToken)
      .expect(200)
      .expect((res) => expect(res.body.title).toBe('CRDT talk v2'));

    // Validation
    await request(t.httpUrl)
      .patch(`/api/documents/${id}`)
      .set('x-share-token', shareToken)
      .send({ title: 123 })
      .expect(400);

    // Delete
    await request(t.httpUrl)
      .delete(`/api/documents/${id}`)
      .set('x-share-token', shareToken)
      .expect(204);
    await request(t.httpUrl)
      .get(`/api/documents/${id}`)
      .set('x-share-token', shareToken)
      .expect(404);
  });
});
