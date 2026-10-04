import { test as base, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { coordinate, roads, collection, tileBody, TILE_DELAY_MS } from './tiles.js';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const key = id => `${id.type}:${id.value}`;
export const ids = state => state.selectedIds.map(key).sort();

export const test = base.extend({
  survey: async ({ page, context }, use, testInfo) => {
    const actions = [];
    const consoleErrors = [];
    const requestFailures = [];
    const unexpectedRequests = [];
    const submissions = [];
    const seed = Number(process.env.SURVEY_SEED || 240624) >>> 0;
    const controls = { tileDelay: TILE_DELAY_MS, apiDelay: 0, apiStatus: 201, apiAbort: false };
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('pageerror', error => consoleErrors.push(error.stack || error.message));
    page.on('requestfailed', request => requestFailures.push({ url: request.url(), error: request.failure() }));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      const bundle = url.pathname.match(/^\/maplibre-gl@[^/]+\/dist\/(maplibre-gl(?:-shared|-worker)?(?:-dev)?\.(?:mjs|css))$/);
      if (url.hostname === 'unpkg.com' && bundle) {
        return route.fulfill({
          body: await readFile(`node_modules/maplibre-gl/dist/${bundle[1]}`),
          headers: { 'access-control-allow-origin': '*' },
          contentType: bundle[1].endsWith('.css') ? 'text/css' : 'application/javascript',
        });
      }
      if (url.hostname === 'tiles.openfreemap.org') {
        return route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f7f7f7' } }] } });
      }
      if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ body: '', contentType: 'text/css' });
      if (url.hostname === 'fonts.gstatic.com') return route.fulfill({ body: Buffer.alloc(0) });
      if (url.pathname.startsWith('/tiles/')) {
        await delay(controls.tileDelay);
        return route.fulfill({
          body: tileBody(url.pathname),
          contentType: 'application/vnd.mapbox-vector-tile',
        });
      }
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname !== '/api/submissions' || route.request().method() !== 'POST') {
          unexpectedRequests.push(url.href);
          return route.fulfill({ status: 404, json: { error: 'Unmocked API request' } });
        }
        submissions.push(route.request().postDataJSON());
        await delay(controls.apiDelay);
        if (controls.apiAbort) return route.abort('failed');
        return route.fulfill({ status: controls.apiStatus, json: { submission_id: 'fixture-submission', error: 'fixture error' } });
      }
      if (url.origin === 'http://127.0.0.1:4173') return route.continue();
      unexpectedRequests.push(url.href);
      return route.fulfill({ status: 404, body: 'External network disabled by test fixture' });
    });
    const touch = testInfo.project.name.endsWith('touch');
    const cdp = touch ? await context.newCDPSession(page) : null;
    const snapshot = () => page.evaluate(() => window.RideScore.surveyDebug.snapshot());
    const settle = async () => {
      await page.waitForFunction(() => {
        const s = window.RideScore?.surveyDebug?.snapshot();
        return s && !s.painting && !s.unpainting && !s.queuedIds.length && window.RideScore.map.loaded();
      });
      await expect.poll(async () => (await snapshot()).issues).toEqual([]);
      const state = await snapshot();
      expect(state.selectedIds.every(id => id.type === 'number')).toBe(true);
      expect(new Set(ids(state)).size).toBe(state.selectedIds.length);
      expect(state.features.filter(feature => feature.selected).map(feature => key(feature.id)).sort()).toEqual(ids(state));
      expect(state.features.some(feature => feature.pending)).toBe(false);
      expect(state.badgeVisible).toBe(state.selectedIds.length > 0);
      if (state.badgeVisible) expect(state.badgeText).toBe(`${state.groupedRoadCount} road${state.groupedRoadCount === 1 ? '' : 's'} selected`);
      return state;
    };
    const point = async (id, fraction = 0.5) => {
      const road = roads.find(road => road.id === id);
      const ll = coordinate(road.start[0] + (road.end[0] - road.start[0]) * fraction, road.start[1]);
      return page.evaluate(ll => {
        const p = window.RideScore.map.project(ll);
        return { x: p.x, y: p.y };
      }, ll);
    };
    const gesture = async points => {
      actions.push({ action: points.length === 1 ? 'tap' : 'drag', input: touch ? 'touch' : 'mouse', points });
      if (touch) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...points[0], id: 1 }] });
        for (const p of points.slice(1)) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...p, id: 1 }] });
          await delay(20);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await page.mouse.move(points[0].x, points[0].y);
        await page.mouse.down();
        for (const p of points.slice(1)) {
          await page.mouse.move(p.x, p.y);
          await delay(20);
        }
        await page.mouse.up();
      }
      return settle();
    };
    const click = async selector => {
      actions.push({ action: 'click', selector });
      if (touch) await page.locator(selector).tap();
      else await page.locator(selector).click();
      return settle();
    };
    const tap = async id => gesture([await point(id)]);
    const drag = async (from, to) => {
      const start = await point(from, 0.15);
      const end = await point(to, 0.85);
      const steps = Math.max(30, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / 7));
      return gesture(Array.from({ length: steps + 1 }, (_, i) => ({
        x: start.x + (end.x - start.x) * i / steps,
        y: start.y + (end.y - start.y) * i / steps,
      })));
    };
    try {
      await page.goto('/survey/?debugSurvey=1');
      await page.waitForFunction(() => window.RideScore?.surveyDebug && window.RideScore.map.loaded() && window.RideScore.map.queryRenderedFeatures({ layers: ['road-score'] }).length >= 12);
      await settle();
      expect(await page.evaluate(() => {
        const source = RideScore.map.getSource('segments');
        return { promoteId: source.promoteId, scoreSource: Boolean(RideScore.map.getSource('update_score')) };
      })).toEqual({ promoteId: { survey_segments: 'tile_id' }, scoreSource: false });
      await use({ page, snapshot, settle, point, gesture, click, tap, drag, controls, submissions, consoleErrors, requestFailures, actions, seed, touch });
      expect(unexpectedRequests).toEqual([]);
    } finally {
      let diagnostics;
      try { diagnostics = await page.evaluate(() => window.RideScore?.surveyDebug?.export()); }
      catch (error) { diagnostics = JSON.stringify({ exportError: error.message }); }
      await testInfo.attach('survey-diagnostics.json', { body: diagnostics || '{}', contentType: 'application/json' });
      await testInfo.attach('survey-replay.json', { body: JSON.stringify({ seed, project: testInfo.project.name, actions, controls, fixture: collection }, null, 2), contentType: 'application/json' });
      await testInfo.attach('browser-errors.json', { body: JSON.stringify({ consoleErrors, requestFailures, unexpectedRequests }, null, 2), contentType: 'application/json' });
      await cdp?.detach();
    }
  },
});
export { expect };
