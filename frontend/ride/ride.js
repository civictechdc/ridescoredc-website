// Bike routing over DC's street network, scored by Level of Traffic Stress (LTS).
//
// Ported from RideSim DC (lib/engine/net.ts and graph.ts). A plain script, like
// the files in src/shared/, so it needs no build step. Everything hangs off one
// global, RideSim, which the Ride it page uses.
//
// LTS runs from 1 (calm, fine for kids) to 4 (hostile, only the most confident
// riders). The street network carries one LTS value per street segment, taken
// from the RideScore DC model where DDOT has the street and estimated from the
// road type where it does not.
window.RideSim = window.RideSim || {};

(function (RideSim) {
  // A confident everyday commuter: comfortable up to LTS 3, avoids LTS 4.
  RideSim.COMMUTER_LTS = 3;

  // How much longer the calm route will ride to avoid one metre of LTS 4.
  RideSim.CALM_PENALTY = 25;

  RideSim.LTS_INFO = [
    null,
    { name: 'Calm', who: 'Comfortable for almost everyone, including kids' },
    { name: 'Low stress', who: 'Comfortable for most adults' },
    { name: 'Stressful', who: 'Only for confident riders' },
    { name: 'Hostile', who: 'Only the most experienced riders' },
  ];

  // ── Loading ──

  // Turns network.json into typed arrays plus an adjacency list (CSR form):
  // for node n, its edges are adjE[adjStart[n] .. adjStart[n + 1]) and the
  // node at the other end of each is the matching entry in adjN.
  RideSim.loadNet = async function loadNet(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('Could not load the street network (' + r.status + ')');
    const raw = await r.json();
    const nN = raw.nodes.lon.length, nE = raw.edges.length;
    const net = {
      nNodes: nN, nEdges: nE,
      lon: Float64Array.from(raw.nodes.lon), lat: Float64Array.from(raw.nodes.lat),
      eu: new Int32Array(nE), ev: new Int32Array(nE), elen: new Float32Array(nE), elts: new Int8Array(nE),
      esrc: new Int8Array(nE), ename: new Int32Array(nE), eblock: new Int32Array(nE), ecoords: new Array(nE),
      names: raw.names || [], src: raw.src || [],
      adjStart: new Int32Array(nN + 1), adjE: new Int32Array(2 * nE), adjN: new Int32Array(2 * nE),
      grid: { x0: 0, y0: 0, cell: 0.004, nx: 0, ny: 0, cells: new Map() },
    };
    raw.edges.forEach(function (e, i) {
      net.eu[i] = e[0]; net.ev[i] = e[1]; net.elen[i] = e[2]; net.elts[i] = e[3];
      net.esrc[i] = e[4]; net.ename[i] = e[5]; net.eblock[i] = e[6]; net.ecoords[i] = e[7];
    });
    // Undirected: bikes may ride both ways on every street.
    const deg = new Int32Array(nN);
    for (let i = 0; i < nE; i++) { deg[net.eu[i]]++; deg[net.ev[i]]++; }
    for (let n = 0; n < nN; n++) net.adjStart[n + 1] = net.adjStart[n] + deg[n];
    const fill = net.adjStart.slice(0, nN);
    for (let i = 0; i < nE; i++) {
      const u = net.eu[i], v = net.ev[i];
      net.adjE[fill[u]] = i; net.adjN[fill[u]++] = v;
      net.adjE[fill[v]] = i; net.adjN[fill[v]++] = u;
    }
    buildGrid(net);
    return net;
  };

  // A coarse grid of nodes, so finding the nearest street is quick.
  function buildGrid(net) {
    const g = net.grid;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let n = 0; n < net.nNodes; n++) {
      x0 = Math.min(x0, net.lon[n]); y0 = Math.min(y0, net.lat[n]);
      x1 = Math.max(x1, net.lon[n]); y1 = Math.max(y1, net.lat[n]);
    }
    g.x0 = x0; g.y0 = y0;
    g.nx = Math.ceil((x1 - x0) / g.cell) + 1; g.ny = Math.ceil((y1 - y0) / g.cell) + 1;
    for (let n = 0; n < net.nNodes; n++) {
      const k = Math.floor((net.lat[n] - g.y0) / g.cell) * g.nx + Math.floor((net.lon[n] - g.x0) / g.cell);
      const arr = g.cells.get(k);
      if (arr) arr.push(n); else g.cells.set(k, [n]);
    }
  }

  // ── Distances and lookups ──

  const M_PER_DEG_LAT = 110540;
  const M_PER_DEG_LON = 111320 * Math.cos((38.9 * Math.PI) / 180);

  // Approximate metres between two lon/lat points, fine at city scale.
  RideSim.distM = function distM(x1, y1, x2, y2) {
    return Math.hypot((x2 - x1) * M_PER_DEG_LON, (y2 - y1) * M_PER_DEG_LAT);
  };

  // Nearest street node to a point. Returns -1 when none is within maxM metres.
  RideSim.nearestNode = function nearestNode(net, x, y, maxM) {
    if (maxM === undefined) maxM = 600;
    const g = net.grid;
    const cx = Math.floor((x - g.x0) / g.cell), cy = Math.floor((y - g.y0) / g.cell);
    let best = -1, bestD = maxM;
    const r = Math.ceil(maxM / (g.cell * M_PER_DEG_LAT)) + 1;
    for (let j = cy - r; j <= cy + r; j++) {
      for (let i = cx - r; i <= cx + r; i++) {
        if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) continue;
        const arr = g.cells.get(j * g.nx + i);
        if (!arr) continue;
        for (const n of arr) {
          const d = RideSim.distM(x, y, net.lon[n], net.lat[n]);
          if (d < bestD) { bestD = d; best = n; }
        }
      }
    }
    return best;
  };

  // DDOT names arrive in capitals ("SUITLAND PARKWAY TRAIL SE"). Show them in
  // title case and keep the quadrant.
  const SMALL = new Set(['of', 'the', 'and', 'at', 'on']);
  RideSim.tidyName = function tidyName(n) {
    if (!n || n !== n.toUpperCase()) return n;
    return n.toLowerCase().split(' ').map(function (w, i) {
      if (/^(nw|ne|sw|se)$/.test(w)) return w.toUpperCase();
      if (i > 0 && SMALL.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  };

  RideSim.edgeName = function edgeName(net, e) {
    return RideSim.tidyName(net.names[net.ename[e]]) || 'Unnamed street';
  };

  // ── Routing ──

  // Is this street within the rider's comfort level?
  function rideable(net, e, threshold) {
    return net.elts[e] <= threshold;
  }

  // Binary min-heap of (key, value) pairs, for Dijkstra.
  function Heap() { this.k = []; this.v = []; }
  Heap.prototype.push = function (key, val) {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  };
  Heap.prototype.pop = function () {
    const k = this.k, v = this.v; const top = [k[0], v[0]];
    const lk = k.pop(), lv = v.pop(); const n = k.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1; if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  };

  // Dijkstra from node a to node b. cost(e) gives the cost of edge e in
  // metre-equivalents, or Infinity to forbid it. Returns null if b cannot be
  // reached. byLts[l] is the distance ridden at stress level l.
  RideSim.shortest = function shortest(net, a, b, cost, threshold) {
    const dist = new Float64Array(net.nNodes).fill(Infinity);
    const prevE = new Int32Array(net.nNodes).fill(-1);
    const h = new Heap();
    dist[a] = 0; h.push(0, a);
    while (h.k.length) {
      const top = h.pop(), d = top[0], n = top[1];
      if (d > dist[n]) continue;
      if (n === b) break;
      for (let k = net.adjStart[n]; k < net.adjStart[n + 1]; k++) {
        const e = net.adjE[k], m = net.adjN[k];
        const c = cost(e);
        if (c === Infinity) continue;
        const nd = d + c;
        if (nd < dist[m]) { dist[m] = nd; prevE[m] = e; h.push(nd, m); }
      }
    }
    if (dist[b] === Infinity) return null;
    const edges = [], nodes = [b];
    let cur = b;
    while (cur !== a) {
      const e = prevE[cur]; edges.push(e);
      cur = net.eu[e] === cur ? net.ev[e] : net.eu[e];
      nodes.push(cur);
    }
    edges.reverse(); nodes.reverse();
    const byLts = [0, 0, 0, 0, 0];
    let lengthM = 0;
    const breaking = [];
    for (const e of edges) {
      const L = net.elen[e]; lengthM += L;
      byLts[net.elts[e]] += L;
      if (!rideable(net, e, threshold)) breaking.push(e);
    }
    return { nodes: nodes, edges: edges, lengthM: lengthM, byLts: byLts, breaking: breaking };
  };

  // The shortest route on any street, and the calm route, which rides up to
  // CALM_PENALTY times further to stay off streets above the rider's comfort.
  // Whatever hostile streets the calm route still uses cannot be avoided.
  RideSim.routePair = function routePair(net, a, b, threshold) {
    if (threshold === undefined) threshold = RideSim.COMMUTER_LTS;
    const fastest = RideSim.shortest(net, a, b, function (e) { return net.elen[e]; }, threshold);
    const calm = RideSim.shortest(net, a, b, function (e) {
      return net.elen[e] * (rideable(net, e, threshold) ? 1 : RideSim.CALM_PENALTY);
    }, threshold);
    return { fastest: fastest, calm: calm };
  };

  // One [lon, lat] polyline for an edge, in the direction it is ridden.
  RideSim.edgeLine = function edgeLine(net, e, fromNode) {
    const c = net.ecoords[e];
    const pts = [];
    for (let k = 0; k < c.length; k += 2) pts.push([c[k], c[k + 1]]);
    // Edge geometry runs u to v. Flip it when riding v to u.
    if (fromNode !== undefined && net.eu[e] !== fromNode) pts.reverse();
    return pts;
  };

  // A whole route as one [lon, lat] polyline in travel order, plus the edge
  // each segment belongs to.
  RideSim.routeLine = function routeLine(net, r) {
    const coords = [], segEdge = [];
    r.edges.forEach(function (e, i) {
      const pts = RideSim.edgeLine(net, e, r.nodes[i]);
      if (coords.length) pts.shift();
      for (const p of pts) {
        if (coords.length) segEdge.push(e);
        coords.push(p);
      }
    });
    return { coords: coords, segEdge: segEdge };
  };

  // Runs of consecutive edges with the same stress level and street name, in
  // travel order. nameOf(e) gives the name used to group them. Each stretch
  // also carries its own polyline, for drawing and for zooming to it.
  RideSim.stretches = function stretches(net, r, nameOf) {
    const out = [];
    let at = 0;
    r.edges.forEach(function (e, i) {
      const lts = net.elts[e], name = nameOf(e), L = net.elen[e];
      const pts = RideSim.edgeLine(net, e, r.nodes[i]);
      const last = out[out.length - 1];
      if (last && last.lts === lts && last.name === name) {
        last.lengthM += L; last.edges.push(e);
        pts.shift();
        Array.prototype.push.apply(last.coords, pts);
      } else {
        out.push({ lts: lts, name: name, startM: at, lengthM: L, edges: [e], coords: pts });
      }
      at += L;
    });
    return out;
  };
})(window.RideSim);
