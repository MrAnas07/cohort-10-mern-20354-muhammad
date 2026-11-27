import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api, { ApiError } from '../lib/api';

// Notes list (architecture 5.3 #6): one page of excerpts per request, with
// debounced search, tag and pinned filters, and a sort control. Rows never
// carry full content - the server sends a 200-character excerpt only.

const SORT_OPTIONS = [
  { value: 'updated_desc', label: 'Newest first' },
  { value: 'updated_asc', label: 'Oldest first' },
  { value: 'created_desc', label: 'Recently created' },
  { value: 'title_asc', label: 'Title A-Z' },
];

const SEARCH_DEBOUNCE_MS = 300;

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function NotesPage() {
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [sort, setSort] = useState('updated_desc');
  const [page, setPage] = useState(1);
  const [tagOptions, setTagOptions] = useState([]);

  const [notes, setNotes] = useState([]);
  const [meta, setMeta] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  // Out-of-order responses: only the newest request may touch state, so a
  // slow page-1 reply cannot overwrite the page-2 reply that followed it.
  const requestSeq = useRef(0);

  // Debounce the search box into the query the API actually receives.
  useEffect(() => {
    const timer = setTimeout(() => {
      const nextQuery = searchInput.trim();
      setQuery(nextQuery);
      setPage(1);
      setSort((current) => (current === 'relevance' && !nextQuery ? 'updated_desc' : current));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    const seq = ++requestSeq.current;
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    if (tag) params.set('tag', tag);
    if (pinnedOnly) params.set('pinned', 'true');
    params.set('sort', sort);
    params.set('page', String(page));

    setStatus('loading');
    setError('');
    api
      .get(`/notes?${params.toString()}`, { full: true })
      .then((payload) => {
        if (seq !== requestSeq.current) return;
        setNotes(Array.isArray(payload.data) ? payload.data : []);
        setMeta(payload.meta || null);
        setStatus('ready');
      })
      .catch((err) => {
        if (seq !== requestSeq.current) return;
        setError(
          err instanceof ApiError
            ? err.message
            : 'Could not reach the server. Check your connection and try again.',
        );
        setStatus('error');
      });
  }, [query, tag, pinnedOnly, sort, page, reload]);

  // Tag filter options come from their own endpoint; if that call fails the
  // filter simply stays hidden rather than breaking the whole page.
  useEffect(() => {
    let active = true;
    api
      .get('/tags')
      .then((data) => {
        if (active && Array.isArray(data)) setTagOptions(data);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const hasFilters = Boolean(query || tag || pinnedOnly);

  function resetPage() {
    setPage(1);
  }

  function clearFilters() {
    setSearchInput('');
    setQuery('');
    setTag('');
    setPinnedOnly(false);
    setSort('updated_desc');
    setPage(1);
  }

  const sortOptions =
    sort === 'relevance' || query
      ? [...SORT_OPTIONS, { value: 'relevance', label: 'Best match' }]
      : SORT_OPTIONS;

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Your notes</h1>
          <p className="page-lede">Search, open and update the notes in your workspace.</p>
        </div>
        <Link className="btn btn-primary" to="/notes/new">
          New note
        </Link>
      </div>

      <div className="note-controls">
        <div className="field control-search">
          <label className="label" htmlFor="notes-search">
            Search notes
          </label>
          <input
            className="input"
            id="notes-search"
            type="search"
            placeholder="Title and content"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        {tagOptions.length > 0 && (
          <div className="field">
            <label className="label" htmlFor="notes-tag">
              Tag
            </label>
            <select
              className="input"
              id="notes-tag"
              value={tag}
              onChange={(event) => {
                setTag(event.target.value);
                resetPage();
              }}
            >
              <option value="">All tags</option>
              {tagOptions.map((option) => (
                <option key={option.name} value={option.name}>
                  {option.name} ({option.noteCount})
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="field">
          <label className="label" htmlFor="notes-sort">
            Sort
          </label>
          <select
            className="input"
            id="notes-sort"
            value={sort}
            onChange={(event) => {
              setSort(event.target.value);
              resetPage();
            }}
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <label className="checkbox-inline" htmlFor="notes-pinned">
          <input
            id="notes-pinned"
            type="checkbox"
            checked={pinnedOnly}
            onChange={(event) => {
              setPinnedOnly(event.target.checked);
              resetPage();
            }}
          />
          Pinned only
        </label>
      </div>

      {hasFilters && (
        <button className="btn btn-quiet btn-inline" type="button" onClick={clearFilters}>
          Clear filters
        </button>
      )}

      {status === 'loading' && (
        <p className="route-loading" role="status">
          Loading notes…
        </p>
      )}

      {status === 'error' && (
        <div className="banner banner-error" role="alert">
          <p>{error}</p>
          <button
            className="btn btn-inline"
            type="button"
            onClick={() => setReload((count) => count + 1)}
          >
            Try again
          </button>
        </div>
      )}

      {status === 'ready' && notes.length === 0 && (
        <div className="empty-state">
          <h2 className="empty-title">
            {hasFilters ? 'No notes match your filters' : 'No notes yet'}
          </h2>
          <p className="empty-copy">
            {hasFilters
              ? 'Try a different search term or clear the filters.'
              : 'Create your first note to get started.'}
          </p>
          {hasFilters ? (
            <p className="empty-copy">
              <button className="btn btn-inline" type="button" onClick={clearFilters}>
                Clear filters
              </button>
            </p>
          ) : (
            <p className="empty-copy">
              <Link className="btn btn-primary btn-inline" to="/notes/new">
                New note
              </Link>
            </p>
          )}
        </div>
      )}

      {status === 'ready' && notes.length > 0 && (
        <ul className="note-list">
          {notes.map((note) => (
            <li className="note-item" key={note.id}>
              <Link className="note-item-link" to={`/notes/${note.id}`}>
                <span className="note-item-head">
                  <span className="note-item-title">{note.title}</span>
                  {note.isPinned && <span className="pin-badge">Pinned</span>}
                </span>
                <span className="note-item-excerpt">
                  {note.excerpt ? note.excerpt : 'No content yet.'}
                </span>
                <span className="note-item-meta">
                  <span className="note-tags">
                    {(note.tags || []).map((name) => (
                      <span className="tag-chip" key={name}>
                        {name}
                      </span>
                    ))}
                  </span>
                  <span className="note-date">Updated {formatDate(note.updatedAt)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {status === 'ready' && meta && meta.totalPages > 1 && (
        <nav className="pagination" aria-label="Notes pages">
          <button
            className="btn"
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            Previous
          </button>
          <span className="page-status">
            Page {meta.page} of {meta.totalPages} · {meta.total} notes
          </span>
          <button
            className="btn"
            type="button"
            disabled={page >= meta.totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}
