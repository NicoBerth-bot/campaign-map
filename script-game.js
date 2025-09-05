// script-game.js – Mode Campagne (diagnostic)
// Donne des erreurs explicites, filtre les données de grille, et loggue les étapes.

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
  let project = null;
  let removedHexes = new Set(); // "q,r"
  let addedHexes   = new Set(); // "q,r"
  let armies       = [];        // [{id, name, color, q, r}]
  let addMode      = null;      // {name,color}

  // ---- Utils ----
  const log = (...a) => console.info('[BDS:campaign]', ...a);
  const warn = (...a) => console.warn('[BDS:campaign]', ...a);
  const err  = (...a) => console.error('[BDS:campaign]', ...a);

  function escapeHtml(s) {
    return String(s ?? '')
      .replaceAll('&','&amp;').replaceAll('<','&lt;')
      .replaceAll('>','&gt;').replaceAll('"','&quot;')
      .replaceAll("'",'&#039;');
  }

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
    return [c.y, c.x];
  }
  function hexPolygonLatLng(q, r, size) {
    const c = axial_to_pixel(q, r, size);
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const ang = Math.PI/180 * (60 * i);
      pts.push([c.y + size * Math.sin(ang), c.x + size * Math.cos(ang)]);
    }
    return pts;
  }

  // ---- Map setup ----
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(new Error('Image load error for ' + src));
      img.src = src;
    });
  }

  async function initMap(imgPath) {
    log('initMap ->', imgPath);
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

    // Placer une armée si addMode actif
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

    try {
      const qMin = Math.floor(-size / (1.5 * size));
      const qMax = Math.ceil((mapSize.w + size) / (1.5 * size));

      for (let q = qMin; q <= qMax; q++) {
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
            interactive: false
          }).addTo(gridLayer);
        }
      }

      // Ajouts hors base
      addedHexes.forEach(k => {
        const [q, r] = k.split(',').map(Number);
        if (!Number.isFinite(q) || !Number.isFinite(r)) return;
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

      log('drawGrid -> OK');
    } catch (e) {
      err('drawGrid failed:', e);
      alert('Erreur pendant l’affichage de la grille (voir Console).');
    }
  }

  // ---- Armies ----
  function renderArmies() {
    if (!armyLayer) return;
    armyLayer.clearLayers();

    const size = project?.hexSize || 100;
    const snap  = !!toggleSnapEl.checked;

    armies.forEach(a => {
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
          a._latlng = marker.getLatLng();
        }
        updateArmyList();
      });

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

  // ---- Validation & coercion ----
  function validateProjectSchema(p) {
    const errs = [];
    if (!p || typeof p !== 'object') errs.push("Le contenu n'est pas un objet JSON.");
    if (!p.map || typeof p.map !== 'string') errs.push("Champ 'map' manquant ou non texte.");
    if (!(Number(p.hexSize) > 0)) errs.push("Champ 'hexSize' manquant ou non numérique (>0).");
    if (p.armies && !Array.isArray(p.armies)) errs.push("'armies' doit être un tableau.");
    return errs;
  }

  function coercePairArray(arr, label) {
    const out = [];
    if (!Array.isArray(arr)) return out;
    for (let i = 0; i < arr.length; i++) {
      const el = arr[i];
      if (!Array.isArray(el) || el.length !== 2) {
        warn(`${label}[${i}] ignoré (pas une paire)`, el);
        continue;
      }
      const q = Number(el[0]), r = Number(el[1]);
      if (!Number.isFinite(q) || !Number.isFinite(r)) {
        warn(`${label}[${i}] ignoré (non numérique)`, el);
        continue;
      }
      out.push([q, r]);
    }
    return out;
  }

  // ---- Import / Export ----
  if (importInput) {
    importInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          let text = String(reader.result || '').replace(/^\uFEFF/, '');
          if (/^\s*<!doctype html>|^\s*<html/i.test(text)) {
            alert("Le fichier importé est une page HTML (pas un JSON). Ré-exporte depuis l’éditeur.");
            return;
          }
          let obj;
          try {
            obj = JSON.parse(text);
          } catch (parseErr) {
            err("JSON.parse a échoué :", parseErr);
            alert("Erreur de syntaxe JSON (voir Console).");
            return;
          }

          const errors = validateProjectSchema(obj);
          if (errors.length) {
            warn('Schéma invalide:', errors, obj);
            alert("Projet JSON invalide :\n- " + errors.join("\n- "));
            return;
          }

          // Coercion/filtrage des paires
          obj.removedHexes = coercePairArray(obj.removedHexes ?? [], 'removedHexes');
          obj.addedHexes   = coercePairArray(obj.addedHexes   ?? [], 'addedHexes');

          await loadCampaign(obj);
        } catch (e) {
          err(e);
          alert("Échec de chargement (voir Console).");
        }
      };
      reader.readAsText(file);
    });
  }

  async function loadCampaign(p) {
    log('loadCampaign start');

    project = {
      map: p.map,
      hexSize: Number(p.hexSize) || 100,
      removedHexes: Array.isArray(p.removedHexes) ? p.removedHexes : [],
      addedHexes:   Array.isArray(p.addedHexes)   ? p.addedHexes   : [],
      armies:       Array.isArray(p.armies)       ? p.armies       : []
    };

    // Sets (sécurisés)
    removedHexes = new Set(project.removedHexes.map(([q,r]) => `${q},${r}`));
    addedHexes   = new Set(project.addedHexes.map(([q,r])     => `${q},${r}`));

    // Vérifier l'image par HEAD (si possible)
    try {
      const head = await fetch(project.map, { method: 'HEAD' });
      if (!head.ok) {
        alert(`Image introuvable : ${project.map}\nHTTP ${head.status} ${head.statusText}`);
        warn('HEAD failed:', head.status, head.statusText, 'for', project.map);
        return;
      }
    } catch (e) {
      // Certains environnements bloquent HEAD → on ignore, initMap testera de toutes façons
      warn('HEAD check échoué, on tente initMap quand même…', e);
    }

    // Armées : normalisation
    armies = project.armies.map(a => ({
      id: a.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random())),
      name: a.name || 'Armée',
      color: a.color || '#d22a2a',
      q: Number.isFinite(a.q) ? a.q : 0,
      r: Number.isFinite(a.r) ? a.r : 0
    }));

    // Initialiser la carte puis dessiner
    try {
      await initMap(project.map);
      drawGrid();
      renderArmies();
      updateArmyList();
      log('loadCampaign OK');
    } catch (e) {
      err('initMap/draw failed:', e);
      alert(`Erreur pendant l’initialisation de la carte/grille (voir Console).`);
    }
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

  // Mémoriser l’état du snap
  toggleSnapEl?.addEventListener('change', () => {
    try { localStorage.setItem('bds_snap', toggleSnapEl.checked ? '1' : '0'); } catch(e){}
  });
  try {
    const snap = localStorage.getItem('bds_snap');
    if (snap !== null) toggleSnapEl.checked = snap === '1';
  } catch(e){}

})();
