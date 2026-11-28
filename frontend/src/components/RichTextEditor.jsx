import { useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { isSafeLinkHref } from '../lib/editorDoc';

// Rich text surface for note content. The schema is pinned to the backend
// whitelist (utils/editorContent.js): StarterKit ships strike, code marks,
// hard breaks and horizontal rules by default, and the API rejects all four,
// so they are disabled here rather than filtered on save. Headings stop at
// level 3 for the same reason.

const STARTER_KIT = StarterKit.configure({
  heading: { levels: [1, 2, 3] },
  strike: false,
  code: false,
  hardBreak: false,
  horizontalRule: false,
  link: {
    openOnClick: false,
    protocols: ['http', 'https', 'mailto'],
  },
});

function ToolbarButton({ label, active, disabled, onClick, className, children }) {
  return (
    <button
      className={`editor-btn${className ? ` ${className}` : ''}`}
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}

export default function RichTextEditor({ initialContent, labelId, control, invalid, describedBy }) {
  const [linkError, setLinkError] = useState('');

  const editor = useEditor({
    // Created in an effect rather than during render: onCreate then runs
    // outside the render phase, and the parent only ever touches a ref.
    immediatelyRender: false,
    extensions: [STARTER_KIT],
    content: initialContent || '',
    onCreate: ({ editor: created }) => {
      // Capture the post-load (normalized) JSON once, so an untouched editor
      // compares equal at save time and PATCH skips the content field.
      let initialJson = JSON.stringify(created.getJSON());
      control.current = {
        getJSON: () => created.getJSON(),
        isDirty: () => JSON.stringify(created.getJSON()) !== initialJson,
        markClean: () => {
          initialJson = JSON.stringify(created.getJSON());
        },
      };
    },
    editorProps: {
      attributes: {
        id: 'note-content',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-labelledby': labelId,
        ...(invalid ? { 'aria-invalid': 'true' } : {}),
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
      },
    },
  });

  function handleLink() {
    if (!editor) return;
    setLinkError('');

    if (editor.isActive('link')) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    const answer = window.prompt('Link URL', 'https://');
    if (answer === null) return;
    const href = answer.trim();
    if (!href) return;
    if (!isSafeLinkHref(href)) {
      setLinkError('Links must start with http://, https:// or mailto:.');
      return;
    }

    const { from, to } = editor.state.selection;
    if (from === to) {
      // Nothing selected: insert the URL as the link text.
      editor
        .chain()
        .focus()
        .insertContent([{ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }])
        .run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    }
  }

  return (
    <div className="editor-shell">
      <div className="editor-toolbar" role="group" aria-label="Formatting">
        <ToolbarButton
          label="Bold"
          className="editor-btn-strong"
          active={editor?.isActive('bold')}
          disabled={!editor}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          B
        </ToolbarButton>
        <ToolbarButton
          label="Italic"
          className="editor-btn-em"
          active={editor?.isActive('italic')}
          disabled={!editor}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          I
        </ToolbarButton>
        <ToolbarButton
          label="Heading 1"
          active={editor?.isActive('heading', { level: 1 })}
          disabled={!editor}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          H1
        </ToolbarButton>
        <ToolbarButton
          label="Heading 2"
          active={editor?.isActive('heading', { level: 2 })}
          disabled={!editor}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          H2
        </ToolbarButton>
        <ToolbarButton
          label="Heading 3"
          active={editor?.isActive('heading', { level: 3 })}
          disabled={!editor}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          H3
        </ToolbarButton>
        <ToolbarButton
          label="Bulleted list"
          active={editor?.isActive('bulletList')}
          disabled={!editor}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          •
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list"
          active={editor?.isActive('orderedList')}
          disabled={!editor}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          1.
        </ToolbarButton>
        <ToolbarButton
          label={editor?.isActive('link') ? 'Remove link' : 'Add link'}
          active={editor?.isActive('link')}
          disabled={!editor}
          onClick={handleLink}
        >
          Link
        </ToolbarButton>
        <ToolbarButton
          label="Clear formatting"
          disabled={!editor}
          onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
        >
          Clear
        </ToolbarButton>
      </div>

      {linkError && (
        <p className="field-error editor-link-error" role="alert">
          {linkError}
        </p>
      )}

      <EditorContent editor={editor} />
    </div>
  );
}
