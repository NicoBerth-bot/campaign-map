// script-editor.js (VERSION AVEC SÉLECTION RECTANGULAIRE)

// --- Références UI ---
const mapSelector = document.getElementById('mapSelector');
const genGridBtn = document.getElementById('genGridBtn');
const exportProjectBtn = document.getElementById('exportProject');
const hexSizeInput = document.getElementById('hexSize');

// --- État global ---
let map = null;
let imgLayer = null;
let gridLayer = null;
let mapSize = null;
let currentMapPath = null;

let removedHexes = new Set();
let addedHexes = new Set();

// État pour la sélection rectangulaire
let isDrawingSelection = false;
let selectionStart = null;
let selectionRect = null;

// --- Math hexagones (flat-top axial) ---
function axial_to_pixel(q, r, size) {
  const x = size * 1.5 * q;
  const y = size * Math.sqrt(3) * (r + q / 2);
  return { x, y };
}

function pixel_to_axial(x, y, size) {
  const q = (2 / 3) * x / size;
  const r = (y / (Math.sqrt(3) * size)) - q / 2;
  return { q, r };
}

function cube_round(x, y, z) {
  let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
  const x_diff = Math.abs(rx - x);
  const y_diff = Math.abs(ry - y);
  const z_diff = Math.abs(rz - z);
  if (x_diff > y_diff && x_diff > z_diff) rx = -ry - rz;
  else if (y_diff > z_diff) ry = -rx - rz;
  else rz = -rx - ry;
  return { x: rx, y: ry, z: rz };
}

function axial_round(q, r) {
  const x = q, z = r, y = -x - z;
  const cr = cube_round(x, y, z);
  return { q: cr.x, r: cr.z };
}

function pixelToHex_axial(x, y, size) {
  const frac = pixel_to_axial(x, y, size);
  return axial_round(frac.q, frac.r);
}

function hexPolygonLatLng(q, r, size) {
  const c = axial_to_pixel(q, r, size);
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i);
    pts.push([c.y + size * Math.sin(angle), c.x + size * Math.cos(angle)]);
  }
  return pts;
}

// --- Chargement des cartes ---
async function loadMapsList() {
  try {
    const res = await fetch('assets/assets.json');
    if (!res.ok) throw new Error('assets.json introuvable');
    const data = await res.json();

    mapSelector.innerHTML = '';
    (data.maps || []).forEach(m => {
      const opt = document.createElement('option');
      opt.value = `assets/${m.file}`;
      opt.textContent = m.name || m.file;
      mapSelector.appendChild(opt);
    });

    if (mapSelector.options.length > 0) {
      mapSelector.selectedIndex = 0;
      currentMapPath = mapSelector.value;
      await initMap(currentMapPath);
      drawGrid();
    }
  } catch (err) {
    console.error('Erreur assets.json:', err);
  }
}

function loadSelectedMap() {
  currentMapPath = mapSelector.value;
  if (!currentMapPath) return;
  initMap(currentMapPath).then(drawGrid).catch(console.error);
}

// --- Initialisation Leaflet ---
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function initMap(imgPath) {
  if (map) map.remove();

  map = L.map('map', { crs: L.CRS.Simple, minZoom: -5 });
  const img = await loadImage(imgPath);
  mapSize = { w: img.naturalWidth, h: img.naturalHeight };

  const bounds = L.latLngBounds([[0, 0], [mapSize.h, mapSize.w]]);
  imgLayer = L.imageOverlay(imgPath, bounds).addTo(map);

  map.fitBounds(bounds);
  map.setMaxBounds(bounds.pad(0.1));

  gridLayer = L.layerGroup().addTo(map);

  // Ajout d'un hex hors grille (Ctrl+clic ou clic droit)
  map.on('click', (e) => {
    if (e.originalEvent && e.originalEvent.ctrlKey) {
      const size = currentHexSize();
      const { q, r } = pixelToHex_axial(e.latlng.lng, e.latlng.lat, size);
      const key = `${q},${r}`;
      addedHexes.add(key);
      removedHexes.delete(key);
      drawGrid();
    }
  });

  map.on('contextmenu', (e) => {
    e.originalEvent.preventDefault();
    const size = currentHexSize();
    const { q, r } = pixelToHex_axial(e.latlng.lng, e.latlng.lat, size);
    const key = `${q},${r}`;
    addedHexes.add(key);
    removedHexes.delete(key);
    drawGrid();
  });

  // Sélection rectangulaire
  map.on('mousedown', (e) => {
    if (!e.originalEvent.shiftKey) return;
    isDrawingSelection = true;
    selectionStart = e.latlng;
    if (selectionRect) gridLayer.removeLayer(selectionRect);
    selectionRect = L.rectangle([selectionStart, selectionStart], {
      color: 'yellow',
      weight: 1,
      fillOpacity: 0.1
    }).addTo(gridLayer);
  });

  map.on('mousemove', (e) => {
    if (!isDrawingSelection || !selectionRect) return;
    selectionRect.setBounds(L.latLngBounds(selectionStart, e.latlng));
  });

  map.on('mouseup', (e) => {
    if (!isDrawingSelection) return;
    isDrawingSelection = false;
    if (!selectionRect) return;

    const bounds = selectionRect.getBounds();
    gridLayer.removeLayer(selectionRect);
    selectionRect = null;

    applyRectangleSelection(bounds);
  });
}

