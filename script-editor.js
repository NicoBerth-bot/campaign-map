// script-editor.js (VERSION CORRIGÉE)
// Grille editable (flat-top), suppression/ajout d'hex,
// extents calculés pour coller à la taille d'image,
// clic gauche = toggle suppression (ou suppression d'un hex ajouté),
// Ctrl+clic ou clic-droit sur la carte = ajout d'hex.

// ----------------- UI references -----------------
const mapSelector = document.getElementById('mapSelector'); // <select> rempli depuis assets.json
const genGridBtn = document.getElementById('genGridBtn');
const exportProjectBtn = document.getElementById('exportProject');
const hexSizeInput = document.getElementById('hexSize');

// ----------------- State -----------------
let map = null;
let imgLayer = null;
let gridLayer = null;
let mapSize = null;
let currentMapPath = null;

let removedHexes = new Set(); // clés "q,r" pour hex supprimés
let addedHexes = new Set();   // clés "q,r" pour hex ajoutés explicitement

// ----------------- Helpers mathématiques (flat-top axial) -----------------
// axial -> pixel (center)
function axial_to_pixel(q, r, size) {
  // flat-top axial coordinates (RedBlob)
  const x = size * (3 / 2) * q;
  const y = size * Math.sqrt(3) * (r + q / 2);
  return { x, y };
}

// pixel -> axial (fractional), puis on arrondit correctement
function pixel_to_axial(x, y, size) {
  const q = (2 / 3) * x / size;
  const r = (y / (Math.sqrt(3) * size)) - q / 2;
  return { q, r };
}

// cube rounding for correct integer axial
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
  const x = q;
  const z = r;
  const y = -x - z;
  const cr = cube_round(x, y, z);
  return { q: cr.x, r: cr.z };
}

// Pixel -> rounded axial (integers)
function pixelToHex_axial(x, y, size) {
  const frac = pixel_to_axial(x, y, size);
  return axial_round(frac.q, frac.r);
}

// Hexagon polygon (lat,lng pairs) for Leaflet (lat=Y, lng=X)
function hexPolygonLatLng(q, r, size) {
  const c = axial_to_pixel(q, r, size);
  const pts = [];
  // flat-top: vertex angles 0,60,120,... (use cos->x, sin->y)
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i);
    const px = c.x + size * Math.cos(angle);
    const py = c.y + size * Math.sin(angle);
    pts.push([py, px]);
  }
  return pts;
}

// ----------------- Chargement de la liste des cartes (assets.json) -----------------
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

    // sélection par défaut et initialisation
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

// appeler pour charger la carte choisie
function loadSelectedMap() {
  currentMapPath = mapSelector.value;
  if (!currentMapPath) return;
  initMap(currentMapPath).then(drawGrid).catch(err => console.error(err));
}

// ----------------- Initialisation de la carte -----------------
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

  // ctrl+clic sur la carte = ajout d'hex (alternative au clic droit)
  map.on('click', (e) => {
    if (e.originalEvent && e.originalEvent.ctrlKey) {
      const size = currentHexSize();
      const { q, r } = pixelToHex_axial(e.latlng.lng, e.latlng.lat, size);
      const key = `${q},${r}`;
      // si c'était marqué supprimé, on le réactive ; sinon on marque en ajouté
      addedHexes.add(key);
      removedHexes.delete(key);
      drawGrid();
    }
  });

  // clic droit sur la carte = ajout d'hex (user-friendly)
  map.on('contextmenu', (e) => {
    e.originalEvent.preventDefault();
    const size = currentHexSize();
    const { q, r } = pixelToHex_axial(e.latlng.lng, e.latlng.lat, size);
    const key = `${q},${r}`;
    addedHexes.add(key);
    removedHexes.delete(key);
    drawGrid();
  });
}

// ----------------- Calcul des extents et dessin -----------------
function currentHexSize() {
  const v = parseFloat(hexSizeInput.value);
  return Number.isFinite(v) && v > 0 ? v : 100;
}

function drawGrid() {
  if (!map || !mapSize) return;
  gridLayer.clearLayers();

  const size = currentHexSize();
  const margin = 0; // on ne rajoute plus de hex inutiles

  // bornes q : en flat-top, centre.x = 1.5 * size * q
  const qMin = Math.floor(-size / (1.5 * size));
  const qMax = Math.ceil((mapSize.w + size) / (1.5 * size));

  for (let q = qMin; q <= qMax; q++) {
    // bornes r spécifiques à chaque colonne
    const rMin = Math.floor((-size) / (Math.sqrt(3) * size) - q / 2) - margin;
    const rMax = Math.ceil((mapSize.h + size) / (Math.sqrt(3) * size) - q / 2) + margin;

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

      poly.options.hexCoords = { q, r };

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

  // On redessine les hex ajoutés hors zone si besoin
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


      // RIGHT CLICK on polygon = mark as added (handy)
      poly.on('contextmenu', (e) => {
        if (e.originalEvent) e.originalEvent.preventDefault();
        addedHexes.add(key);
        removedHexes.delete(key);
        drawGrid();
      });
    }
  }

  // Dessiner aussi les hex "ajoutés" explicitement qui pourraient être en-dehors des bornes calculées
  // (rare mais utile si user a ajouté loin)
  addedHexes.forEach(k => {
    // si déjà dessiné (dans la boucle ci-dessus) skip: on testera par coord within ranges
    // mais pour simplicité: si on n'a pas un poly à ce key, on dessine encore (double-draw est inoffensif)
    const [q, r] = k.split(',').map(Number);
    // sécurité : ne pas dupliquer l'hex déjà présent
    // (we draw with same style as isAdded above)
    const coords = hexPolygonLatLng(q, r, size);
    const poly = L.polygon(coords, {
      color: '#00a86b',
      weight: 1,
      opacity: 0.95,
      fill: true,
      fillOpacity: 0.10,
      interactive: true
    }).addTo(gridLayer);
    poly.options.hexCoords = { q, r };
    poly.on('click', (e) => {
      const key = `${q},${r}`;
      // click on an added hex deletes it
      addedHexes.delete(key);
      removedHexes.delete(key);
      drawGrid();
    });
    poly.on('contextmenu', (e) => {
      if (e.originalEvent) e.originalEvent.preventDefault();
      const key = `${q},${r}`;
      addedHexes.add(key);
      removedHexes.delete(key);
      drawGrid();
    });
  });
}

// ----------------- UI Actions -----------------
genGridBtn.addEventListener('click', () => {
  if (!currentMapPath) {
    alert("Sélectionne d'abord une carte.");
    return;
  }
  // Regénère la grille sans recharger l'image
  // (si tu veux repartir d'une grille vierge, vide removed/added)
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

// Change de carte via select
if (mapSelector) {
  mapSelector.addEventListener('change', loadSelectedMap);
}

// Démarrage : charge la liste d'assets et initialise la première carte
document.addEventListener('DOMContentLoaded', loadMapsList);
