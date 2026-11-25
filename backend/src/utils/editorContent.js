'use strict';

// Editor content rules (architecture 5.3 #7, 6.8 XSS defence): rich text is
// stored as structured Tiptap JSON, never HTML, and only whitelisted node and
// mark types may appear. The same JSON is flattened to plain text here, which
// feeds content_text (search) and the list excerpt - one derivation, two uses.

const MAX_CONTENT_BYTES = 256 * 1024;
const MAX_DEPTH = 100;
const MAX_HEADING_LEVEL = 3;

// Tiptap/ProseMirror node types the editor can produce for FR-N6, plus the
// structural types ("doc", "text", "listItem") the document needs.
const ALLOWED_NODES = new Set([
  'doc',
  'paragraph',
  'heading',
  'text',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'codeBlock',
]);

const ALLOWED_MARKS = new Set(['bold', 'italic', 'underline', 'link']);

// Link protocols limited to http/https/mailto (5.3 #7) - this is what blocks
// javascript: and data: URLs outright.
const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

// The only field names a node may carry. Anything else (an injected "script"
// key, for example) is rejected so the stored JSON stays predictable for the
// frontend renderer.
const ALLOWED_NODE_KEYS = new Set(['type', 'content', 'attrs', 'marks', 'text']);

// Block-level types terminate a line in the plain-text extraction.
const BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'blockquote',
  'codeBlock',
]);

function isAllowedLink(href) {
  try {
    return ALLOWED_LINK_PROTOCOLS.has(new URL(href).protocol);
  } catch {
    return false;
  }
}

function validateMark(mark, problems) {
  if (typeof mark !== 'object' || mark === null || Array.isArray(mark)) {
    problems.push('content contains a non-object mark');
    return;
  }
  if (typeof mark.type !== 'string' || !ALLOWED_MARKS.has(mark.type)) {
    problems.push(`content contains an unsupported mark type "${String(mark.type)}"`);
    return;
  }
  if (mark.type === 'link') {
    const href = mark.attrs ? mark.attrs.href : undefined;
    if (typeof href !== 'string' || !isAllowedLink(href)) {
      problems.push('links must use http, https or mailto');
    }
  }
}

function walkNode(node, depth, parentType, problems) {
  if (depth > MAX_DEPTH) {
    problems.push('content is nested too deeply');
    return;
  }
  if (typeof node !== 'object' || node === null || Array.isArray(node)) {
    problems.push('content contains a non-object node');
    return;
  }

  for (const key of Object.keys(node)) {
    if (!ALLOWED_NODE_KEYS.has(key)) {
      problems.push(`content contains an unsupported field "${key}"`);
      return;
    }
  }

  const type = node.type;
  if (typeof type !== 'string' || !ALLOWED_NODES.has(type)) {
    problems.push(`content contains an unsupported node type "${String(type)}"`);
    return;
  }

  if (type === 'heading') {
    const level = node.attrs ? node.attrs.level : undefined;
    if (!Number.isInteger(level) || level < 1 || level > MAX_HEADING_LEVEL) {
      problems.push(`headings must have a level between 1 and ${MAX_HEADING_LEVEL}`);
    }
  }

  if (node.marks !== undefined) {
    if (!Array.isArray(node.marks)) {
      problems.push('marks must be an array');
    } else if (node.marks.length > 0 && (type === 'codeBlock' || parentType === 'codeBlock')) {
      // Code is literal text: marks on the block or on its text children
      // would render as characters, so they are rejected instead.
      problems.push('code blocks cannot contain marks');
    } else {
      for (const mark of node.marks) validateMark(mark, problems);
    }
  }

  if (type === 'text' && typeof node.text !== 'string') {
    problems.push('text nodes must contain a string');
  }

  if (node.content !== undefined) {
    if (!Array.isArray(node.content)) {
      problems.push('node content must be an array');
    } else {
      for (const child of node.content) walkNode(child, depth + 1, type, problems);
    }
  }
}

// Returns every problem found (empty array means valid). Collecting instead
// of throwing on the first issue gives the client one detail per bad field.
function validateEditorContent(content) {
  const problems = [];

  if (typeof content !== 'object' || content === null || Array.isArray(content)) {
    problems.push('content must be an object');
    return problems;
  }

  let serialized;
  try {
    serialized = JSON.stringify(content);
  } catch {
    problems.push('content must be JSON-serializable');
    return problems;
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_CONTENT_BYTES) {
    problems.push('content must be at most 256 KB when serialized');
    return problems;
  }

  if (content.type !== 'doc') {
    problems.push('content root must have type "doc"');
    return problems;
  }

  walkNode(content, 0, null, problems);
  return problems;
}

// Flattens the document to readable plain text: text nodes are concatenated,
// block nodes end a line, repeated blank lines collapse. Used for search
// (content_text) and for the 200-character list excerpt.
function extractPlainText(doc) {
  const chunks = [];

  const visit = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return;
    if (node.type === 'text' && typeof node.text === 'string') {
      chunks.push(node.text);
      return;
    }
    const children = Array.isArray(node.content) ? node.content : [];
    for (const child of children) visit(child, depth + 1);
    if (BLOCK_TYPES.has(node.type)) chunks.push('\n');
  };

  visit(doc, 0);
  return chunks
    .join('')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

module.exports = { validateEditorContent, extractPlainText, MAX_CONTENT_BYTES };
