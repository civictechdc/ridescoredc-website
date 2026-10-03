import { defineConfig, loadEnv } from 'vite';

import { reportEnv } from './scripts/check-env.mjs';
import { folderIndex } from './scripts/folder-index.mjs';

// Vite is a development tool here and is never deployed. It serves the pages
// from frontend/, the same files nginx and FastAPI serve in production, and
// forwards everything else to an upstream. There is no build step: production
// keeps serving these files directly.
//
// The pages request tiles and the API at their own origin, so the browser sees
// one origin whichever upstream is chosen, and nothing in the pages changes
// between working against the shared server and working against your own stack.

const DEFAULT_UPSTREAM = 'https://dev.ridescoredc.com';

export default defineConfig(({ mode }) => {
  const dir = process.cwd();
  loadEnv(mode, dir, ''); // keeps Vite's own env handling intact

  // Refuses to start when a setting sits in a file that does not read it, and
  // prints what is actually in effect. See scripts/check-env.mjs.
  const settings = reportEnv(dir);
  const upstream = settings.VITE_UPSTREAM || DEFAULT_UPSTREAM;
  const forward = { target: upstream, changeOrigin: true };

  console.log(`  tiles and API  ->  ${upstream}\n`);

  return {
    root: 'frontend',

    // Two pages, no client-side router. Without this, every address that
    // matches no file is answered with the root page rather than a 404, which
    // hides a typo in a link or a filename behind a page that loads fine.
    appType: 'mpa',

    plugins: [folderIndex()],

    server: {
      proxy: {
        '/tiles': forward,
        '/api': forward,
      },
    },
  };
});
