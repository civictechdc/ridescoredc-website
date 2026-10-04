// Injected only by Vite's development server; never loaded by production pages.
(() => {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)
      || new URLSearchParams(location.search).get('debugSurvey') !== '1') return;

  window.RideScore = window.RideScore || {};
  RideScore.installSurveyDebug = surveyState => {
    const { map, selectedSegments, segmentEndpoints, buildContiguousSegments } = surveyState;
    const events = [];
    const touched = new Map();
    const limit = 1000;
    let sequence = 0;
    const typed = value => ({ value, type: typeof value });
    const ids = values => Array.from(values, typed);
    const target = id => ({ source: 'segments', sourceLayer: 'survey_segments', id });

    function snapshot() {
      const {
        snapQueue, selectionHistory, strokeBatchesHistory, strokeOrderedSegmentIds,
        painting, unpainting, paintMode, unpaintMode,
      } = surveyState;
      const known = new Map(touched);
      for (const id of selectedSegments.keys()) known.set(String(id), id);
      for (const item of snapQueue) known.set(String(item.featureId), item.featureId);
      if (map.getSource('segments')) {
        for (const feature of map.querySourceFeatures('segments', { sourceLayer: 'survey_segments' })) {
          const id = feature.id ?? feature.properties.tile_id;
          if (id != null) known.set(String(id), id);
        }
      }
      const features = Array.from(known.values(), id => {
        const state = map.getSource('segments') ? map.getFeatureState(target(id)) : {};
        return { id: typed(id), selected: state.selected === true, pending: state.pending === true };
      });
      const issues = [];
      const selected = new Set(Array.from(selectedSegments.keys(), String));
      const queued = new Set(snapQueue.map(item => String(item.featureId)));
      if (selected.size !== selectedSegments.size) issues.push('Duplicate selection IDs with different types');
      for (const feature of features) {
        const key = String(feature.id.value);
        if (feature.selected !== selected.has(key)) issues.push(`Selection/highlight mismatch: ${key}`);
        if (feature.pending && !queued.has(key)) issues.push(`Orphan pending highlight: ${key}`);
      }
      const groupedRoadCount = selectedSegments.size ? buildContiguousSegments().length : 0;
      const badgeText = document.getElementById('badge-count').textContent;
      const badgeVisible = getComputedStyle(document.getElementById('selection-badge')).display !== 'none';
      if (badgeVisible !== (selectedSegments.size > 0)) issues.push('Selection badge visibility mismatch');
      if (selectedSegments.size && badgeText !== `${groupedRoadCount} road${groupedRoadCount !== 1 ? 's' : ''} selected`) {
        issues.push('Grouped road count mismatch');
      }
      return {
        selectedIds: ids(selectedSegments.keys()),
        segments: Array.from(selectedSegments, ([id, props]) => ({
          tileId: typed(id), segmentId: props.segment_id, routeName: props.route_name,
          endpoints: segmentEndpoints.get(id) || null,
        })),
        history: ids(selectionHistory),
        batches: strokeBatchesHistory.map(ids),
        orderedIds: ids(strokeOrderedSegmentIds),
        queuedIds: ids(snapQueue.map(item => item.featureId)),
        features, issues, groupedRoadCount, badgeText, badgeVisible,
        painting, unpainting, paintMode, unpaintMode,
        camera: { center: map.getCenter().toArray(), zoom: map.getZoom() },
      };
    }

    function record(action, detail = {}, includeState = true) {
      events.push({
        sequence: ++sequence, elapsedMs: performance.now(), action, detail,
        ...(includeState ? { state: snapshot() } : {}),
      });
      if (events.length > limit) events.shift();
    }

    // Remember IDs even after they leave the viewport or selection collection.
    const setFeatureState = map.setFeatureState;
    map.setFeatureState = function(feature, state) {
      const result = setFeatureState.call(this, feature, state);
      if (feature.source === 'segments') {
        touched.set(String(feature.id), feature.id);
        record('feature-state', {
          id: typed(feature.id),
          state: { selected: state.selected, pending: state.pending, surveyActive: state.surveyActive },
          selectedIds: ids(selectedSegments.keys()), history: ids(surveyState.selectionHistory),
          queuedIds: ids(surveyState.snapQueue.map(item => item.featureId)),
        }, false);
      }
      return result;
    };

    for (const name of ['paint-canvas', 'unpaint-canvas']) {
      const canvas = document.getElementById(name);
      for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
        canvas.addEventListener(type, event => record(`${name}:${type}`, {
          x: event.clientX, y: event.clientY, pointerType: event.pointerType, pointerId: event.pointerId,
        }, type !== 'pointermove'));
      }
    }
    document.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (button) queueMicrotask(() => record('button', { id: button.id || null }));
    });
    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z'
          && !['INPUT', 'TEXTAREA'].includes(event.target.tagName)) {
        queueMicrotask(() => record('undo-key'));
      }
    });
    map.on('moveend', () => record('camera'));
    map.on('click', event => queueMicrotask(() => record('map-click', {
      x: event.point.x, y: event.point.y,
    })));
    RideScore.surveyDebug = Object.freeze({
      snapshot,
      export: () => JSON.stringify({
        version: 1, capturedAt: new Date().toISOString(),
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
        droppedEvents: Math.max(0, sequence - events.length), events, current: snapshot(),
      }, null, 2),
    });
    record('ready');
  };
})();
