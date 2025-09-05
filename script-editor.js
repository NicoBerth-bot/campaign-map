// Editor script
const assetSelect = document.getElementById('assetSelect');
const genGridBtn = document.getElementById('genGridBtn');
const exportProjectBtn = document.getElementById('exportProject');
const hexSizeInput = document.getElementById('hexSize');
const assets = ['assets/map.jpg'];
assets.forEach(a=>{ const o=document.createElement('option'); o.value=a; o.textContent=a; assetSelect.appendChild(o); });
let currentMapPath = null;

async function loadMapsList() {
  try {
    const response = await fetch('assets/assets.json');
    if (!response.ok) throw new Error("Impossible de charger assets.json");
    const data = await response.json();
    const select = document.getElementById('mapSelector');
    select.innerHTML = ""; // vider la liste si rechargée

    data.maps.forEach(map => {
      const option = document.createElement('option');
      option.value = `assets/${map.file}`;
      option.textContent = map.name;
      select.appendChild(option);
    });
  } catch (e) {
    console.error("Erreur lors du chargement des cartes :", e);
  }
}

function loadSelectedMap() {
  const select = document.getElementById('mapSelector');
  currentMapPath = select.value; // mémorise la carte choisie
  if (!currentMapPath) return;
  initMap(currentMapPath).then(() => drawGrid());

}

// Appeler cette fonction au démarrage
document.addEventListener('DOMContentLoaded', loadMapsList);


let map, imgLayer, gridLayer, mapSize, removedHexes=new Set(), addedHexes=new Set();

function currentHexSize(){ return parseFloat(hexSizeInput.value||100); }
function loadImage(src){ return new Promise((res,rej)=>{const img=new Image(); img.onload=()=>res(img); img.onerror=rej; img.src=src;}); }
async function initMap(imgPath){
  if(map) map.remove();
  map = L.map('map',{crs:L.CRS.Simple, minZoom:-5});
  const img = await loadImage(imgPath);
  mapSize = {w:img.naturalWidth, h:img.naturalHeight};
  const bounds = L.latLngBounds([[0,0],[mapSize.h,mapSize.w]]);
  imgLayer = L.imageOverlay(imgPath,bounds).addTo(map);
  map.fitBounds(bounds); map.setMaxBounds(bounds.pad(0.1));
  gridLayer = L.layerGroup().addTo(map);
  map.on('contextmenu', e=> e.originalEvent.preventDefault());
}

function hexToPixel(q,r,size){ const width=size*2; const height=Math.sqrt(3)*size; const x=q*(3/4*width); const y=r*height + (q%2)*(height/2); return {x,y}; }
function hexPolygonLatLng(q,r,size){ const c=hexToPixel(q,r,size); const pts=[]; for(let i=0;i<6;i++){ const ang=Math.PI/180*(60*i); pts.push([c.y + size*Math.sin(ang), c.x + size*Math.cos(ang)]);} return pts; }

function drawGrid(){
  gridLayer.clearLayers();
  const size=currentHexSize();
  const cols=Math.ceil(mapSize.w/(Math.sqrt(3)*size))+6;
  const rows=Math.ceil(mapSize.h/(1.5*size))+6;
  for(let r=-5;r<=rows;r++){ for(let q=-5;q<=cols;q++){
    const key=`${q},${r}`;
    if(removedHexes.has(key) && !addedHexes.has(key)) continue;
    const pts=hexPolygonLatLng(q,r,size);
    const poly=L.polygon(pts,{color:'white', weight:1, opacity:0.95, fill:false, interactive:true}).addTo(gridLayer);
    poly.options.hexCoords={q,r};
    poly.on('click',(e)=>{
      const k=`${q},${r}`;
      if(e.originalEvent.ctrlKey){ addedHexes.add(k); }
      else { if(removedHexes.has(k)) removedHexes.delete(k); else removedHexes.add(k); }
      drawGrid();
    });
  }}
  // draw added outside grid
  addedHexes.forEach(k=>{ const [q,r]=k.split(',').map(Number); const pts=hexPolygonLatLng(q,r,size); const poly=L.polygon(pts,{color:'white', weight:1, opacity:0.95, fill:false}).addTo(gridLayer); poly.options.hexCoords={q,r}; poly.on('click',()=>{ const key=k; if(removedHexes.has(key)) removedHexes.delete(key); else removedHexes.add(key); drawGrid(); }); });
}

genGridBtn.addEventListener('click', async ()=>{ await initMap(assetSelect.value); removedHexes=new Set(); addedHexes=new Set(); drawGrid(); });
exportProjectBtn.addEventListener('click', ()=>{
  const data={ map: assetSelect.value, hexSize: currentHexSize(), removedHexes: Array.from(removedHexes).map(k=>k.split(',').map(Number)), addedHexes: Array.from(addedHexes).map(k=>k.split(',').map(Number)), armies: [] };
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='project.json'; a.click();
});

// init default
initMap('assets/map.jpg').then(()=>drawGrid()).catch(()=>{});
