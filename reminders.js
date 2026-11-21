/* Irrigation map reminders — independent of shifting routes */
(function(){
'use strict';
const KEY='irrigation-gps-reminders-v1';
let items=[];
try{const saved=JSON.parse(localStorage.getItem(KEY)||'[]');if(Array.isArray(saved))items=saved.filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lng)&&typeof x.text==='string').slice(0,200);}catch(e){}
let markers=null,visible=false,armed=false,editing=null,toastTimer=null,pressTimer=null,pressPosition=null,moving=null,lastGps=null,placingEnd=null;
const $id=id=>document.getElementById(id);
function store(){try{localStorage.setItem(KEY,JSON.stringify(items));}catch(e){alert('Reminder could not be saved. Check available browser storage.');}}
function pop(text){const el=$id('irrigationReminderToast');if(!el)return;el.textContent='🔔 '+text;el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.hidden=true,10000);}
function render(){
 if(!map)return;
 if(!markers)markers=L.layerGroup().addTo(map);
 markers.clearLayers();
 if(visible)for(const item of items){
  if(item.shape==='line'&&item.end){
   L.polyline([[item.lat,item.lng],[item.end.lat,item.end.lng]],{color:'#ffcf55',weight:5,interactive:true}).addTo(markers).on('click',e=>{L.DomEvent.stopPropagation(e);open(item);});
  }else if(item.shape==='oval'){
   L.polygon(ovalPoints(item),{color:'#ffcf55',weight:3,fillOpacity:.1}).addTo(markers).on('click',e=>{L.DomEvent.stopPropagation(e);open(item);});
  }else L.circle([item.lat,item.lng],{radius:item.radius||10,color:'#ffcf55',weight:2,fillOpacity:.07,interactive:false}).addTo(markers);
  const marker=L.circleMarker([item.lat,item.lng],{radius:9,color:'#ffdd70',weight:3,fillColor:'#7d4ca5',fillOpacity:0.95}).addTo(markers);
  marker.bindTooltip(item.text,{direction:'top'});
  marker.on('click',e=>{L.DomEvent.stopPropagation(e);open(item);});
  const tapTarget=L.circleMarker([item.lat,item.lng],{radius:24,stroke:false,fillColor:'#fff',fillOpacity:0.001,interactive:true}).addTo(markers);
  tapTarget.on('click',e=>{L.DomEvent.stopPropagation(e);open(item);});
 }
 $id('gpsReminderToggle').textContent=visible?'Hide GPS markers':'Show GPS markers';
 $id('gpsReminderAdd').textContent=armed?'Tap a map location…':'Add GPS reminder';
}
function open(item,point){
 editing=item||null;
 $id('gpsReminderText').value=item?item.text:'';
 $id('gpsReminderRadius').value=item?item.radius||10:10;
 $id('gpsReminderShape').value=item?.shape||'circle';
 $id('gpsReminderLength').value=item?.length||40;
 $id('gpsReminderWidth').value=item?.width||15;
 $id('gpsReminderBearing').value=item?.bearing||0;
 $id('gpsReminderEnd').textContent=item?.end?'Line end saved':'';
 updateShapeFields();
 $id('gpsReminderCoords').textContent=point?point.lat.toFixed(6)+', '+point.lng.toFixed(6):item?item.lat.toFixed(6)+', '+item.lng.toFixed(6):'';
 $id('gpsReminderDelete').hidden=!item;
 $id('gpsReminderMove').hidden=!item;
 const dlg=$id('gpsReminderDialog');dlg.dataset.lat=point?point.lat:item.lat;dlg.dataset.lng=point?point.lng:item.lng;
 if(!dlg.open)dlg.showModal();
 armed=false;render();
}
function at(latlng){visible=true;open(null,latlng);}
function ovalPoints(item){
 const a=(item.length||40)/2,b=(item.width||15)/2,theta=(item.bearing||0)*Math.PI/180;
 return Array.from({length:49},(_,i)=>{const t=i*Math.PI/24,x=a*Math.cos(t),y=b*Math.sin(t),east=x*Math.sin(theta)+y*Math.cos(theta),north=x*Math.cos(theta)-y*Math.sin(theta);return [item.lat+north/111320,item.lng+east/(111320*Math.cos(item.lat*Math.PI/180))];});
}
function nearOval(pos,item){
 const north=(pos.lat-item.lat)*111320,east=(pos.lng-item.lng)*111320*Math.cos(item.lat*Math.PI/180),t=(item.bearing||0)*Math.PI/180;
 const x=north*Math.cos(t)+east*Math.sin(t),y=east*Math.cos(t)-north*Math.sin(t);
 return (x/Math.max(2,(item.length||40)/2))**2+(y/Math.max(2,(item.width||15)/2))**2<=1;
}
function lineSide(pos,item){
 const lat0=item.lat*Math.PI/180,ax=0,ay=0,bx=(item.end.lng-item.lng)*111320*Math.cos(lat0),by=(item.end.lat-item.lat)*111320;
 const px=(pos.lng-item.lng)*111320*Math.cos(lat0),py=(pos.lat-item.lat)*111320;
 const t=Math.max(0,Math.min(1,(px*bx+py*by)/(bx*bx+by*by||1)));
 const distance=Math.hypot(px-t*bx,py-t*by);
 const side=(bx*py-by*px)/Math.max(1,Math.hypot(bx,by));
 return {side,distance};
}
function onGps(pos){
 if(!pos||!Number.isFinite(pos.lat)||!Number.isFinite(pos.lng))return;
 for(const item of items){
  if(item.shape==='line'&&item.end){
   const hit=lineSide(pos,item),prior=item.lastSide;
   // Require positions on opposite sides with at least 3 m clearance
   // and a crossing within the finite line segment.
   if(Math.abs(hit.side)>=3){
    if(prior&&Math.sign(prior)!==Math.sign(hit.side)&&hit.distance<=Math.max(12,(pos.accuracy||0)*1.5)&& (pos.accuracy||0)<=20)pop(item.text);
    item.lastSide=hit.side;
   }
   continue;
  }
  const radius=item.radius||10,inside=item.shape==='oval'?nearOval(pos,item):map.distance([pos.lat,pos.lng],[item.lat,item.lng])<=radius;
  if(!inside){item.inside=false;continue;}
  if(!item.inside&&(pos.accuracy||0)<=Math.max(25,radius*2)){item.inside=true;pop(item.text);}
 }
}
function onMoved(n){if(Number(n)===7)pop('Check dam water level');}
const toast=document.createElement('div');
toast.id='irrigationReminderToast';toast.hidden=true;toast.setAttribute('role','status');
toast.style.cssText='position:absolute;z-index:1800;left:50%;top:16%;transform:translateX(-50%);background:#14372f;box-shadow:0 4px 30px #000a;border:2px solid #f9d877;border-radius:14px;padding:16px 20px;color:white;font-size:clamp(25px,5vw,44px);line-height:1.18;font-weight:900;text-align:center;width:85%;max-width:720px;min-height:25%;display:flex;align-items:center;justify-content:center;pointer-events:none;';
document.querySelector('.mapwrap').appendChild(toast);const reminderStyle=document.createElement('style');reminderStyle.textContent='#irrigationReminderToast[hidden]{display:none!important}';document.head.appendChild(reminderStyle);
const controls=document.createElement('div');
controls.style.cssText='display:flex;gap:6px;flex-wrap:wrap;';
controls.innerHTML='<button type="button" id="gpsReminderAdd">Add GPS reminder</button><button type="button" id="gpsReminderToggle">Show GPS markers</button><button type="button" id="gpsReminderManage">Manage reminders</button>';
const panel=$id('gpsReminderControls');panel.appendChild(controls);
const dlg=document.createElement('dialog');dlg.id='gpsReminderDialog';dlg.setAttribute('aria-label','GPS reminder');
dlg.innerHTML='<form method="dialog" style="min-width:min(340px,85vw);display:grid;gap:10px"><h3 style="margin:0">GPS location reminder</h3><label>Message<input id="gpsReminderText" maxlength="180" placeholder="What should I check?" style="display:block;width:100%;margin-top:6px"></label><label>Trigger distance (metres)<input id="gpsReminderRadius" type="number" min="5" max="100" step="1" value="10" style="display:block;width:100%;margin-top:6px"></label><label>Shape<select id="gpsReminderShape"><option value="circle">Circle</option><option value="oval">Oval</option><option value="line">Crossing line</option></select></label><div id="gpsReminderOvalFields"><label>Oval length (m)<input id="gpsReminderLength" type="number" min="5" max="300" value="40"></label><label>Width (m)<input id="gpsReminderWidth" type="number" min="5" max="150" value="15"></label><label>Direction (degrees clockwise from north)<input id="gpsReminderBearing" type="number" min="0" max="359" value="0"></label></div><div id="gpsReminderLineFields"><small id="gpsReminderEnd"></small><button type="button" id="gpsReminderSetEnd">Set line end on map</button></div><small id="gpsReminderCoords"></small><div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="primary" id="gpsReminderSave">Save</button><button type="button" id="gpsReminderMove">Move on map</button><button type="button" id="gpsReminderDelete">Delete</button><button type="submit">Cancel</button></div></form>';
document.body.appendChild(dlg);
const listDialog=document.createElement('dialog');
listDialog.setAttribute('aria-label','Manage GPS reminders');
listDialog.innerHTML='<div style="min-width:min(340px,85vw);max-height:70vh;overflow:auto"><h3>Saved GPS reminders</h3><div id="gpsReminderList"></div><button type="button" id="gpsReminderListClose">Close</button></div>';
document.body.appendChild(listDialog);
function updateShapeFields(){const shape=$id('gpsReminderShape').value;$id('gpsReminderOvalFields').hidden=shape!=='oval';$id('gpsReminderLineFields').hidden=shape!=='line';$id('gpsReminderRadius').parentElement.hidden=shape!=='circle';}
$id('gpsReminderShape').onchange=updateShapeFields;
$id('gpsReminderSetEnd').onclick=()=>{if(!editing){alert('Save this reminder first, then edit it to set the line end.');return;}placingEnd=editing;dlg.close();pop('Tap the other end of the crossing line');};
function showList(){
 const host=$id('gpsReminderList');host.replaceChildren();
 if(!items.length)host.textContent='No GPS reminders saved.';
 items.forEach((item,i)=>{
  const entry=document.createElement('div');entry.style.cssText='padding:10px 0;border-bottom:1px solid #777;display:flex;align-items:center;gap:8px;';
  const name=document.createElement('span');name.style.cssText='flex:1;overflow-wrap:anywhere;';name.textContent=(i+1)+'. '+item.text;
  const edit=document.createElement('button');edit.type='button';edit.textContent='Edit';edit.onclick=()=>{listDialog.close();visible=true;open(item);};
  const del=document.createElement('button');del.type='button';del.textContent='Delete';del.onclick=()=>{if(!confirm('Delete reminder: '+item.text+'?'))return;items=items.filter(x=>x!==item);store();render();showList();};
  entry.append(name,edit,del);host.append(entry);
 });
 if(!listDialog.open)listDialog.showModal();
}
$id('gpsReminderManage').onclick=showList;
$id('gpsReminderListClose').onclick=()=>listDialog.close();
$id('gpsReminderMove').onclick=()=>{if(!editing)return;moving=editing;dlg.close();pop('Tap the new position for this reminder');};
$id('gpsReminderAdd').onclick=()=>{armed=!armed;if(armed)visible=true;render();if(armed)pop('Tap the map to place a GPS reminder');};
$id('gpsReminderToggle').onclick=()=>{visible=!visible;render();};
$id('gpsReminderSave').onclick=()=>{
 const value=$id('gpsReminderText').value.trim(),radius=Number($id('gpsReminderRadius').value);
 if(!value){alert('Enter a reminder message.');return;}
 if(!Number.isFinite(radius)||radius<5||radius>100){alert('Choose a trigger distance between 5 and 100 metres.');return;}
 const lat=Number(dlg.dataset.lat),lng=Number(dlg.dataset.lng);
 const shape=$id('gpsReminderShape').value,length=Number($id('gpsReminderLength').value),width=Number($id('gpsReminderWidth').value),bearing=Number($id('gpsReminderBearing').value);
 if(shape==='oval'&&(!(length>=5&&length<=300)||!(width>=5&&width<=150))){alert('Oval length must be 5–300 m and width 5–150 m.');return;}
 if(shape==='line'&&!editing){alert('First save the reminder, then edit it and mark the line end.');return;}
 if(editing){editing.text=value;editing.radius=radius;editing.lat=lat;editing.lng=lng;editing.inside=false;editing.shape=shape;editing.length=length;editing.width=width;editing.bearing=bearing;}
 else items.push({id:Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),lat,lng,text:value,radius,shape,length,width,bearing,inside:false});
 store();dlg.close();render();
};
$id('gpsReminderDelete').onclick=()=>{if(!editing)return;if(!confirm('Delete this reminder?'))return;items=items.filter(x=>x!==editing);store();dlg.close();render();};
map.on('click',e=>{if(placingEnd){placingEnd.end={lat:e.latlng.lat,lng:e.latlng.lng};placingEnd.shape='line';placingEnd.lastSide=null;placingEnd=null;store();render();pop('Crossing line saved');return;}if(moving){const item=moving;moving=null;open(item,e.latlng);return;}if(!armed)return;armed=false;at(e.latlng);});
const container=map.getContainer();
container.addEventListener('pointerdown',e=>{
 if(e.button!==0||armed||moving||e.target.closest('.leaflet-marker-pane,.leaflet-control'))return;
 pressPosition={x:e.clientX,y:e.clientY};clearTimeout(pressTimer);
 pressTimer=setTimeout(()=>{pressTimer=null;const p=map.mouseEventToLatLng(e);at(p);},700);
});
container.addEventListener('pointermove',e=>{if(pressPosition&&Math.hypot(e.clientX-pressPosition.x,e.clientY-pressPosition.y)>10)clearTimeout(pressTimer);});
for(const event of ['pointerup','pointercancel','pointerleave'])container.addEventListener(event,()=>{clearTimeout(pressTimer);pressPosition=null;});
container.addEventListener('contextmenu',e=>{if(e.target.closest('.leaflet-marker-pane,.leaflet-control')||moving)return;e.preventDefault();clearTimeout(pressTimer);at(map.mouseEventToLatLng(e));});
window.irrigationReminders={onGps,onMoved,exportData:()=>items.map(({inside,...x})=>x),importData:data=>{
 if(!Array.isArray(data))return;
 items=data.filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lng)&&typeof x.text==='string').map(x=>({...x,inside:false}));store();render();
}};
render();
})();