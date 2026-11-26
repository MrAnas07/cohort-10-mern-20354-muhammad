import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Architecture 6.2: in development the browser talks to a single origin -
    // Vite forwards /api to the backend (default :4000), so httpOnly cookies
    // work without involving CORS. Set VITE_API_BASE_URL in .env only when the
    // API lives somewhere else (for example an absolute production URL).
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },
});
