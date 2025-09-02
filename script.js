// --- Utils Hex (axial, pointy-top) ---
// Reference: https://www.redblobgames.com/grids/hexgrids/
const Hex = {
  // axial to pixel
  toPixel: (q, r, size) => {
    const x = size * (Math.sqrt(3) * q + Math.sqrt(3)/2 * r);
    const y = size * (3/2 * r);
    return L.point(x, y);
  },
  // pixel to axial (approx)
  fromPixel: (x, y, size) => {
    const q = (Math.sqrt(3)/3 * x - 1/3 * y) / size;
    const r = (2/3 * y) / size;
    return Hex.round(q, r);
  },
  round: (q, r) => {
    let s = -q - r;
    let rq = Math.round(q);
    let rr = Math.round(r);
    let rs = Math.round(s);

    const q_diff = Math.abs(rq - q);
    const r_diff = Math.abs(rr - r);
    const s_diff = Math.abs(rs - s);

    if (q_diff > r_diff && q_diff > s_diff) rq = -rr - rs;
    else if (r_diff > s_diff) rr = -rq - rs;
    // else rs = -rq - rr;
    return {q: rq, r: rr};
  },
  center: (q, r, size) => {
    const p = Hex.toPixel(q, r, size);
    return [p.y, p.x]; // Leaflet uses [y, x] in CRS.Simple
  }
};

// Global state
let cfg = null;
let state = { armies: [], addMode: null };
let map, imageLayer, gridLayerGroup;
let mapSize = null;

// Load config + armies then init
(async function init() {
  cfg = await (await fetch('data/config.json')).json();
  try {
    const saved = await (await fetch('data/armies.json')).json();
    state.armies = saved.armies || [];
  } catch (e) {
    state.armies = [];
  }
  document.getElementById('hexSize').value = cfg.hexSize;
  document.getElementById('toggleGrid').checked = cfg.gridVisible;
  document.getElementById('toggleSnap').checked = cfg.snapToGrid;
  await initMap(cfg.mapImage);
  drawGrid();
  renderArmies();
  wireUI();
})();

async function initMap(imgPath) {
  // Create map with simple CRS (pixel coordinates)
  map = L.map('map', { crs: L.CRS.Simple, zoomControl: true, minZoom: -5 });
  const img = await loadImage(imgPath);
  const w = img.naturalWidth, h = img.naturalHeight;
  mapSize = {w, h};
  const bounds = [[0,0], [h, w]];
  imageLayer = L.imageOverlay(imgPath, bounds).addTo(map);
  map.fitBounds(bounds);
  map.setMaxBounds(bounds.pad(0.1));

  gridLayerGroup = L.layerGroup().addTo(map);

  // Click to add or move
  map.on('click', (e) => {
    if (state.addMode) {
      const { name, color } = state.addMode;
      const hex = Hex.fromPixel(e.latlng.lng, e.latlng.lat, currentHexSize());
      const center = Hex.center(hex.q, hex.r, currentHexSize());
      const army = {
        id: crypto.randomUUID(),
        name, color,
        q: hex.q, r: hex.r
      };
      state.armies.push(army);
      state.addMode = null;
      renderArmies();
      updateArmyList();
    }
  });
}

function currentHexSize() {
  return parseFloat(document.getElementById('hexSize').value);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// --- Grid drawing (SVG paths) ---
function drawGrid() {
  gridLayerGroup.clearLayers();
  if (!document.getElementById('toggleGrid').checked) { 
    document.getElementById('gridLabel').innerText = '';
    return;
  }

  const size = currentHexSize();
  const bounds = [[0,0], [mapSize.h, mapSize.w]];

  const svg = L.svg({ interactive:false });
  svg.addTo(map);
  gridLayerGroup.addLayer(svg);

  const svgElem = svg._rootGroup; // <g>
  const overlayPane = svg._container;
  // Compute extents
  const cols = Math.ceil(mapSize.w / (Math.sqrt(3) * size)) + 2;
  const rows = Math.ceil(mapSize.h / (1.5 * size)) + 2;

  for (let r = -1; r <= rows; r++) {
    for (let q = -1; q <= cols; q++) {
      const latlng = Hex.center(q, r, size);
      const pts = hexPolygonPoints(q, r, size).map(p => map.latLngToLayerPoint([p[0], p[1]]));
      const d = 'M ' + pts.map(p => `${p.x} ${p.y}`).join(' L ') + ' Z';
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'rgba(0,0,0,0.15)');
      path.setAttribute('stroke-width', '1');
      svgElem.appendChild(path);
    }
  }

  document.getElementById('gridLabel').innerText = `Grille hex: ${size}px`;

  // Redraw on zoom/move
  map.off('zoomend moveend', onRedraw);
  map.on('zoomend moveend', onRedraw);
  function onRedraw() {
    drawGrid();
  }
}

