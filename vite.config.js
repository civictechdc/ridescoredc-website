import { defineConfig, loadEnv } from 'vite';

// Vite is a development tool here and is never deployed. It serves the pages
// from api/static, the same files nginx and FastAPI serve in production, and
// forwards everything else to an upstream. There is no build step: production
// keeps serving these files directly.
//
// The pages request tiles and the API at their own origin, so the browser sees
// one origin whichever upstream is chosen, and nothing in the pages changes
// between working against the shared server and working against your own stack.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const upstream = env.VITE_UPSTREAM || 'https://dev.ridescoredc.com';
  const forward = { target: upstream, changeOrigin: true };

  return {
    root: 'api/static',
    server: {
      proxy: {
        '/tiles': forward,
        '/api': forward,
      },
    },
  };
});
