import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import RichTextEditor from '../components/RichTextEditor';
import api, { ApiError, fieldErrorsFrom } from '../lib/api';
import { EMPTY_DOC } from '../lib/editorDoc';

// Note editor serving both /notes/new (create) and /notes/:id (read, edit,
// delete, pin). Content is TipTap doc JSON end to end (architecture 5.3 #7):
// the rich editor loads note.content as-is and getJSON() goes back on save,
// with the Phase 08 rule kept - untouched content is not PATCHed.

// "work, home" -> ["work", "home"], trimmed, blanks dropped, case-insensitive
// dedupe with the first spelling kept (the backend dedupes the same way).
function parseTags(raw) {
  const seen = new Set();
  const tags = [];
  for (const piece of String(raw).split(',')) {
    const name = piece.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(name);
  }
  return tags;
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function networkMessage(error) {
  if (error instanceof ApiError) return error.message;
  return 'Could not reach the server. Check your connection and try again.';
}

export default function NoteEditorPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isCreate = !id;

  const [loadStatus, setLoadStatus] = useState(isCreate ? 'ready' : 'loading');
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);

  const [title, setTitle] = useState('');
  const [initialContent, setInitialContent] = useState('');
  const [tagsRaw, setTagsRaw] = useState('');
  const [isPinned, setIsPinned] = useState(false);
  const [updatedAt, setUpdatedAt] = useState('');

  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const cancelDeleteRef = useRef(null);
  // Filled by RichTextEditor's onCreate with { getJSON, isDirty, markClean };
  // a ref keeps the save path free of editor-state re-renders.
  const contentControl = useRef(null);

  // Move focus onto the safe choice when the confirm panel opens, so keyboard
  // users land inside the dialog instead of hunting for it (jsx-a11y keeps
  // us off the autoFocus prop).
  useEffect(() => {
    if (confirmingDelete && cancelDeleteRef.current) {
      cancelDeleteRef.current.focus();
    }
  }, [confirmingDelete]);

  useEffect(() => {
    if (isCreate) return undefined;
    let active = true;

    setLoadStatus('loading');
    setLoadError('');
    api
      .get(`/notes/${id}`)
      .then((payload) => {
        if (!active) return;
        const note = payload.note;
        setTitle(note.title || '');
        setInitialContent(note.content || '');
        setTagsRaw((note.tags || []).join(', '));
        setIsPinned(Boolean(note.isPinned));
        setUpdatedAt(note.updatedAt || '');
        setLoadStatus('ready');
      })
      .catch((error) => {
        if (!active) return;
        // Missing and foreign ids are the same 404 (architecture 6.5).
        if (error instanceof ApiError && error.status === 404) {
          setLoadStatus('notfound');
          return;
        }
        setLoadError(networkMessage(error));
        setLoadStatus('loaderror');
      });

    return () => {
      active = false;
    };
  }, [id, isCreate, reload]);

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError('');
    setFieldErrors({});
    setSavedNote(false);

    // Cheap client-side checks mirroring note.schemas.js; the server stays
    // the source of truth and its field errors land in fieldErrors below.
    const errors = {};
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      errors.title = 'Title must be at least 1 character';
    } else if (trimmedTitle.length > 200) {
      errors.title = 'Title must be at most 200 characters';
    }
    const tags = parseTags(tagsRaw);
    if (tags.length > 10) {
      errors.tags = 'A note can have at most 10 tags';
    } else if (tags.some((name) => name.length > 30)) {
      errors.tags = 'Tags must be at most 30 characters';
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSaving(true);
    try {
      const control = contentControl.current;
      if (isCreate) {
        const body = {
          title: trimmedTitle,
          content: control ? control.getJSON() : EMPTY_DOC,
          isPinned,
        };
        if (tags.length > 0) body.tags = tags;
        const created = await api.post('/notes', body);
        navigate(`/notes/${created.note.id}`, { replace: true });
      } else {
        const body = { title: trimmedTitle, tags, isPinned };
        // Content travels only when it changed, so a title-only save keeps
        // the original rich document untouched (Phase 08 behaviour kept).
        if (control && control.isDirty()) body.content = control.getJSON();
        const updated = await api.patch(`/notes/${id}`, body);
        if (control) control.markClean();
        setUpdatedAt(updated.note.updatedAt || '');
        setSavedNote(true);
      }
    } catch (error) {
      if (error instanceof ApiError) {
        const details = fieldErrorsFrom(error);
        if (Object.keys(details).length > 0) {
          setFieldErrors(details);
        } else {
          setFormError(error.message);
        }
      } else {
        setFormError('Could not reach the server. Check your connection and try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setFormError('');
    try {
      await api.del(`/notes/${id}`);
      navigate('/notes', { replace: true });
    } catch (error) {
      setFormError(networkMessage(error));
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  }

  if (!isCreate && loadStatus === 'loading') {
    return (
      <p className="route-loading" role="status">
        Loading note…
      </p>
    );
  }

  if (!isCreate && loadStatus === 'notfound') {
    return (
      <section className="page">
        <h1 className="page-title">Note not found</h1>
        <div className="empty-state">
          <h2 className="empty-title">This note is not available</h2>
          <p className="empty-copy">It may have been deleted, or it belongs to another account.</p>
          <p className="empty-copy">
            <Link className="btn btn-inline" to="/notes">
              Back to notes
            </Link>
          </p>
        </div>
      </section>
    );
  }

  if (!isCreate && loadStatus === 'loaderror') {
    return (
      <section className="page">
        <h1 className="page-title">Note unavailable</h1>
        <div className="banner banner-error" role="alert">
          <p>{loadError}</p>
          <button
            className="btn btn-inline"
            type="button"
            onClick={() => setReload((count) => count + 1)}
          >
            Try again
          </button>
        </div>
        <p className="empty-copy">
          <Link className="btn btn-inline" to="/notes">
            Back to notes
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section className="page note-editor">
      <div className="page-head">
        <div>
          <h1 className="page-title">{isCreate ? 'New note' : 'Edit note'}</h1>
          {!isCreate && updatedAt && (
            <p className="page-lede">Last updated {formatDate(updatedAt)}</p>
          )}
        </div>
        <Link className="btn" to="/notes">
          Back to notes
        </Link>
      </div>

      {formError && (
        <p className="banner banner-error" role="alert">
          {formError}
        </p>
      )}
      {savedNote && (
        <p className="banner banner-success" role="status">
          Changes saved.
        </p>
      )}

      <form className="form" noValidate onSubmit={handleSubmit}>
        <div className="field">
          <label className="label" htmlFor="note-title">
            Title
          </label>
          <input
            className="input"
            id="note-title"
            name="title"
            type="text"
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            aria-invalid={fieldErrors.title ? 'true' : undefined}
            aria-describedby={fieldErrors.title ? 'note-title-error' : undefined}
          />
          {fieldErrors.title && (
            <p className="field-error" id="note-title-error">
              {fieldErrors.title}
            </p>
          )}
        </div>

        <div className="field">
          <label className="label" htmlFor="note-content" id="note-content-label">
            Content
          </label>
          <RichTextEditor
            initialContent={initialContent}
            labelId="note-content-label"
            control={contentControl}
            invalid={Boolean(fieldErrors.content)}
            describedBy={fieldErrors.content ? 'note-content-error' : 'note-content-hint'}
          />
          {fieldErrors.content ? (
            <p className="field-error" id="note-content-error">
              {fieldErrors.content}
            </p>
          ) : (
            <p className="hint" id="note-content-hint">
              Format with the toolbar - bold, headings, lists and http/https/mailto links.
            </p>
          )}
        </div>

        <div className="field">
          <label className="label" htmlFor="note-tags">
            Tags
          </label>
          <input
            className="input"
            id="note-tags"
            name="tags"
            type="text"
            placeholder="work, ideas"
            value={tagsRaw}
            onChange={(event) => setTagsRaw(event.target.value)}
            aria-invalid={fieldErrors.tags ? 'true' : undefined}
            aria-describedby={fieldErrors.tags ? 'note-tags-error' : 'note-tags-hint'}
          />
          {fieldErrors.tags ? (
            <p className="field-error" id="note-tags-error">
              {fieldErrors.tags}
            </p>
          ) : (
            <p className="hint" id="note-tags-hint">
              Up to 10 tags, separated by commas.
            </p>
          )}
        </div>

        <label className="checkbox-inline" htmlFor="note-pinned">
          <input
            id="note-pinned"
            type="checkbox"
            checked={isPinned}
            onChange={(event) => setIsPinned(event.target.checked)}
          />
          Pin this note to the top of the list
        </label>

        <div className="editor-actions">
          <button className="btn btn-primary" type="submit" disabled={saving || deleting}>
            {saving ? 'Saving…' : isCreate ? 'Create note' : 'Save changes'}
          </button>
          {!isCreate && !confirmingDelete && (
            <button
              className="btn btn-danger"
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={saving || deleting}
            >
              Delete note
            </button>
          )}
        </div>

        {confirmingDelete && (
          <div
            className="confirm-panel"
            role="alertdialog"
            aria-labelledby="confirm-delete-title"
            aria-describedby="confirm-delete-copy"
          >
            <p className="confirm-title" id="confirm-delete-title">
              Delete this note?
            </p>
            <p className="confirm-copy" id="confirm-delete-copy">
              This permanently removes the note. It cannot be undone.
            </p>
            <div className="confirm-actions">
              <button
                className="btn btn-danger"
                type="button"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
              <button
                className="btn"
                type="button"
                ref={cancelDeleteRef}
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </form>
    </section>
  );
}