function hexCorner(center, size, i) {
  const angle = Math.PI / 180 * (60 * i - 30); // pointy-top
  const x = center.lng + size * Math.cos(angle);
  const y = center.lat + size * Math.sin(angle);
  return [y, x];
}
function hexPolygonPoints(q, r, size) {
  const center = L.latLng(Hex.center(q, r, size));
  const pts = [];
  for (let i=0;i<6;i++) pts.push(hexCorner(center, size, i));
  return pts;
}

// --- Armies ---
function renderArmies() {
  // Clear existing markers layer
  if (!window.armyLayer) window.armyLayer = L.layerGroup().addTo(map);
  window.armyLayer.clearLayers();

  state.armies.forEach(a => {
    const center = Hex.center(a.q, a.r, currentHexSize());
    const marker = L.circleMarker(center, {
      radius: 8, weight: 2, color: '#111', fillColor: a.color, fillOpacity: 0.9, bubblingMouseEvents: false
    }).addTo(window.armyLayer);

    marker.bindTooltip(a.name, {permanent:false, direction:'top'});

    marker.dragging = new L.Handler.MarkerDrag(marker);
    marker.dragging.enable();

    marker.on('dragend', (e) => {
      const latlng = marker.getLatLng();
      if (document.getElementById('toggleSnap').checked) {
        const hex = Hex.fromPixel(latlng.lng, latlng.lat, currentHexSize());
        a.q = hex.q; a.r = hex.r;
        marker.setLatLng(Hex.center(a.q, a.r, currentHexSize()));
      } else {
        // Store as approximate axial anyway
        const hex = Hex.fromPixel(latlng.lng, latlng.lat, currentHexSize());
        a.q = hex.q; a.r = hex.r;
      }
      updateArmyList();
      persistArmies(false);
    });

    marker.on('click', () => {
      alert(`${a.name}\nHex: q=${a.q}, r=${a.r}`);
    });
  });

  updateArmyList();
}

function updateArmyList() {
  const list = document.getElementById('armyList');
  list.innerHTML = '';
  state.armies.forEach(a => {
    const row = document.createElement('div');
    const left = document.createElement('div');
    left.style.display = 'flex'; left.style.alignItems = 'center';
    const badge = document.createElement('span');
    badge.className='badge'; badge.style.background = a.color;
    const label = document.createElement('span');
    label.textContent = ` ${a.name} (q=${a.q}, r=${a.r})`;
    left.appendChild(badge); left.appendChild(label);
    const del = document.createElement('button');
    del.textContent = '×';
    del.onclick = () => {
      state.armies = state.armies.filter(x => x.id !== a.id);
      renderArmies();
      persistArmies(false);
    };
    row.appendChild(left); row.appendChild(del);
    list.appendChild(row);
  });
}

// --- UI wiring ---
function wireUI() {
  document.getElementById('toggleGrid').addEventListener('change', () => {
    drawGrid();
    cfg.gridVisible = document.getElementById('toggleGrid').checked;
  });
  document.getElementById('toggleSnap').addEventListener('change', () => {
    cfg.snapToGrid = document.getElementById('toggleSnap').checked;
  });
  document.getElementById('hexSize').addEventListener('change', () => {
    drawGrid();
    renderArmies();
  });

  document.getElementById('addArmyBtn').addEventListener('click', () => {
    const name = document.getElementById('armyName').value.trim() || 'Armée';
    const color = document.getElementById('armyColor').value;
    state.addMode = { name, color };
    alert("Cliquez sur la carte pour placer l'armée.");
  });

  document.getElementById('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ armies: state.armies }, null, 2)], {type: 'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'armies.json';
    a.click();
  });

  document.getElementById('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        if (obj.armies) {
          state.armies = obj.armies;
          renderArmies();
          persistArmies(false);
        }
      } catch (err) {
        alert('Fichier invalide.');
      }
    };
    reader.readAsText(file);
  });

  document.getElementById('saveConfigBtn').addEventListener('click', () => {
    cfg.hexSize = currentHexSize();
    cfg.gridVisible = document.getElementById('toggleGrid').checked;
    cfg.snapToGrid = document.getElementById('toggleSnap').checked;
    const blob = new Blob([JSON.stringify(cfg, null, 2)], {type: 'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'config.json';
    a.click();
  });
}

// persist: for GH Pages there's no write, but keep a mirror in memory; we still update localStorage
function persistArmies(notify=true) {
  try {
    localStorage.setItem('bds_armies', JSON.stringify(state.armies));
    if (notify) console.log('Armées sauvegardées localement.');
  } catch(e) {}
}

// On load, attempt to use localStorage if data/armies.json not accessible
document.addEventListener('DOMContentLoaded', () => {
  try {
    const ls = localStorage.getItem('bds_armies');
    if (ls && state.armies.length === 0) {
      state.armies = JSON.parse(ls);
      renderArmies();
    }
  } catch(e) {}
});
