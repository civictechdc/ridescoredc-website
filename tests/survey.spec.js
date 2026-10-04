import { test, expect, ids } from './survey-fixture.js';

test('taps select numeric IDs; contiguous badge, erase and Undo target the intended segment', async ({ survey: s }) => {
  await s.click('#paintBtn');
  await s.tap(101);
  const state = await s.tap(102);
  expect(ids(state)).toEqual(['number:101', 'number:102']);
  expect(state.groupedRoadCount).toBe(1);
  expect(state.selectedIds.length).toBe(2);
  const undo = await s.click('#badge-undo');
  expect(ids(undo)).toEqual(['number:101']);
  expect(undo.features.find(f => f.id.value === 102).selected).toBe(false);
  await s.tap(102);
  await s.click('#unpaintBtn');
  const erased = await s.tap(101);
  expect(ids(erased)).toEqual(['number:102']);
  expect(erased.history.map(id => id.value)).not.toContain(101);
  expect(ids(await s.click('#badge-undo'))).toEqual([]);
  expect(s.consoleErrors).toEqual([]);
});

test('long overlapping drags, erase, undo stroke and Clear leave no ghost feature states', async ({ survey: s }) => {
  await s.click('#paintBtn');
  const first = await s.drag(101, 108);
  expect(first.selectedIds.length).toBeGreaterThanOrEqual(7);
  expect(first.groupedRoadCount).toBe(2);
  const overlap = await s.drag(103, 106);
  expect(ids(overlap)).toEqual(ids(first));
  const second = await s.drag(201, 204);
  const batch = second.batches.at(-1).map(id => `number:${id.value}`);
  expect(batch.length).toBeGreaterThanOrEqual(3);
  const undone = await s.click('#badge-undo-stroke');
  expect(ids(undone)).toEqual(ids(second).filter(id => !batch.includes(id)));
  await s.click('#unpaintBtn');
  const erased = await s.drag(103, 106);
  expect(erased.selectedIds.length).toBeLessThan(undone.selectedIds.length);
  expect(erased.selectedIds.length).toBeGreaterThan(0);
  const cleared = await s.click('#badge-clear');
  expect(cleared.selectedIds).toEqual([]);
  expect(cleared.history).toEqual([]);
  expect(cleared.batches).toEqual([]);
  expect(cleared.features.every(f => !f.selected && !f.pending)).toBe(true);
  expect(s.consoleErrors).toEqual([]);
});

test('rapid paint/unpaint switches and native zoom/pan with delayed tiles preserve selections', async ({ survey: s }) => {
  await s.click('#paintBtn');
  const before = await s.tap(104);
  for (let i = 0; i < 3; i++) {
    await s.click('#unpaintBtn');
    await s.click('#paintBtn');
  }
  await s.click('#paintBtn');
  const cameraBefore = await s.page.evaluate(() => ({ zoom: RideScore.map.getZoom(), center: RideScore.map.getCenter().toArray() }));
  s.actions.push({ action: 'zoom', input: s.touch ? 'CDP pinch' : 'mouse wheel' });
  if (s.touch) {
    const cdp = await s.page.context().newCDPSession(s.page);
    await cdp.send('Input.synthesizePinchGesture', { x: 640, y: 400, scaleFactor: 1.6, gestureSourceType: 'touch' });
    await cdp.detach();
  } else {
    await s.page.mouse.move(640, 400);
    await s.page.mouse.wheel(0, -180);
  }
  await expect.poll(() => s.page.evaluate(() => RideScore.map.getZoom())).toBeGreaterThan(cameraBefore.zoom + 0.1);
  await s.settle();
  await s.gesture(Array.from({ length: 31 }, (_, i) => ({ x: 640 + i * 4, y: 650 + i })));
  const cameraAfter = await s.page.evaluate(() => RideScore.map.getCenter().toArray());
  expect(cameraAfter).not.toEqual(cameraBefore.center);
  expect(ids(await s.settle())).toEqual(ids(before));
  await s.click('#paintBtn');
  await s.tap(105);
  expect(ids(await s.click('#badge-clear'))).toEqual([]);
  expect(s.consoleErrors).toEqual([]);
});

test('seeded randomized browser actions maintain invariants and are replayable', async ({ survey: s }) => {
  let randomState = s.seed;
  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 2 ** 32;
  };
  await s.click('#paintBtn');
  for (let i = 0; i < 24; i++) {
    const op = Math.floor(random() * 6);
    const id = 101 + Math.floor(random() * 8);
    const before = await s.snapshot();
    s.actions.push({ action: 'random', index: i, op, id, randomState });
    if (op <= 1) {
      if (!before.paintMode) await s.click('#paintBtn');
      await s.tap(id);
    } else if (op === 2) {
      if (!before.unpaintMode) await s.click('#unpaintBtn');
      await s.tap(id);
    } else if (op === 3 && before.history.length) {
      const last = before.history.at(-1);
      expect(ids(await s.click('#badge-undo'))).toEqual(ids(before).filter(value => value !== `${last.type}:${last.value}`));
    } else if (op === 4 && before.batches.length && before.selectedIds.length) {
      const removed = before.batches.at(-1).map(id => `${id.type}:${id.value}`);
      expect(ids(await s.click('#badge-undo-stroke'))).toEqual(ids(before).filter(id => !removed.includes(id)));
    } else if (op === 5 && before.selectedIds.length) {
      expect(ids(await s.click('#badge-clear'))).toEqual([]);
    }
    await s.settle();
  }
  let end = await s.snapshot();
  if (end.history.length) {
    const last = end.history.at(-1);
    s.actions.push({ action: 'keyboard', key: 'Control+z' });
    await s.page.keyboard.press('Control+z');
    const undone = await s.settle();
    expect(ids(undone)).toEqual(ids(end).filter(id => id !== `${last.type}:${last.value}`));
    end = undone;
  }
  if (end.selectedIds.length) await s.click('#badge-clear');
  expect((await s.settle()).features.every(f => !f.selected && !f.pending)).toBe(true);
  expect(s.consoleErrors).toEqual([]);
});

