/* Precision position editor: only saved sprinkler positions 12 and 14 are editable. */
(()=>{
'use strict';
const KEY='irrigation-position-edits-12-14-v1',nums=[11,12,14];
let saved={};try{saved=JSON.parse(localStorage.getItem(KEY)||'{}')||{};}catch(e){}
// Preserve any lateral 12 edits made using the earlier 12/13 editor.
if(!saved[12]){try{const old=JSON.parse(localStorage.getItem('irrigation-position-edits-12-13-v1')||'{}');if(old[12])saved[12]=old[12];}catch(e){}}
for(const n of [12,14]){
 const a=saved[n],original=base.routes[n];
 if(Array.isArray(a)&&a.length===original.length&&a.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)))base.routes[n]=structuredClone(a);
}
if(typeof renderMap==='function')renderMap();
let active=false,layer=null,working=null,undo=[],panel=null;
const host=document.getElementById('gpsReminderControls');
const button=document.createElement('button');button.type='button';button.textContent='Edit lateral 12 & 14 positions';button.style.marginTop='8px';host?.append(button);
function circleRadius(n){return Number(equipment[n]?.throw)||12;}
function paint(){
 if(!layer)layer=L.layerGroup().addTo(map);layer.clearLayers();
 for(const n of nums){
  const points=n===11?base.routes[11]:working[n];
  points.forEach((p,i)=>{
   const coverage=L.circle(p,{radius:circleRadius(n),color:n===11?'#ffffff':n===12?'#ffad45':'#f477c9',weight:2,fillOpacity:.12,interactive:false}).addTo(layer);
   const marker=L.marker(p,{draggable:n!==11,autoPan:false,icon:L.divIcon({className:'',html:'<div style="border:2px solid white;border-radius:50%;background:'+(n===11?'#64748b':n===12?'#ad5900':'#a41d64')+';color:white;font-size:12px;font-weight:bold;min-width:29px;height:29px;display:flex;align-items:center;justify-content:center">'+n+':'+(i+1)+'</div>',iconSize:[42,32],iconAnchor:[19,16]})}).addTo(layer);
   if(n!==11){
    marker.on('dragstart',()=>{undo.push(structuredClone(working));});
    marker.on('drag',e=>{const p=e.target.getLatLng();working[n][i]=[p.lat,p.lng];coverage.setLatLng(p);});
    marker.on('dragend',e=>{const p=e.target.getLatLng();working[n][i]=[p.lat,p.lng];paint();});

   }
  });
 }
}
function close(){active=false;layer?.remove();layer=null;panel?.remove();panel=null;button.disabled=false;if(typeof renderMap==='function')renderMap();}
button.onclick=()=>{
 if(active||!map)return;active=true;button.disabled=true;
 working={12:structuredClone(base.routes[12]),14:structuredClone(base.routes[14])};undo=[];
 panel=document.createElement('div');panel.style.cssText='position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:1600;background:#15382f;color:white;border:2px solid #9ee7cb;border-radius:12px;padding:10px;max-width:94%;display:flex;gap:7px;align-items:center;flex-wrap:wrap;justify-content:center;box-shadow:0 3px 18px #0009';
 const heading=document.createElement('strong');heading.textContent='11 fixed · drag 12 & 14';
 const undoButton=document.createElement('button');undoButton.textContent='Undo';undoButton.onclick=()=>{if(undo.length){working=undo.pop();paint();}};
 const save=document.createElement('button');save.textContent='Save';save.className='primary';save.onclick=()=>{
  if(!confirm('Save the adjusted positions for laterals 12 and 14? This changes their future GPS targets.'))return;
  const previous={12:structuredClone(base.routes[12]),14:structuredClone(base.routes[14])};
  try{localStorage.setItem(KEY,JSON.stringify(working));}catch(e){alert('Could not save edited positions. Nothing changed.');return;}
  try{base.routes[12]=structuredClone(working[12]);base.routes[14]=structuredClone(working[14]);close();alert('Saved positions for laterals 12 and 14. Export an irrigation backup to keep a separate copy.');}catch(e){base.routes[12]=previous[12];base.routes[14]=previous[13];alert('Could not apply positions: '+e.message);}
 };
 const cancel=document.createElement('button');cancel.textContent='Cancel';cancel.onclick=close;
 panel.append(heading,undoButton,save,cancel);document.querySelector('.mapwrap').append(panel);
 paint();const pts=nums.flatMap(n=>base.routes[n]);map.fitBounds(L.latLngBounds(pts).pad(.15),{maxZoom:19});
};
})();
