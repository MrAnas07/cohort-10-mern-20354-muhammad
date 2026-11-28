// Helpers around TipTap doc JSON that deliberately do NOT import the editor
// package, so Jest can test them without booting ProseMirror (the page tests
// mock RichTextEditor instead).

// Mirrors the backend whitelist in utils/editorContent.js: links are limited
// to http/https/mailto (architecture 5.3 #7), so javascript: and data: URLs
// are rejected before they ever reach the API.
const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:'];

export function isSafeLinkHref(href) {
  try {
    return SAFE_PROTOCOLS.includes(new URL(String(href)).protocol);
  } catch {
    // Relative URLs and free text have no protocol to inspect - not safe.
    return false;
  }
}

// Exact equality for the "content unchanged -> do not PATCH it" rule. Both
// sides are serialized by TipTap with the same key order, so stringify is a
// faithful comparison of what would go on the wire.
export function docsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Fallback for the brief window before the editor instance exists: one empty
// paragraph, which passes backend validation like any other doc.
export const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };
