import { EMPTY_DOC, docsEqual, isSafeLinkHref } from './editorDoc';

// The link policy mirrors the backend's editorContent.js whitelist; these
// helpers stay free of TipTap so they can be tested without ProseMirror.

describe('isSafeLinkHref', () => {
  it('accepts the three protocols the API allows', () => {
    expect(isSafeLinkHref('https://example.com/a?b=1')).toBe(true);
    expect(isSafeLinkHref('http://example.com')).toBe(true);
    expect(isSafeLinkHref('mailto:someone@example.com')).toBe(true);
  });

  it('rejects script-capable and non-absolute URLs', () => {
    expect(isSafeLinkHref('javascript:alert(1)')).toBe(false);
    expect(isSafeLinkHref('data:text/html,<script>x</script>')).toBe(false);
    expect(isSafeLinkHref('vbscript:msgbox(1)')).toBe(false);
    expect(isSafeLinkHref('/relative/path')).toBe(false);
    expect(isSafeLinkHref('example.com')).toBe(false);
    expect(isSafeLinkHref('')).toBe(false);
    expect(isSafeLinkHref('http://')).toBe(false);
  });
});

describe('docsEqual', () => {
  it('treats identical serializations as unchanged', () => {
    expect(docsEqual(EMPTY_DOC, { type: 'doc', content: [{ type: 'paragraph' }] })).toBe(true);
    expect(docsEqual(undefined, undefined)).toBe(true);
  });

  it('detects any difference the wire format would carry', () => {
    expect(docsEqual(EMPTY_DOC, { type: 'doc', content: [] })).toBe(false);
    expect(
      docsEqual(
        { type: 'doc', content: [{ type: 'paragraph' }] },
        {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'hi', marks: [{ type: 'bold' }] }],
            },
          ],
        },
      ),
    ).toBe(false);
  });
});

describe('EMPTY_DOC', () => {
  it('is one empty paragraph, which the backend accepts', () => {
    expect(EMPTY_DOC).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });
});
