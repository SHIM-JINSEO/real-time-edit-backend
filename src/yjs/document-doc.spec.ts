import * as Y from 'yjs';
import {
  applyDocumentText,
  createInitialState,
  readDocumentText,
  readStoredText,
  replaceText,
} from './document-doc.js';

/** Two-way sync of two Y.Docs, the way Hocuspocus does over the wire. */
function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
}

describe('document-doc helpers', () => {
  it('round-trips title and content through the binary state', () => {
    const state = createInitialState({ title: 'Hello', content: 'World' });
    expect(readStoredText(state)).toEqual({ title: 'Hello', content: 'World' });
  });

  it('applies a partial patch without touching the other field', () => {
    const doc = new Y.Doc();
    applyDocumentText(doc, { title: 'A', content: 'B' });
    applyDocumentText(doc, { content: 'C' });
    expect(readDocumentText(doc)).toEqual({ title: 'A', content: 'C' });
  });

  it('replaceText only rewrites the differing middle section', () => {
    const doc = new Y.Doc();
    const text = doc.getText('t');
    text.insert(0, 'hello brave world');

    let inserted = '';
    let deleted = 0;
    text.observe((event) => {
      for (const op of event.delta) {
        if (op.insert) inserted += op.insert;
        if (op.delete) deleted += op.delete;
      }
    });

    replaceText(text, 'hello new world');
    expect(text.toString()).toBe('hello new world');
    expect(inserted).toBe('new');
    expect(deleted).toBe('brave'.length);
  });

  it('keeps concurrent edits from another peer when replacing text (CRDT merge)', () => {
    // Peer A and peer B start from the same document.
    const a = new Y.Doc();
    applyDocumentText(a, { title: 'T', content: 'The quick brown fox' });
    const b = new Y.Doc();
    sync(a, b);

    // Offline: A edits the end via the REST-style full replace,
    // while B types at the start.
    applyDocumentText(a, { content: 'The quick brown dog' });
    b.getText('content').insert(0, '>> ');

    sync(a, b);

    const merged = '>> The quick brown dog';
    expect(readDocumentText(a).content).toBe(merged);
    expect(readDocumentText(b).content).toBe(merged);
  });

  it('converges regardless of the order updates are applied', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const c = new Y.Doc();
    a.getText('content').insert(0, 'abc');
    sync(a, b);
    sync(a, c);

    a.getText('content').insert(3, '-A');
    b.getText('content').insert(0, 'B-');
    c.getText('content').delete(1, 1); // remove "b"

    const ua = Y.encodeStateAsUpdate(a);
    const ub = Y.encodeStateAsUpdate(b);
    const uc = Y.encodeStateAsUpdate(c);

    // Apply in different orders to fresh docs.
    const x = new Y.Doc();
    [ua, ub, uc].forEach((u) => Y.applyUpdate(x, u));
    const y = new Y.Doc();
    [uc, ua, ub].forEach((u) => Y.applyUpdate(y, u));

    expect(x.getText('content').toString()).toBe(
      y.getText('content').toString(),
    );
    expect(x.getText('content').toString()).toBe('B-ac-A');
  });
});
