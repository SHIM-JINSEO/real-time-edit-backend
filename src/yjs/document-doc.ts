import * as Y from 'yjs';

// This file contains utility functions for managing Yjs documents, including reading and writing text content, applying updates, and creating initial states.
// It provides utility functions to work with Yjs documents in a collaborative editing context.

export const TITLE_KEY = 'title';
export const CONTENT_KEY = 'content';

export interface DocumentText {
  title: string;
  content: string;
}

export function readDocumentText(doc: Y.Doc): DocumentText {
  return {
    title: doc.getText(TITLE_KEY).toString(),
    content: doc.getText(CONTENT_KEY).toString(),
  };
}

// function to replace the text of a Y.Text object with a new string, minimizing the number of operations performed on the Yjs document.
export function replaceText(text: Y.Text, next: string): void {
  const prev = text.toString();
  if (prev === next) return;

  let start = 0; // start index of the first differing character
  const maxStart = Math.min(prev.length, next.length);
  while (start < maxStart && prev[start] === next[start]) start++;

  //end index of the last differing character in prev and next
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
  // if the Y.Text is associated with a Y.Doc, perform the update in a transaction(no intermediate states will be visible to observers)
  else run(); 
  // there is no Y.Doc associated with this Y.Text
}

// Apply a partial text update (title and/or content) to a Y.Doc in one transaction. */
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

// Build the binary Yjs state for a brand-new document. 
export function createInitialState(text: DocumentText): Uint8Array {
  const doc = new Y.Doc();
  applyDocumentText(doc, text);
  const state = Y.encodeStateAsUpdate(doc); // encodes CRDT state of the Y.Doc into a binary format
  doc.destroy();
  return state;
}

// Decode a stored Yjs state back into its plain-text snapshot. 
export function readStoredText(state: Uint8Array): DocumentText {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const text = readDocumentText(doc);
  doc.destroy();
  return text;
}
