import { createServer } from 'vite';
import { tileBody, TILE_DELAY_MS } from './tiles.js';

const server = await createServer({
  server: { host: '127.0.0.1', port: 4173, strictPort: true, hmr: false, watch: null },
  plugins: [{
    name: 'offline-survey-tiles',
    configureServer(server) {
      // MapLibre 6 fetches tiles inside workers, outside Playwright's page routes.
      server.middlewares.use('/tiles', async (request, response) => {
        await new Promise(resolve => setTimeout(resolve, TILE_DELAY_MS));
        response.setHeader('Content-Type', 'application/vnd.mapbox-vector-tile');
        response.end(tileBody(`/tiles${request.url.split('?')[0]}`));
      });
    },
  }],
});
await server.listen();
