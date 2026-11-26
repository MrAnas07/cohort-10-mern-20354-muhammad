import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

// The API client reads this global before the first render. import.meta.env
// belongs here in the Vite entry point because Jest refuses to execute any
// file containing import.meta, and main.jsx is the one source file Jest never
// loads. An undefined value simply leaves the client on its default.
globalThis.__NOTES_API_BASE_URL__ = import.meta.env.VITE_API_BASE_URL;

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
