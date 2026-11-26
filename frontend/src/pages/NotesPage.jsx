import { useAuth } from '../context/AuthContext';

// Authenticated landing for this slice. The notes list, editor and tags
// arrive with the next frontend slice; until then this page proves the
// session end to end.
export default function NotesPage() {
  const { user } = useAuth();

  return (
    <section className="page">
      <h1 className="page-title">Your notes</h1>
      <p className="page-lede">
        Signed in as {user.email}. The workspace for writing, searching and tagging notes arrives in
        the next release.
      </p>
      <div className="empty-state">
        <h2 className="empty-title">No notes yet</h2>
        <p className="empty-copy">Creating your first note is part of the upcoming notes UI.</p>
      </div>
    </section>
  );
}