for (const outcome of ['success', 'http-error', 'network-error']) {
  test(`survey navigation and mocked submission ${outcome}`, async ({ survey: s }) => {
    await s.click('#paintBtn');
    await s.tap(101);
    await s.tap(105);
    await s.click('#badge-rate');
    await expect(s.page.locator('#ss-q-road')).toContainText('Alpha Avenue');
    await expect(s.page.locator('#ss-prog')).toHaveText('1 / 2');
    await s.click('#ss-lts-row [data-lts="3"]');
    await s.click('#ss-safety-row [data-v="7"]');
    await s.page.locator('#ss-factors-grid input').first().check();
    await s.click('#ss-next-btn');
    await expect(s.page.locator('#ss-q-road')).toContainText('Beta Avenue');
    await s.click('#ss-back-btn');
    await expect(s.page.locator('#ss-lts-row [data-lts="3"]')).toHaveClass(/sel/);
    await s.click('#ss-next-btn');
    await s.click('#ss-lts-row [data-lts="2"]');
    await s.click('#ss-safety-row [data-v="9"]');
    await s.click('#ss-next-btn');
    await s.click('#ss-submit-btn');
    await expect(s.page.locator('.ss-req-block.error')).toHaveCount(3);
    expect(s.submissions).toEqual([]);
    await s.click('.ss-time-btn[data-v="Morning"]');
    await s.click('#ss-sat-row [data-v="4"]');
    await s.click('.ss-tvol-btn[data-v="yes"]');
    const privateComment = 'Private respondent text: survey-comment-9c057e2a. Never export this.';
    await s.page.locator('#ss-comments').fill(privateComment);
    expect(await s.page.evaluate(() => RideScore.surveyDebug.export())).not.toContain(privateComment);
    s.controls.apiDelay = 250;
    s.controls.apiStatus = outcome === 'http-error' ? 503 : 201;
    s.controls.apiAbort = outcome === 'network-error';
    await s.click('#ss-submit-btn');
    await expect(s.page.locator('#ss-submit-btn')).toBeDisabled();
    await expect(s.page.locator('#ss-confirm')).toBeVisible();
    expect(s.submissions).toHaveLength(1);
    const payload = s.submissions[0];
    expect(payload.segment_ids).toEqual(['fixture-segment-101', 'fixture-segment-105']);
    expect(payload.contiguous_segments.map(seg => seg.route_name)).toEqual(['Alpha Avenue', 'Beta Avenue']);
    expect(payload.contiguous_segments.map(seg => seg.lts_perceived)).toEqual([3, 2]);
    expect(payload.contiguous_segments.map(seg => seg.safety_rating)).toEqual([7, 9]);
    expect(payload).toMatchObject({ time_of_day: 'Morning', overall_satisfaction: 4, would_ride_again: 'yes' });
    expect(payload.comments).toBe(privateComment);
    const exported = await s.page.evaluate(() => RideScore.surveyDebug.export());
    expect(exported).not.toContain(privateComment);
    for (const field of ['comments', 'surveyAnswers', 'lts_perceived', 'safety_rating', 'time_of_day', 'overall_satisfaction', 'would_ride_again']) {
      expect(exported).not.toContain(`"${field}":`);
    }
    if (outcome === 'success') expect(s.consoleErrors).toEqual([]);
    else expect(s.consoleErrors.some(error => error.includes('Submission error:'))).toBe(true);
    await s.click('#ss-confirm button');
    await expect(s.page.locator('#survey-sheet')).not.toHaveClass(/open/);
    expect(ids(await s.settle())).toEqual([]);
  });
}

test('diagnostics detect an injected orphan feature state without changing production handlers', async ({ survey: s }) => {
  s.actions.push({ action: 'inject-orphan-feature-state', id: 101 });
  await s.page.evaluate(() => RideScore.map.setFeatureState(
    { source: 'segments', sourceLayer: 'survey_segments', id: 101 },
    { selected: true },
  ));
  try {
    await expect.poll(async () => (await s.snapshot()).issues.length).toBeGreaterThan(0);
    const orphan = await s.snapshot();
    s.actions.push({ action: 'observed-orphan', issues: orphan.issues });
    expect(orphan.selectedIds).toEqual([]);
    expect(orphan.features.find(f => f.id.value === 101).selected).toBe(true);
  } finally {
    await s.page.evaluate(() => RideScore.map.removeFeatureState(
      { source: 'segments', sourceLayer: 'survey_segments', id: 101 },
    ));
  }
  await s.settle();
});

test('local diagnostics require the explicit debugSurvey opt-in', async ({ survey: s }) => {
  s.actions.push({ action: 'navigate', url: '/survey/' });
  await s.page.goto('/survey/');
  await s.page.waitForFunction(() => RideScore.map.loaded());
  expect(await s.page.evaluate(() => typeof RideScore.surveyDebug)).toBe('undefined');
  s.actions.push({ action: 'navigate', url: '/survey/?debugSurvey=1' });
  await s.page.goto('/survey/?debugSurvey=1');
  await s.page.waitForFunction(() => RideScore.surveyDebug && RideScore.map.loaded());
  await s.settle();
  expect(s.consoleErrors).toEqual([]);
});
