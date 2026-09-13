// The map itself, and the aerial imagery behind it. Both pages start the same
// way; what they draw on top is what differs.
window.RideScore = window.RideScore || {};

// Creates the map and remembers it, so the button handlers below can reach it
// without every page passing it around.
RideScore.createMap = function createMap(containerId) {
  const { style, center, zoom } = RideScore.config;
  RideScore.map = new maplibregl.Map({ container: containerId, style, center, zoom });
  return RideScore.map;
};

// Aerial photography, added hidden. The Imagery button reveals it.
RideScore.addImagery = function addImagery(map) {
  map.addSource('dc-ortho-2025', {
    type: 'raster',
    tiles: RideScore.config.orthoTiles,
    tileSize: 256,
  });
  map.addLayer({
    id: 'ortho-2025-layer',
    type: 'raster',
    source: 'dc-ortho-2025',
    layout: { visibility: 'none' },
  });
};

// Turns a layer on and off, and marks the button that controls it.
function toggleLayers(buttonId, layerIds, state) {
  document.getElementById(buttonId).classList.toggle('active', state);
  for (const id of layerIds) {
    if (RideScore.map.getLayer(id)) {
      RideScore.map.setLayoutProperty(id, 'visibility', state ? 'visible' : 'none');
    }
  }
}

// Global because the buttons call them from onclick attributes in the HTML.
let imageryOn = false;
window.toggleImagery = function toggleImagery() {
  imageryOn = !imageryOn;
  toggleLayers('imageryBtn', ['ortho-2025-layer'], imageryOn);
};

let accidentsOn = false;
window.toggleAccidents = function toggleAccidents() {
  accidentsOn = !accidentsOn;
  toggleLayers('accidentsBtn', ['crashes', 'crashes_heatmap'], accidentsOn);
};

let attributionOpen = false;
window.toggleAttribution = function toggleAttribution() {
  attributionOpen = !attributionOpen;
  document.getElementById('attribution-panel').classList.toggle('open', attributionOpen);
};
