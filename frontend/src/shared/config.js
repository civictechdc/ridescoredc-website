// Values both pages need. Loaded before every other shared file.
//
// Plain scripts rather than ES modules, because the pages attach their buttons
// with onclick attributes, which only find functions that are global. Moving to
// modules means converting every one of those first; it is worth doing, and it
// is not worth doing in the same change as moving files around.
window.RideScore = window.RideScore || {};

RideScore.config = {
  // The basemap everything is drawn on top of.
  style: 'https://tiles.openfreemap.org/styles/bright',
  center: [-77.02515, 38.91668],
  zoom: 15,

  // Aerial photography, shown behind the map by the Imagery button.
  orthoTiles: [
    'https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Ortho2025_WebMercator/MapServer/tile/{z}/{y}/{x}',
  ],

  // Our own tiles, served by Martin from the serving schema. The pages ask for
  // them at their own origin, so the same page works against the shared server
  // and against a stack on your machine without changing anything.
  //
  // Three sources exist, and which ones a page uses is the point:
  //   update_score     the scored map. The survey must never load it.
  //   survey_segments  street shapes and names, carrying no score at all.
  //   crashes          crash locations. Public record, not our assessment.
  tiles(name) {
    return `${location.origin}/tiles/${name}/{z}/{x}/{y}`;
  },
};
