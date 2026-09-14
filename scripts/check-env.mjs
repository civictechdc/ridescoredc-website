// Check that each setting is in the file that actually reads it.
//
// Three files hold settings, and each is read by something different:
//
//   .env        `npm run dev`, and `docker compose` for ${...} in docker-compose.yml
//   .env.local  `npm run dev` only, and it overrides .env
//   api/.env    handed to the containers as their environment
//
// Nothing warns you when a setting is in the wrong one. It is simply ignored,
// and you get the default instead: the database keeps appearing on port 5432
// however many times you change DB_PORT, or the pages keep showing the shared
// server's data when you meant to use your own. This turns each of those into a
// message that says which file to move the line to.
//
// Run it directly:  npm run check-env

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILES = ['.env', '.env.local', 'api/.env'];

// Where each setting has to live, and what stops working when it does not.
const SETTINGS = {
  VITE_UPSTREAM: {
    home: '.env',
    // Works from .env.local too, so this one is a warning rather than an error.
    alsoWorksIn: ['.env.local'],
    used_by: 'npm run dev, to decide where tiles and the API come from',
  },
  DB_PORT: {
    home: '.env',
    used_by: 'docker compose, to choose which port on your machine reaches the database',
  },
  DB_DATA_DIR: {
    home: '.env',
    used_by: 'docker compose, to choose where the database keeps its files',
  },
  DATABASE_URL: {
    home: 'api/.env',
    used_by: 'the website and Martin, inside their containers',
  },
  POSTGRES_PASSWORD: {
    home: 'api/.env',
    used_by: 'the database container',
  },
  // Overrides for where published road data comes from. The defaults are in
  // scripts/data_source.py; these are for pointing one machine somewhere else,
  // usually at data you built yourself.
  DATA_RELEASES: {
    home: '.env',
    used_by: 'npm run data, to decide where published data is fetched from',
  },
  DATA_PACKAGE: {
    home: '.env',
    used_by: 'npm run data, as the name of the published data file',
  },
  DATA_BUNDLE: {
    home: '.env',
    used_by: 'npm run data, as the name of the published serving file',
  },
  DATA_LOADER: {
    home: '.env',
    used_by: 'npm run data, as the program that does the loading',
  },
};

function parse(file) {
  const found = new Map();
  if (!existsSync(file)) return found;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const value = m[2].trim().replace(/\s+#.*$/, '').replace(/^(['"])(.*)\1$/, '$2').trim();
    found.set(m[1], value);
  }
  return found;
}

export function checkEnv(dir = process.cwd()) {
  const contents = new Map(FILES.map((f) => [f, parse(resolve(dir, f))]));
  const errors = [];
  const warnings = [];
  const resolved = {};

  for (const [name, spec] of Object.entries(SETTINGS)) {
    const where = FILES.filter((f) => contents.get(f).has(name));
    if (where.length === 0) continue;

    const ok = [spec.home, ...(spec.alsoWorksIn ?? [])];
    const ignored = where.filter((f) => !ok.includes(f));
    const effective = where.filter((f) => ok.includes(f));

    for (const f of ignored) {
      errors.push(
        `${name} is in ${f}, but nothing reads ${name} from there, so the value\n` +
          `    you set is ignored and the default is used instead.\n` +
          `    Move the line to ${spec.home}. ${name} is used by ${spec.used_by}.`
      );
    }

    // Set in two places that both work, with different values: whichever wins
    // is a matter of load order, which is exactly the thing nobody remembers.
    if (effective.length > 1) {
      const values = effective.map((f) => `${f} = ${contents.get(f).get(name)}`);
      const distinct = new Set(effective.map((f) => contents.get(f).get(name)));
      if (distinct.size > 1) {
        errors.push(
          `${name} is set to different values in two files:\n` +
            values.map((v) => `      ${v}`).join('\n') +
            `\n    .env.local wins for npm run dev, and docker compose ignores it entirely,\n` +
            `    so the two would disagree. Keep the line in ${spec.home} only.`
        );
      }
    }

    if (effective.length && !effective.includes(spec.home)) {
      warnings.push(
        `${name} is only in ${effective[0]}, which docker compose does not read.\n` +
          `    Move it to ${spec.home} if you also run your own stack.`
      );
    }

    const winner = effective.includes('.env.local') ? '.env.local' : effective[0];
    if (winner) resolved[name] = contents.get(winner).get(name);
  }

  return { errors, warnings, resolved };
}

export function reportEnv(dir = process.cwd(), { quiet = false } = {}) {
  const { errors, warnings, resolved } = checkEnv(dir);

  for (const w of warnings) console.warn(`\n  note: ${w}\n`);

  if (errors.length) {
    throw new Error(
      `\n\nSome settings are in the wrong file, so they have no effect:\n\n` +
        errors.map((e) => `  - ${e}`).join('\n\n') +
        `\n\nWhich program reads which file:\n` +
        `  .env        npm run dev, and docker compose\n` +
        `  .env.local  npm run dev only, and it overrides .env\n` +
        `  api/.env    the containers themselves\n`
    );
  }

  if (!quiet) {
    const rows = Object.entries(resolved);
    if (rows.length) {
      console.log('\n  settings in effect');
      for (const [k, v] of rows) {
        console.log(`    ${k.padEnd(18)} ${k === 'DATABASE_URL' || k === 'POSTGRES_PASSWORD' ? '(set)' : v}`);
      }
      console.log('');
    }
  }

  return resolved;
}

// Run directly rather than imported.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    reportEnv();
    console.log('  settings are in the right files\n');
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
