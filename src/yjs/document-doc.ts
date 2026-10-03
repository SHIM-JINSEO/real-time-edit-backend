import * as Y from 'yjs';

/**
 * Shape of a collaborative document inside a Y.Doc.
 *
 * Both the title and the body are `Y.Text` CRDT types, so every connected
 * client (and the REST API, through a Hocuspocus direct connection) edits the
 * same conflict-free structure.
 */
export const TITLE_KEY = 'title';
export const CONTENT_KEY = 'content';

export interface DocumentText {
  title: string;
  content: string;
}

/** Read the current plain-text snapshot out of a Y.Doc. */
export function readDocumentText(doc: Y.Doc): DocumentText {
  return {
    title: doc.getText(TITLE_KEY).toString(),
    content: doc.getText(CONTENT_KEY).toString(),
  };
}

/**
 * Replace the value of a Y.Text with `next` using the smallest possible edit:
 * only the differing middle section is deleted/inserted. Keeping the common
 * prefix and suffix intact means concurrent edits by other peers in those
 * regions survive the merge instead of being clobbered.
 */
export function replaceText(text: Y.Text, next: string): void {
  const prev = text.toString();
  if (prev === next) return;

  let start = 0;
  const maxStart = Math.min(prev.length, next.length);
  while (start < maxStart && prev[start] === next[start]) start++;

  let endPrev = prev.length;
  let endNext = next.length;
  while (
    endPrev > start &&
    endNext > start &&
    prev[endPrev - 1] === next[endNext - 1]
  ) {
    endPrev--;
    endNext--;
  }

  const run = () => {
    if (endPrev > start) text.delete(start, endPrev - start);
    if (endNext > start) text.insert(start, next.slice(start, endNext));
  };
  if (text.doc) text.doc.transact(run);
  else run();
}

/** Apply a partial text update (title and/or content) to a Y.Doc in one transaction. */
export function applyDocumentText(
  doc: Y.Doc,
  patch: Partial<DocumentText>,
): void {
  doc.transact(() => {
    if (patch.title !== undefined) {
      replaceText(doc.getText(TITLE_KEY), patch.title);
    }
    if (patch.content !== undefined) {
      replaceText(doc.getText(CONTENT_KEY), patch.content);
    }
  });
}

/** Build the binary Yjs state for a brand-new document. */
export function createInitialState(text: DocumentText): Uint8Array {
  const doc = new Y.Doc();
  applyDocumentText(doc, text);
  const state = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return state;
}

/** Decode a stored Yjs state back into its plain-text snapshot. */
export function readStoredText(state: Uint8Array): DocumentText {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const text = readDocumentText(doc);
  doc.destroy();
  return text;
}