// --- Taille hex ---
function currentHexSize() {
  const v = parseFloat(hexSizeInput.value);
  return Number.isFinite(v) && v > 0 ? v : 100;
}

// --- Dessin de la grille ---
function drawGrid() {
  if (!map || !mapSize) return;
  gridLayer.clearLayers();

  const size = currentHexSize();
  const qMin = Math.floor(-size / (1.5 * size));
  const qMax = Math.ceil((mapSize.w + size) / (1.5 * size));

  for (let q = qMin; q <= qMax; q++) {
    const rMin = Math.floor((-size) / (Math.sqrt(3) * size) - q / 2);
    const rMax = Math.ceil((mapSize.h + size) / (Math.sqrt(3) * size) - q / 2);

    for (let r = rMin; r <= rMax; r++) {
      const key = `${q},${r}`;
      if (removedHexes.has(key) && !addedHexes.has(key)) continue;

      const coords = hexPolygonLatLng(q, r, size);
      const isAdded = addedHexes.has(key);

      const poly = L.polygon(coords, {
        color: isAdded ? '#00a86b' : 'white',
        weight: 1,
        opacity: 0.95,
        fill: true,
        fillOpacity: isAdded ? 0.10 : 0.04,
        interactive: true
      }).addTo(gridLayer);

      // Suppression/ajout individuel
      poly.on('click', () => {
        if (addedHexes.has(key)) {
          addedHexes.delete(key);
          removedHexes.delete(key);
        } else {
          if (removedHexes.has(key)) removedHexes.delete(key);
          else removedHexes.add(key);
        }
        drawGrid();
      });

      poly.on('contextmenu', (e) => {
        if (e.originalEvent) e.originalEvent.preventDefault();
        addedHexes.add(key);
        removedHexes.delete(key);
        drawGrid();
      });
    }
  }

  // Redessiner les hex ajoutés hors bornes
  addedHexes.forEach(k => {
    const [q, r] = k.split(',').map(Number);
    const coords = hexPolygonLatLng(q, r, size);
    const poly = L.polygon(coords, {
      color: '#00a86b',
      weight: 1,
      opacity: 0.95,
      fill: true,
      fillOpacity: 0.10,
      interactive: true
    }).addTo(gridLayer);
    poly.on('click', () => {
      addedHexes.delete(k);
      removedHexes.delete(k);
      drawGrid();
    });
  });
}

// --- Application sélection rectangulaire ---
function applyRectangleSelection(bounds) {
  const size = currentHexSize();
  const qMin = Math.floor(-size / (1.5 * size));
  const qMax = Math.ceil((mapSize.w + size) / (1.5 * size));

  for (let q = qMin; q <= qMax; q++) {
    const rMin = Math.floor((-size) / (Math.sqrt(3) * size) - q / 2);
    const rMax = Math.ceil((mapSize.h + size) / (Math.sqrt(3) * size) - q / 2);

    for (let r = rMin; r <= rMax; r++) {
      const { x, y } = axial_to_pixel(q, r, size);
      const point = L.latLng(y, x);
      if (bounds.contains(point)) {
        const key = `${q},${r}`;
        if (removedHexes.has(key)) removedHexes.delete(key);
        else removedHexes.add(key);
      }
    }
  }
  drawGrid();
}

// --- Actions UI ---
genGridBtn.addEventListener('click', () => {
  if (!currentMapPath) {
    alert("Sélectionne d'abord une carte.");
    return;
  }
  removedHexes = new Set();
  addedHexes = new Set();
  drawGrid();
});

exportProjectBtn.addEventListener('click', () => {
  const data = {
    map: currentMapPath,
    hexSize: currentHexSize(),
    removedHexes: Array.from(removedHexes).map(k => k.split(',').map(Number)),
    addedHexes: Array.from(addedHexes).map(k => k.split(',').map(Number)),
    armies: []
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'project.json';
  a.click();
});

// --- Événements ---
if (mapSelector) {
  mapSelector.addEventListener('change', loadSelectedMap);
}

document.addEventListener('DOMContentLoaded', loadMapsList);
