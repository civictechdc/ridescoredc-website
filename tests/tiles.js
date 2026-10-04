import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';

export const CENTER = [-77.02515, 38.91668];
export const ZOOM = 15;
export const TILE_DELAY_MS = Number(process.env.SURVEY_TILE_DELAY_MS || 120);
const WORLD = 512 * 2 ** ZOOM;
const centerY = (1 - Math.asinh(Math.tan(CENTER[1] * Math.PI / 180)) / Math.PI) / 2;
export function coordinate(x, y) {
  const longitude = CENTER[0] + (x - 640) / WORLD * 360;
  const mercatorY = centerY + (y - 400) / WORLD;
  return [longitude, Math.atan(Math.sinh(Math.PI * (1 - 2 * mercatorY))) * 180 / Math.PI];
}
export const roads = [
  ...Array.from({ length: 8 }, (_, i) => ({
    id: 101 + i, name: i < 4 ? 'Alpha Avenue' : 'Beta Avenue',
    start: [240 + i * 100, 390], end: [340 + i * 100, 390],
  })),
  ...Array.from({ length: 4 }, (_, i) => ({
    id: 201 + i, name: 'Parallel Street',
    start: [440 + i * 100, 510], end: [540 + i * 100, 510],
  })),
];
export const collection = {
  type: 'FeatureCollection',
  features: roads.map(road => ({
    type: 'Feature', id: road.id,
    properties: { tile_id: road.id, segment_id: `fixture-segment-${road.id}`, route_name: road.name },
    geometry: { type: 'LineString', coordinates: [coordinate(...road.start), coordinate(...road.end)] },
  })),
};
const tileIndex = new geojsonvt(collection, { maxZoom: 14, indexMaxZoom: 14, tolerance: 0 });
const emptyTile = vtpbf.fromGeojsonVt({ survey_segments: { features: [] }, crashes: { features: [] } });
export function tileBody(path) {
  const match = path.match(/^\/tiles\/survey_segments\/(\d+)\/(\d+)\/(\d+)$/);
  const tile = match && tileIndex.getTile(...match.slice(1).map(Number));
  return Buffer.from(tile ? vtpbf.fromGeojsonVt({ survey_segments: tile }) : emptyTile);
}
