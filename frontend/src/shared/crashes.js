// Crash locations: points at close zoom, a heatmap further out.
//
// Both pages show these. Crashes are a matter of public record rather than our
// assessment of a street, so they do not carry the bias problem that keeps
// scores off the survey page.
//
// Field names are the ones the pipeline produces, not the ones the city
// publishes: `major_injuries_bicyclist`, not `MAJORINJURIES_BICYCLIST`. Reading
// the published names here returns nothing and fails silently.
window.RideScore = window.RideScore || {};

RideScore.addCrashes = function addCrashes(map) {
  map.addSource('crashes', {
    type: 'vector',
    tiles: [RideScore.config.tiles('crashes')],
    minzoom: 1,
    maxzoom: 14,
  });

  map.addLayer({
    id: 'crashes',
    type: 'circle',
    source: 'crashes',
    'source-layer': 'crashes',
    minzoom: 15,
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': 4,
      'circle-color': '#CC3232',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
      'circle-opacity': 0.7,
    },
  });

  map.addLayer({
    id: 'crashes_heatmap',
    type: 'heatmap',
    source: 'crashes',
    'source-layer': 'crashes',
    layout: { visibility: 'none' },
    paint: {
      // Every crash counts for something, and a bad one counts for much more.
      //
      // The baseline is deliberate. 91% of crashes in the published data
      // injured nobody seriously, so weighing purely by severity would hide
      // almost every crash and leave a layer that says "accidents" while
      // showing a nearly empty map.
      //
      // The top of the ramp is 5 because that is the worst severity the data
      // actually contains: one fatality and no major injuries. This read 20
      // before, which no crash could ever reach, so even a death carried a
      // quarter weight. That went unnoticed because the property names were
      // wrong too, and the whole expression silently fell back to a flat
      // weight of 1 for every crash.
      'heatmap-weight': [
        'interpolate', ['linear'],
        ['+', ['get', 'major_injuries_bicyclist'], ['*', ['get', 'fatal_bicyclist'], 5]],
        0, 0.15,
        5, 1,
      ],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 15, 3],
      'heatmap-color': [
        'interpolate', ['linear'], ['heatmap-density'],
        0, 'rgba(33,102,172,0)',
        0.2, 'rgb(103,169,207)',
        0.4, 'rgb(209,229,240)',
        0.6, 'rgb(253,219,199)',
        0.8, 'rgb(239,138,98)',
        1, 'rgb(178,24,43)',
      ],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 2, 9, 3, 15, 15],
      'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.2, 8, 0.2, 12, 1, 18, 0],
    },
  });

  map.on('click', 'crashes', (e) => {
    const p = e.features[0].properties;
    new maplibregl.Popup().setLngLat(e.lngLat).setHTML(`
      <div style="font-family:'Inter',sans-serif">
        <strong style="font-size:13px">Crash</strong>
        <table style="margin-top:6px;font-size:11px;border-collapse:collapse;width:100%">
          <tr><td style="color:#64748b;padding:2px 8px 2px 0">Date</td><td>${p.report_date || 'Unknown'}</td></tr>
          <tr><td style="color:#64748b;padding:2px 8px 2px 0">Address</td><td>${p.address || 'Unknown'}</td></tr>
          <tr><td style="color:#64748b;padding:2px 8px 2px 0">Bicyclist fatalities</td><td>${p.fatal_bicyclist}</td></tr>
          <tr><td style="color:#64748b;padding:2px 8px 2px 0">Serious injuries</td><td>${p.major_injuries_bicyclist}</td></tr>
          <tr><td style="color:#64748b;padding:2px 8px 2px 0">Minor injuries</td><td>${p.minor_injuries_bicyclist}</td></tr>
        </table>
      </div>`).addTo(map);
  });

  map.on('mouseenter', 'crashes', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'crashes', () => { map.getCanvas().style.cursor = ''; });
};
