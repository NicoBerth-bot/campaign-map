// script-game.js – Mode Campagne (chargement projet + grille + armées)
// - Import project.json (de l’éditeur)
// - Affiche la carte + grille flat-top cohérente
// - Ajouter/Déplacer des armées (drag & drop), snap optionnel
// - Export de l’état complet (incluant les armées)

(() => {
  'use strict';

  // ---- UI ----
  const importInput     = document.getElementById('importProject');
  const toggleGridEl    = document.getElementById('toggleGrid');
  const toggleSnapEl    = document.getElementById('toggleSnap');
  const addArmyBtn      = document.getElementById('addArmyBtn');
  const armyNameEl      = document.getElementById('armyName');
  const armyColorEl     = document.getElementById('armyColor');
  const exportStateBtn  = document.getElementById('exportStateBtn');
  const clearArmiesBtn  = document.getElementById('clearArmiesBtn');
  const armyListEl      = document.getElementById('armyList');

  // ---- State ----
  let map = null, imgLayer = null, gridLayer = null, armyLayer = null;
  let mapSize = null;
  let project = null;           // le projet chargé tel quel (map, hexSize, removedHexes, addedHexes, armies?)
  let removedHexes = new Set(); // "q,r"
  let addedHexes   = new Set(); // "q,r"
  let armies       = [];        // [{id, name, color, q, r}]
  let addMode      = null;      // {name,color} quand on clique "Ajouter une armée"

  // ---- Hex math (flat-top, axial) ----
  function axial_to_pixel(q, r, size) {
    const x = size * 1.5 * q;
    const y = size * Math.sqrt(3) * (r + q / 2);
    return { x, y };
  }
  function pixel_to_axial(x, y, size) {
    const q = (2/3) * x / size;
    const r = (y / (Math.sqrt(3) * size)) - q/2;
    return { q, r };
  }
  function cube_round(x, y, z) {
    let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
    const x_diff = Math.abs(rx - x), y_diff = Math.abs(ry - y), z_diff = Math.abs(rz - z);
    if (x_diff > y_diff && x_diff > z_diff) rx = -ry - rz;
    else if (y_diff > z_diff)               ry = -rx - rz;
    else                                    rz = -rx - ry;
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
  function hexCenterLatLng(q, r, size) {
    const c = axial_to_pixel(q, r, size);
    return [c.y, c.x]; // Leaflet: [lat(y), lng(x)]
  }
  function hexPolygonLatLng(q, r, size) {
    const c = axial_to_pixel(q, r, size);
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const angle = Math.PI/180 * (60 * i); // flat-top
      pts.push([c.y + size * Math.sin(angle), c.x + size * Math.cos(angle)]);
    }
    return pts;
  }

  // ---- Map setup ----
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

    const bounds = L.latLngBounds([[0,0],[mapSize.h, mapSize.w]]);
    imgLayer  = L.imageOverlay(imgPath, bounds).addTo(map);
    map.fitBounds(bounds);
    map.setMaxBounds(bounds.pad(0.1));

    gridLayer = L.layerGroup().addTo(map);
    armyLayer = L.layerGroup().addTo(map);

    // Clic sur la carte pour placer une armée si "addMode" est actif
    map.on('click', (e) => {
      if (!addMode || !project) return;
      const size = project.hexSize || 100;
      const { q, r } = pixelToHex_axial(e.latlng.lng, e.latlng.lat, size);
      const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());

      const army = {
        id,
        name: addMode.name || 'Armée',
        color: addMode.color || '#d22a2a',
        q, r
      };
      armies.push(army);
      addMode = null;
      renderArmies();
      updateArmyList();
    });
  }

  // ---- Grid ----
  function drawGrid() {
    if (!map || !mapSize || !project) return;
    gridLayer.clearLayers();
    if (!toggleGridEl.checked) return;

    const size = project.hexSize || 100;

    // Bornes q : centre.x = 1.5*size*q
    const qMin = Math.floor(-size / (1.5 * size));
    const qMax = Math.ceil((mapSize.w + size) / (1.5 * size));

    for (let q = qMin; q <= qMax; q++) {
      // rMin/rMax dépendent de q : centre.y = √3*size*(r + q/2)
      const rMin = Math.floor((-size) / (Math.sqrt(3)*size) - q/2);
      const rMax = Math.ceil((mapSize.h + size) / (Math.sqrt(3)*size) - q/2);

      for (let r = rMin; r <= rMax; r++) {
        const key = `${q},${r}`;
        if (removedHexes.has(key) && !addedHexes.has(key)) continue;

        const coords = hexPolygonLatLng(q, r, size);
        L.polygon(coords, {
          color: 'white',
          weight: 1,
          opacity: 0.95,
          fill: true,
          fillOpacity: 0.04,
          interactive: false // en mode campagne, la grille n’est pas éditable
        }).addTo(gridLayer);
      }
    }

    // Hex ajoutés “hors base” éventuels
    addedHexes.forEach(k => {
      const [q, r] = k.split(',').map(Number);
      const coords = hexPolygonLatLng(q, r, size);
      L.polygon(coords, {
        color: 'white',
        weight: 1,
        opacity: 0.95,
        fill: true,
        fillOpacity: 0.04,
        interactive: false
      }).addTo(gridLayer);
    });
  }

  // ---- Armies ----
  function renderArmies() {
    if (!armyLayer) return;
    armyLayer.clearLayers();

    const size = project?.hexSize || 100;
    const snap  = !!toggleSnapEl.checked;

    armies.forEach(a => {
      // (optionnel) re-snap au rendu si nécessaire (maintient cohérence après changement hexSize)
      if (snap) {
        const center = hexCenterLatLng(a.q, a.r, size);
        a._latlng = { lat: center[0], lng: center[1] };
      }

      const icon = L.divIcon({
        className: '',
        html: `<div style="width:16px;height:16px;border-radius:50%;background:${a.color};border:2px solid #000;"></div>`,
        iconSize: [16,16],
        iconAnchor: [8,8]
      });

      const latlng = a._latlng || hexCenterLatLng(a.q, a.r, size);
      const marker = L.marker(latlng, { draggable: true, icon }).addTo(armyLayer);
      marker.bindTooltip(a.name, { permanent:false, direction:'top' });

      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        if (toggleSnapEl.checked) {
          const hex = pixelToHex_axial(pos.lng, pos.lat, size);
          a.q = hex.q; a.r = hex.r;
          marker.setLatLng(hexCenterLatLng(a.q, a.r, size));
        } else {
          const hex = pixelToHex_axial(pos.lng, pos.lat, size);
          a.q = hex.q; a.r = hex.r;
          a._latlng = marker.getLatLng(); // conserve latlng libre si pas de snap
        }
        updateArmyList();
      });

      // Option: Ctrl+click pour supprimer rapidement une armée
      marker.on('click', (e) => {
        if (e.originalEvent && e.originalEvent.ctrlKey) {
          armies = armies.filter(x => x.id !== a.id);
          renderArmies();
          updateArmyList();
        }
      });
    });
  }

  function updateArmyList() {
    if (!armyListEl) return;
    armyListEl.innerHTML = '';
    armies.forEach(a => {
      const row = document.createElement('div');
      row.innerHTML = `
        <span class="badge" style="background:${a.color}"></span>
        <strong>${escapeHtml(a.name)}</strong>
        <span class="muted">(q=${a.q}, r=${a.r})</span>
        <button data-id="${a.id}" title="Supprimer">🗑️</button>
      `;
      row.querySelector('button').addEventListener('click', () => {
        armies = armies.filter(x => x.id !== a.id);
        renderArmies();
        updateArmyList();
      });
      armyListEl.appendChild(row);
    });
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#039;');
  }

  // ---- Import / Export ----
  async function loadCampaign(p) {
    if (!p || !p.map) {
      alert("Projet invalide : champ 'map' manquant.");
      return;
    }
    project = {
      map: p.map,
      hexSize: Number(p.hexSize) > 0 ? Number(p.hexSize) : 100,
      removedHexes: Array.isArray(p.removedHexes) ? p.removedHexes : [],
      addedHexes:   Array.isArray(p.addedHexes)   ? p.addedHexes   : [],
      armies:       Array.isArray(p.armies)       ? p.armies       : []
    };

    // Synchronise les sets
    removedHexes = new Set(project.removedHexes.map(([q,r]) => `${q},${r}`));
    addedHexes   = new Set(project.addedHexes.map(([q,r])     => `${q},${r}`));

    // Armées
    armies = project.armies.map(a => ({
      id: a.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random())),
      name: a.name || 'Armée',
      color: a.color || '#d22a2a',
      q: Number.isFinite(a.q) ? a.q : 0,
      r: Number.isFinite(a.r) ? a.r : 0
    }));

    await initMap(project.map);
    drawGrid();
    renderArmies();
    updateArmyList();
  }

  function exportState() {
    if (!project) {
      alert("Aucun projet chargé.");
      return;
    }
    const out = {
      map: project.map,
      hexSize: project.hexSize,
      removedHexes: Array.from(removedHexes).map(k => k.split(',').map(Number)),
      addedHexes:   Array.from(addedHexes).map(k => k.split(',').map(Number)),
      armies: armies.map(a => ({ id: a.id, name: a.name, color: a.color, q: a.q, r: a.r }))
    };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'campaign-state.json';
    a.click();
  }

  // ---- UI wiring ----
  if (importInput) {
    importInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const p = JSON.parse(reader.result);
          await loadCampaign(p);
        } catch (err) {
          console.error(err);
          alert("Impossible de lire le JSON du projet.");
        }
      };
      reader.readAsText(file);
    });
  }

  toggleGridEl?.addEventListener('change', drawGrid);

  addArmyBtn?.addEventListener('click', () => {
    if (!project) { alert("Charge d'abord un projet (JSON)."); return; }
    const name  = (armyNameEl.value || 'Armée').trim();
    const color = armyColorEl.value || '#d22a2a';
    addMode = { name, color };
    alert("Clique sur la carte pour placer l'armée.");
  });

  exportStateBtn?.addEventListener('click', exportState);

  clearArmiesBtn?.addEventListener('click', () => {
    if (!armies.length) return;
    const ok = confirm("Supprimer toutes les armées ?");
    if (!ok) return;
    armies = [];
    renderArmies();
    updateArmyList();
  });

  // (Optionnel) mémoriser l’état du snap en localStorage
  toggleSnapEl?.addEventListener('change', () => {
    try { localStorage.setItem('bds_snap', toggleSnapEl.checked ? '1' : '0'); } catch(e){}
  });
  try {
    const snap = localStorage.getItem('bds_snap');
    if (snap !== null) toggleSnapEl.checked = snap === '1';
  } catch(e){}

})();
