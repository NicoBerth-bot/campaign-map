// Game script
const projFileInput = document.getElementById('projFile');
const addArmyBtn = document.getElementById('addArmyBtn');
const exportArmiesBtn = document.getElementById('exportArmies');
const gameHexSizeInput = document.getElementById('gameHexSize');
let gameMap, imgLayer, gridLayer, armyLayer, project=null, mapSize=null, addMode=null, armies=[];

function hexToPixel(q,r,size){ const width=size*2; const height=Math.sqrt(3)*size; const x=q*(3/4*width); const y=r*height + (q%2)*(height/2); return {x,y}; }
function pixelToHex(x,y,size){ const approxQ=Math.round(x/(size*1.5)); const approxR=Math.round(y/(Math.sqrt(3)*size)); return {q:approxQ, r:approxR}; }
function hexCenterLatLng(q,r,size){ const p=hexToPixel(q,r,size); return [p.y,p.x]; }
function loadImage(src){ return new Promise((res,rej)=>{ const img=new Image(); img.onload=()=>res(img); img.onerror=rej; img.src=src; }); }

async function initMapForGame(mapPath, hexSize){
  if(gameMap) gameMap.remove();
  gameMap = L.map('map',{crs:L.CRS.Simple, minZoom:-5});
  const img = await loadImage(mapPath); mapSize={w:img.naturalWidth, h:img.naturalHeight};
  const bounds = L.latLngBounds([[0,0],[mapSize.h,mapSize.w]]);
  imgLayer = L.imageOverlay(mapPath,bounds).addTo(gameMap);
  gameMap.fitBounds(bounds); gameMap.setMaxBounds(bounds.pad(0.1));
  gridLayer = L.layerGroup().addTo(gameMap); armyLayer = L.layerGroup().addTo(gameMap);
  drawGridGame(hexSize);
  gameMap.on('click', e=>{ if(addMode){ const hex=pixelToHex(e.latlng.lng,e.latlng.lat, parseFloat(gameHexSizeInput.value)); const id=crypto.randomUUID(); const a={id, name:addMode.name, color:addMode.color, q:hex.q, r:hex.r}; armies.push(a); addMode=null; renderArmies(); } });
}

function drawGridGame(size){
  gridLayer.clearLayers(); if(!project) return;
  const baseSize=size; const cols=Math.ceil(mapSize.w/(Math.sqrt(3)*baseSize))+6; const rows=Math.ceil(mapSize.h/(1.5*baseSize))+6;
  const removedSet=new Set((project.removedHexes||[]).map(arr=>arr.join(','))); const added=project.addedHexes||[];
  for(let r=-5;r<=rows;r++){ for(let q=-5;q<=cols;q++){ const key=`${q},${r}`; if(removedSet.has(key)) continue; const center=hexToPixel(q,r,baseSize); const pts=[]; for(let i=0;i<6;i++){ const ang=Math.PI/180*(60*i); pts.push([center.y + baseSize*Math.sin(ang), center.x + baseSize*Math.cos(ang)]); } L.polygon(pts,{color:'white', weight:1, opacity:0.9, fill:false, interactive:false}).addTo(gridLayer); }} added.forEach(arr=>{ const q=arr[0], r=arr[1]; const center=hexToPixel(q,r,baseSize); const pts=[]; for(let i=0;i<6;i++){ const ang=Math.PI/180*(60*i); pts.push([center.y + baseSize*Math.sin(ang), center.x + baseSize*Math.cos(ang)]); } L.polygon(pts,{color:'white', weight:1, opacity:0.9, fill:false}).addTo(gridLayer); }); 
}

function renderArmies(){ armyLayer.clearLayers(); armies.forEach(a=>{ const pos=hexCenterLatLng(a.q,a.r, parseFloat(gameHexSizeInput.value)); const icon = L.divIcon({ className:'', html:`<div style="width:18px;height:18px;border-radius:50%;background:${a.color};border:2px solid #000;"></div>`, iconSize:[18,18], iconAnchor:[9,9] }); const marker=L.marker(pos,{draggable:true, icon}).addTo(armyLayer); marker.on('dragend', ()=>{ const p=marker.getLatLng(); const hex=pixelToHex(p.lng,p.lat, parseFloat(gameHexSizeInput.value)); a.q=hex.q; a.r=hex.r; renderArmies(); }); marker.bindTooltip(a.name,{permanent:false}); }); }

projFileInput.addEventListener('change', (e)=>{ const f=e.target.files[0]; if(!f) return; const reader=new FileReader(); reader.onload=async ()=>{ try{ project=JSON.parse(reader.result); await initMapForGame(project.map, project.hexSize||100); armies=project.armies||[]; renderArmies(); gameHexSizeInput.value = project.hexSize || 100; } catch(err){ alert('Projet invalide'); } }; reader.readAsText(f); });

addArmyBtn.addEventListener('click', ()=>{ const name=prompt('Nom de l\\'armée','Armée'); if(!name) return; const color=prompt('Couleur (#rrggbb)','#ff0000')||'#ff0000'; addMode={name,color}; alert('Clique sur la carte pour placer l\\'armée.'); });
exportArmiesBtn.addEventListener('click', ()=>{ const blob=new Blob([JSON.stringify({armies},null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='armies.json'; a.click(); });
