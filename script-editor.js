// --- EDITOR (grille éditable + assets.json + ajout/suppression) ---

// UI
const genGridBtn = document.getElementById('genGridBtn');
const exportProjectBtn = document.getElementById('exportProject');
const hexSizeInput = document.getElementById('hexSize');

let mapSelector = document.getElementById('mapSelector'); // doit exister dans editor.html
let currentMapPath = null;

// State
let map, imgLayer, gridLayer;
let mapSize = null;
let removedHexes = new Set();
let addedHexes = new Set();

// --- Chargement des cartes depuis assets.json (file + name) ---
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

    // Sélection par défaut
    if (mapSelector.options.length > 0) {
      mapSelector.selectedIndex = 0;
      currentMapPath = mapSelector.value;
      await initMap(currentMapPath);
      drawGrid();
    }
  } catch (e) {
    console.error(e);
  }
}

function loadSelectedMap() {
  currentMapPath = mapSelector.value;
  if (!currentMapPath) return;
  initMap(currentMapPath).then(drawGrid);
}

// --- Helpers généraux ---
function currentHexSize() {
  const v = parseFloat(hexSizeInput.value);
  return Number.isFinite(v) && v > 0 ? v : 100;
}
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// --- Carte Leaflet ---
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

  // Empêcher le menu contextuel natif pour autoriser clic droit = ajout d'hex
  map.on('contextmenu', (e) => {
    e.originalEvent.preventDefault();
    // Ajout d'un hex à l'endroit du clic droit
    const size = currentHexSize();
    const { q, r } = pixelToHex_axial(e.latlng.lng, e.latlng.lat, size);
    const key = `${q},${r}`;
    addedHexes.add(key);
    removedHexes.delete(key);
    drawGrid();
  });

  // Ctrl+clic n'importe où sur la carte = ajout d'hex
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
}

// --- Géométrie hex (flat-top, axial) ---
// Formules "Red Blob Games" adaptées flat-top (axial q,r)
function axial_to_pixel(q, r, size) {
  const x = size * (3 / 2) * q;
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
  // axial (q,r) -> cube (x=q, z=r, y=-x-z) -> round -> axial
  const x = q, z = r, y = -x - z;
  const cr = cube_round(x, y, z);
  return { q: cr.x, r: cr.z };
}
function hexPolygonLatLng(q, r, size) {
  const c = axial_to_pixel(q, r, size);
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const ang = Math.PI / 180 * (60 * i); // flat-top
    pts.push([c.y + size * Math.sin(ang), c.x + size * Math.cos(ang)]);
  }
  return pts;
}
// Confort : raccourci
function pixelToHex_axial(x, y, size) {
  const frac = pixel_to_axial(x, y, size);
  return axial_round(frac.q, frac.r);
}

// --- Grille : dessin + interactions ---
function drawGrid() {
  gridLayer.clearLayers();
  const size = currentHexSize();

  // Couverture rectangle de l'image (marges pour éviter bords vides)
  const qMax = Math.ceil(mapSize.w / (1.5 * size)) + 4;            // 1.5*size = pas horizontal (flat-top)
  const rMax = Math.ceil(mapSize.h / (Math.sqrt(3) * size)) + 4;   // sqrt(3)*size = pas vertical

  // Dessin de la grille "de base"
  for (let r = -4; r <= rMax; r++) {
    for (let q = -4; q <= qMax; q++) {
      const key = `${q},${r}`;
      if (removedHexes.has(key) && !addedHexes.has(key)) continue;

      const coords = hexPolygonLatLng(q, r, size);
      const poly = L.polygon(coords, {
        color: 'white',
        weight: 1,
        opacity: 0.95,
        fill: true,          // fill pour augmenter la zone cliquable
        fillOpacity: 0.05,   // discret
        interactive: true
      }).addTo(gridLayer);

      poly.options.hexCoords = { q, r };

      // Clic gauche : bascule suppression/activation
      poly.on('click', (e) => {
        // Si Ctrl+clic sur un hex déjà présent, on force "ajout explicite"
        if (e.originalEvent && e.originalEvent.ctrlKey) {
          addedHexes.add(key);
          removedHexes.delete(key);
        } else {
          if (removedHexes.has(key)) removedHexes.delete(key);
          else removedHexes.add(key);
        }
        drawGrid();
      });

      // Clic droit sur un hex : marquer comme "ajouté" (utile si en zone limite)
      poly.on('contextmenu', (e) => {
        e.originalEvent.preventDefault();
        addedHexes.add(key);
        removedHexes.delete(key);
        drawGrid();
      });
    }
  }

  // Dessin des hex "ajoutés" explicites qui seraient hors de la base
  addedHexes.forEach(k => {
    const [q, r] = k.split(',').map(Number);
    // S'ils ont déjà été dessinés ci-dessus, inutile de les redessiner
    // (On laisse quand même ce bloc pour les hex vraiment hors couverture)
    const coords = hexPolygonLatLng(q, r, size);
    const poly = L.polygon(coords, {
      color: 'white',
      weight: 1,
      opacity: 0.95,
      fill: true,
      fillOpacity: 0.05,
      interactive: true
    }).addTo(gridLayer);
    poly.options.hexCoords = { q, r };

    poly.on('click', () => {
      const key = `${q},${r}`;
      if (removedHexes.has(key)) removedHexes.delete(key);
      else removedHexes.add(key);
      drawGrid();
    });
    poly.on('contextmenu', (e) => {
      e.originalEvent.preventDefault();
      const key = `${q},${r}`;
      addedHexes.add(key);
      removedHexes.delete(key);
      drawGrid();
    });
  });
}

// --- Actions UI ---
genGridBtn.addEventListener('click', () => {
  if (!currentMapPath) {
    alert("Sélectionne d'abord une carte.");
    return;
  }
  // On ne recharge PAS la carte ici : on ne fait que régénérer la grille
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

// --- Démarrage ---
document.addEventListener('DOMContentLoaded', loadMapsList);

// Si tu as un bouton/événement pour changer de carte :
if (mapSelector) {
  mapSelector.addEventListener('change', loadSelectedMap);
}
