import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../context/AuthContext';
import NoteEditorPage from './NoteEditorPage.jsx';

// Editor contract (architecture 5.3 #7-#10): create posts title + doc-shaped
// content + tags, an edit loads GET /notes/:id and PATCHes changed fields,
// and a missing/foreign id lands on the friendly 404 state.

// TipTap itself is replaced by a textarea stand-in that speaks the same
// { getJSON, isDirty, markClean } contract, so these tests exercise the page
// without booting ProseMirror. The real serialization helpers live in
// src/lib/editorDoc.test.js.
jest.mock('../components/RichTextEditor', () => {
  const React = jest.requireActual('react');

  function docToText(doc) {
    if (!doc || typeof doc !== 'object') return '';
    const chunks = [];
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'text' && typeof node.text === 'string') {
        chunks.push(node.text);
        return;
      }
      for (const child of node.content || []) visit(child);
      if (node.type === 'paragraph' || node.type === 'heading') chunks.push('\n');
    };
    visit(doc);
    return chunks
      .join('')
      .replace(/\n{2,}/g, '\n')
      .trim();
  }

  function textToDoc(text) {
    return {
      type: 'doc',
      content: String(text)
        .split(/\r?\n/)
        .map((line) =>
          line
            ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
            : { type: 'paragraph' },
        ),
    };
  }

  function MockRichTextEditor({ initialContent, control }) {
    const [text, setText] = React.useState(() => docToText(initialContent));
    const textRef = React.useRef(text);
    textRef.current = text;
    const initialJsonRef = React.useRef(null);

    React.useEffect(() => {
      const currentJson = () => JSON.stringify(textToDoc(textRef.current));
      if (initialJsonRef.current === null) initialJsonRef.current = currentJson();
      control.current = {
        getJSON: () => textToDoc(textRef.current),
        isDirty: () => JSON.stringify(textToDoc(textRef.current)) !== initialJsonRef.current,
        markClean: () => {
          initialJsonRef.current = currentJson();
        },
      };
    }, [control]);

    return React.createElement('textarea', {
      id: 'note-content',
      className: 'input',
      value: text,
      onChange: (event) => setText(event.target.value),
    });
  }

  return { __esModule: true, default: MockRichTextEditor };
});

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

const unauthorized = {
  success: false,
  error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
};

const storedNote = {
  id: 'n1',
  title: 'Grocery list',
  content: {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Weekly shop' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Pantry restock' }] },
    ],
  },
  isPinned: true,
  tags: ['home'],
  createdAt: '2026-11-01T09:00:00.000Z',
  updatedAt: '2026-11-02T10:30:00.000Z',
};

function makeFetch(extraRoutes) {
  return jest.fn((url) => {
    const target = String(url);
    if (target.includes('/auth/me') || target.includes('/auth/refresh')) {
      return Promise.resolve(jsonResponse(401, unauthorized));
    }
    for (const [needle, response] of extraRoutes) {
      if (target.includes(needle)) return Promise.resolve(response);
    }
    return Promise.reject(new Error(`unexpected fetch: ${target}`));
  });
}

