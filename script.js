// --- Utils Hex (axial, pointy-top) ---
const Hex = {
  toPixel: (q, r, size) => {
    const x = size * (Math.sqrt(3) * q + Math.sqrt(3)/2 * r);
    const y = size * (3/2 * r);
    return L.point(x, y);
  },
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

    return { q: rq, r: rr };
  },
  center: (q, r, size) => {
    const p = Hex.toPixel(q, r, size);
    return [p.y, p.x];
  }
};

let cfg = null;
let state = { armies: [], addMode: null };
let map, imageLayer, gridLayer;
let mapSize = null;

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
  map = L.map('map', { crs: L.CRS.Simple, minZoom: -5 });
  const img = await loadImage(imgPath);
  const w = img.naturalWidth, h = img.naturalHeight;
  mapSize = { w, h };
  const bounds = L.latLngBounds([[0, 0], [h, w]]);
  imageLayer = L.imageOverlay(imgPath, bounds).addTo(map);
  map.fitBounds(bounds);
  map.setMaxBounds(bounds.pad(0.1));


  gridLayer = L.layerGroup().addTo(map);

  map.on('click', (e) => {
    if (state.addMode) {
      const { name, color } = state.addMode;
      const hex = Hex.fromPixel(e.latlng.lng, e.latlng.lat, currentHexSize());
      const army = {
        id: crypto.randomUUID(),
        name,
        color,
        q: hex.q,
        r: hex.r
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

// --- Grid ---
function drawGrid() {
  gridLayer.clearLayers();
  if (!document.getElementById('toggleGrid').checked) return;

  const size = currentHexSize() || 100; // force une taille par défaut
  const cols = Math.ceil(mapSize.w / (Math.sqrt(3) * size)) + 10;
  const rows = Math.ceil(mapSize.h / (1.5 * size)) + 10;

  console.log(`Grille : ${cols} colonnes × ${rows} lignes (taille = ${size})`);

  for (let r = -5; r <= rows; r++) {
    for (let q = -5; q <= cols; q++) {
      const coords = hexPolygonLatLng(q, r, size);
      L.polygon(coords, {
        color: '#ff0000', // rouge vif pour test
        weight: 1,
        fill: false,
        interactive: false
      }).addTo(gridLayer);
    }
  }
}

function hexPolygonLatLng(q, r, size) {
  // Flat-top hex coordinates
  const width = size * 2;
  const height = Math.sqrt(3) * size;

  const x = q * (3/4 * width);
  const y = r * height + (q % 2) * (height / 2);

  const center = L.latLng(y, x);

  const points = [];
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i); // flat-top
    const px = center.lng + size * Math.cos(angle);
    const py = center.lat + size * Math.sin(angle);
    points.push([py, px]);
  }
  return points;
}


// --- Armies ---
function renderArmies() {
  if (!window.armyLayer) window.armyLayer = L.layerGroup().addTo(map);
  window.armyLayer.clearLayers();

  state.armies.forEach(a => {
    const latlng = Hex.center(a.q, a.r, currentHexSize());
    const icon = L.divIcon({
      className: '',
      html: `<div style="width:16px;height:16px;border-radius:50%;background:${a.color};border:2px solid #000;"></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });

    const marker = L.marker(latlng, { draggable: true, icon }).addTo(window.armyLayer);

    marker.bindTooltip(a.name, { permanent: false, direction: 'top' });

    marker.on('dragend', (e) => {
      const pos = marker.getLatLng();
      if (document.getElementById('toggleSnap').checked) {
        const hex = Hex.fromPixel(pos.lng, pos.lat, currentHexSize());
        a.q = hex.q;
        a.r = hex.r;
        marker.setLatLng(Hex.center(a.q, a.r, currentHexSize()));
      } else {
        const hex = Hex.fromPixel(pos.lng, pos.lat, currentHexSize());
        a.q = hex.q;
        a.r = hex.r;
      }
      updateArmyList();
      persistArmies();
    });
  });

  updateArmyList();
}

function updateArmyList() {
  const list = document.getElementById('armyList');
  list.innerHTML = '';
  state.armies.forEach(a => {
    const row = document.createElement('div');
    const badge = `<span class="badge" style="background:${a.color}"></span>`;
    row.innerHTML = `${badge} ${a.name} (q=${a.q}, r=${a.r})`;
    list.appendChild(row);
  });
}

// --- UI ---
function wireUI() {
  document.getElementById('toggleGrid').addEventListener('change', drawGrid);
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
    const blob = new Blob([JSON.stringify({ armies: state.armies }, null, 2)], { type: 'application/json' });
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
          persistArmies();
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
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'config.json';
    a.click();
  });
}

function persistArmies() {
  try {
    localStorage.setItem('bds_armies', JSON.stringify(state.armies));
  } catch (e) {}
}
