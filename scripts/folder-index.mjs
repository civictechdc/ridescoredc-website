import { existsSync } from 'node:fs';
import path from 'node:path';

// nginx decides how a URL becomes a file with `try_files $uri $uri/index.html
// =404`, so a page's address is its folder and /survey is survey/index.html.
// Vite has no equivalent. It resolves a folder only when the address already
// ends in a slash, and answers everything else with the root page, so
// /survey quietly served the map while /survey/ served the survey. That is a
// difference between this server and the deployed one, in the address bar,
// where it is least expected.
//
// This sends the folder address on to the one Vite understands. The `=404`
// step is appType 'mpa' below, which turns off the fallback to the root page.
//
// A redirect rather than a rewrite, because serving the page here would leave
// it unable to reload. Vite's own client decides whether an edit concerns the
// open page by comparing its address to the file's, allowing for the address
// ending in a slash and nothing else, so at /survey it reloads nothing while
// the terminal reports a reload. Moving the browser to /survey/ keeps every
// address working and the page live.
export function folderIndex() {
  let root;

  return {
    name: 'ridescore:folder-index',

    configResolved(config) {
      root = config.root;
    },

    configureServer(server) {
      // Returning a function registers the middleware after Vite's own, so the
      // proxy, the module pipeline and Vite's folder handling each see the
      // request first and only what none of them claimed arrives here. That is
      // the `$uri` in try_files, already tried. It also keeps /tiles and /api
      // the proxy's business no matter which folders frontend/ grows later,
      // rather than resting on none of them sharing a name.
      return () => {
        server.middlewares.use((request, response, next) => {
          // A page is something you GET. Rewriting any other method onto a page
          // is how a mistargeted fetch reads as a success and fails later on
          // the HTML it got instead; nginx answers those 405.
          if (request.method !== 'GET' && request.method !== 'HEAD') return next();

          const url = request.url || '/';
          const queryStart = url.indexOf('?');
          const pathname = queryStart === -1 ? url : url.slice(0, queryStart);
          const query = queryStart === -1 ? '' : url.slice(queryStart);

          // The trailing-slash form is Vite's own case, already handled above.
          if (pathname.endsWith('/')) return next();

          let decoded;
          try {
            decoded = decodeURIComponent(pathname);
          } catch {
            return next();
          }

          // Resolving before comparing collapses `..` however it was encoded.
          // The comparison is path.relative rather than a prefix test because
          // Vite stores root with forward slashes on every platform while
          // path.resolve returns the platform's own, and on Windows the two
          // never match.
          const folder = path.resolve(root, `.${decoded}`);
          const relative = path.relative(root, folder);
          const insideRoot =
            relative === '' ||
            (relative !== '..' &&
              !relative.startsWith(`..${path.sep}`) &&
              !path.isAbsolute(relative));

          if (insideRoot && existsSync(path.join(folder, 'index.html'))) {
            // Found, not permanent: a 301 would be remembered by the browser
            // past the life of this server and of the folder.
            response.statusCode = 302;
            response.setHeader('Location', `${pathname}/${query}`);
            response.end();
            return;
          }

          next();
        });
      };
    },
  };
}