function renderCreate() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/notes/new']}>
        <Routes>
          <Route path="/notes/new" element={<NoteEditorPage />} />
          <Route path="/notes/:id" element={<p>Note detail opened</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

function renderDetail(path = '/notes/n1') {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/notes/new" element={<NoteEditorPage />} />
          <Route path="/notes/:id" element={<NoteEditorPage />} />
          <Route path="/notes" element={<p>Notes list</p>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

afterEach(() => {
  delete globalThis.fetch;
});

describe('note editor - create', () => {
  it('blocks an empty title without calling the API', async () => {
    globalThis.fetch = makeFetch([]);

    renderCreate();
    expect(await screen.findByRole('heading', { name: 'New note' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Create note' }));

    expect(await screen.findByText('Title must be at least 1 character')).toBeInTheDocument();
    // Bootstrap posts to /auth/refresh, so scope the check to note creation.
    const posted = globalThis.fetch.mock.calls.some(
      ([url, init]) => init && init.method === 'POST' && String(url).includes('/notes'),
    );
    expect(posted).toBe(false);
  });

  it('posts the note with doc-shaped content and tags, then opens it', async () => {
    globalThis.fetch = makeFetch([
      [
        '/notes',
        Promise.resolve(
          jsonResponse(201, {
            success: true,
            data: { note: { id: 'n9', title: 'Meeting notes' } },
          }),
        ),
      ],
    ]);

    renderCreate();
    await userEvent.type(screen.getByLabelText('Title'), 'Meeting notes');
    await userEvent.type(screen.getByLabelText('Content'), 'Discuss roadmap');
    await userEvent.type(screen.getByLabelText('Tags'), 'work, planning, Work');
    await userEvent.click(screen.getByRole('button', { name: 'Create note' }));

    expect(await screen.findByText('Note detail opened')).toBeInTheDocument();

    const call = globalThis.fetch.mock.calls.find(
      ([url, init]) => init && init.method === 'POST' && String(url).includes('/notes'),
    );
    expect(call).toBeTruthy();
    const [url, init] = call;
    expect(String(url)).toBe('/api/v1/notes');
    expect(init.credentials).toBe('include');
    expect(init.headers['X-Requested-With']).toBe('notes-app');

    const body = JSON.parse(init.body);
    expect(body.title).toBe('Meeting notes');
    expect(body.content).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Discuss roadmap' }] }],
    });
    // Case-insensitive dedupe keeps the first spelling.
    expect(body.tags).toEqual(['work', 'planning']);
    expect(body.isPinned).toBe(false);
  });
});

describe('note editor - detail and edit', () => {
  it('loads the note into the form and PATCHes only what changed', async () => {
    // One handler serves both GET and PATCH: the response is a valid note
    // envelope either way, and the assertions inspect the request itself.
    globalThis.fetch = makeFetch([
      [
        '/notes/n1',
        Promise.resolve(jsonResponse(200, { success: true, data: { note: storedNote } })),
      ],
    ]);

    renderDetail();

    const titleInput = await screen.findByLabelText('Title');
    await waitFor(() => expect(titleInput).toHaveValue('Grocery list'));
    expect(screen.getByLabelText('Content')).toHaveValue('Weekly shop\nPantry restock');
    expect(screen.getByLabelText('Tags')).toHaveValue('home');
    expect(screen.getByLabelText(/Pin this note/)).toBeChecked();

    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, 'Grocery list v2');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      const call = globalThis.fetch.mock.calls.find(([, init]) => init && init.method === 'PATCH');
      expect(call).toBeTruthy();
      const [url, init] = call;
      expect(String(url)).toBe('/api/v1/notes/n1');
      expect(init.headers['X-Requested-With']).toBe('notes-app');
      const body = JSON.parse(init.body);
      expect(body.title).toBe('Grocery list v2');
      expect(body.tags).toEqual(['home']);
      expect(body.isPinned).toBe(true);
      // Untouched content is not resent, so the stored doc survives.
      expect(body).not.toHaveProperty('content');
    });

    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
  });

  it('includes content in PATCH only when the editor changed', async () => {
    globalThis.fetch = makeFetch([
      [
        '/notes/n1',
        Promise.resolve(jsonResponse(200, { success: true, data: { note: storedNote } })),
      ],
    ]);

    renderDetail();
    const content = await screen.findByLabelText('Content');
    await waitFor(() => expect(content).toHaveValue('Weekly shop\nPantry restock'));

    await userEvent.clear(content);
    await userEvent.type(content, 'Weekly shop and more');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => {
      const call = globalThis.fetch.mock.calls.find(([, init]) => init && init.method === 'PATCH');
      expect(call).toBeTruthy();
      const body = JSON.parse(call[1].body);
      expect(body.title).toBe('Grocery list');
      expect(body.content).toEqual({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Weekly shop and more' }] }],
      });
    });
    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
  });

  it('shows the friendly 404 state for a missing or foreign note', async () => {
    globalThis.fetch = makeFetch([
      [
        '/notes/nope',
        Promise.resolve(
          jsonResponse(404, {
            success: false,
            error: { code: 'NOT_FOUND', message: 'Note not found' },
          }),
        ),
      ],
    ]);

    renderDetail('/notes/nope');

    expect(await screen.findByRole('heading', { name: 'Note not found' })).toBeInTheDocument();
    expect(screen.getByText(/belongs to another account/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to notes' })).toHaveAttribute('href', '/notes');
  });
});
