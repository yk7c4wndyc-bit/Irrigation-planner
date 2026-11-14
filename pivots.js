/* Pivot observation and prediction tools. Saved independently of lateral shifting. */
(()=>{
'use strict';
const KEY='irrigation-pivots-v1', DEFAULT={start:'23:00',end:'07:00',pivots:[
 {name:'Full-circle pivot',type:'circle',centre:{lat:-40.98649924075225,lng:145.5290366496638},tip:null,bounds:[],observations:[],speedCW:null,speedCCW:null,direction:1,stopped:false},
 {name:'Back-and-forth pivot',type:'sector',centre:{lat:-40.98196593842062,lng:145.5324355807702},tip:null,bounds:[],observations:[],speedCW:null,speedCCW:null,direction:1,stopped:false}
]};
let data;try{data=JSON.parse(localStorage.getItem(KEY))}catch(e){}
if(!data||!Array.isArray(data.pivots)||data.pivots.length!==2)data=structuredClone(DEFAULT);
data.pivots.forEach((p,i)=>{p.name||=DEFAULT.pivots[i].name;p.type||=DEFAULT.pivots[i].type;p.bounds||=[];p.observations||=[];p.direction||=1;});
// Fill missing centres from the confirmed 14 Nov export; preserve device edits.
data.pivots.forEach((p,i)=>{if(!p.centre)p.centre=structuredClone(DEFAULT.pivots[i].centre);});
let selected=0,placing=null,pivotLayer=null,visible=true,refresh=null;
const el=id=>document.getElementById(id),norm=x=>((x%360)+360)%360;
const angle=(a,b)=>norm(Math.atan2((b.lng-a.lng)*Math.cos(a.lat*Math.PI/180),b.lat-a.lat)*180/Math.PI);
const cw=(a,b)=>norm(b-a),ccw=(a,b)=>norm(a-b);
const between=(a,b,dir)=>dir===1?cw(a,b):ccw(a,b);
function persist(){try{localStorage.setItem(KEY,JSON.stringify(data));}catch(e){alert('Could not save pivots in this browser. Export a backup.');}}
function mins(t){const [h,m]=t.split(':').map(Number);return h*60+m;}
function runHours(t0,t1){
 let result=0,start=mins(data.start),end=mins(data.end);
 if(t1<=t0)return 0;
 // Use local calendar dates rather than UTC days, including DST transitions.
 const day0=new Date(t0);day0.setHours(0,0,0,0);day0.setDate(day0.getDate()-1);
 const dayEnd=new Date(t1);dayEnd.setHours(0,0,0,0);dayEnd.setDate(dayEnd.getDate()+1);
 for(let day=new Date(day0);day<=dayEnd;day.setDate(day.getDate()+1)){
  const a=new Date(day);a.setHours(Math.floor(start/60),start%60,0,0);
  const b=new Date(day);b.setHours(Math.floor(end/60),end%60,0,0);
  if(end<=start)b.setDate(b.getDate()+1);
  result+=Math.max(0,Math.min(t1,+b)-Math.max(t0,+a))/3600000;
 }
 return result;
}
function speedFor(p,d){return d===1?p.speedCW:p.speedCCW;}
function simulate(p,when){
 const last=p.observations.at(-1);if(!last||!p.centre)return null;
 let a=last.angle,d=last.direction||p.direction||1;
 if(p.stopped)return {angle:a,direction:d};
 let hours=runHours(last.at,when);
 if(p.type==='circle'){
  const speed=speedFor(p,d);if(!(speed>0))return {angle:a,direction:d,uncalibrated:true};
  return {angle:norm(a+d*hours*speed),direction:d};
 }
 if(p.bounds.length!==2)return {angle:a,direction:d,uncalibrated:true};
 const a0=p.bounds[0],a1=p.bounds[1],span=cw(a0,a1);
 if(span<10||span>350)return {angle:a,direction:d,uncalibrated:true};
 let pos=Math.min(span,Math.max(0,cw(a0,a)));let tries=0;
 while(hours>0.000001&&tries++<2000){
  const speed=speedFor(p,d);
  if(!(speed>0))return {angle:norm(a0+pos),direction:d,uncalibrated:true};
  const remaining=d===1?span-pos:pos;
  if(remaining<.00000001){d*=-1;continue;}
  const time=remaining/speed;
  if(hours<time){pos+=d*hours*speed;hours=0;}
  else{pos=d===1?span:0;hours-=time;d*=-1;}
 }
 return {angle:norm(a0+pos),direction:d,uncalibrated:tries>=2000};
}
function draw(){
 if(typeof map==='undefined'||!map||typeof L==='undefined')return;
 if(!pivotLayer)pivotLayer=L.layerGroup().addTo(map);
 pivotLayer.clearLayers();if(!visible)return;
 const now=Date.now();
 data.pivots.forEach((p,i)=>{
  if(!p.centre)return;
  const centre=[p.centre.lat,p.centre.lng];
  L.circleMarker(centre,{radius:7,color:'#fff',fillColor:i?'#e6a0ff':'#75edfc',fillOpacity:1,weight:2}).addTo(pivotLayer).bindTooltip(p.name+' centre');
  const prediction=simulate(p,now);
  const tip=p.tip,observed=prediction?.angle??(tip?angle(p.centre,tip):null);
  const length=tip?map.distance(centre,[tip.lat,tip.lng]):90;
  if(p.type==='sector'&&p.bounds?.length){
    p.bounds.forEach((bearing,index)=>{
      if(!Number.isFinite(bearing))return;
      const b=bearing*Math.PI/180;
      const end=[p.centre.lat+length*Math.cos(b)/111320,p.centre.lng+length*Math.sin(b)/(111320*Math.cos(p.centre.lat*Math.PI/180))];
      L.polyline([centre,end],{color:'#ffd25e',weight:3,dashArray:'6 5'}).addTo(pivotLayer);
      L.circleMarker(end,{radius:7,color:'#fff',weight:2,fillColor:'#e6aa32',fillOpacity:1}).addTo(pivotLayer).bindTooltip('Turning limit '+(index+1));
    });
  }
  if(observed===null)return;
  const rad=observed*Math.PI/180,lat=length*Math.cos(rad)/111320,lon=length*Math.sin(rad)/(111320*Math.cos(p.centre.lat*Math.PI/180));
  const to=[p.centre.lat+lat,p.centre.lng+lon];
  L.polyline([centre,to],{color:i?'#e6a0ff':'#75edfc',weight:4,dashArray:prediction?.uncalibrated?'7 7':null}).addTo(pivotLayer).bindTooltip(p.name+(prediction?.uncalibrated?' (needs calibration)':' (estimated)'));
  L.circleMarker(to,{radius:5,color:'#fff',fillColor:i?'#e6a0ff':'#75edfc',fillOpacity:1}).addTo(pivotLayer);

 });
}
function status(){
 const p=data.pivots[selected],last=p.observations.at(-1),pred=simulate(p,Date.now());
 const deg=pred?pred.angle.toFixed(1)+'°':'Not calibrated';
 const speeds='Clockwise: '+(p.speedCW?.toFixed(2)??'—')+'°/running hr · Anticlockwise: '+(p.speedCCW?.toFixed(2)??'—')+'°/running hr';
 const limitInfo=p.type==='sector'?'\nFirst turning limit: '+(Number.isFinite(p.bounds[0])?p.bounds[0].toFixed(1)+'° saved':'not marked')+'\nSecond turning limit: '+(Number.isFinite(p.bounds[1])?p.bounds[1].toFixed(1)+'° saved':'not marked'):'';
 el('pivotStatus').textContent='Estimated angle: '+deg+(pred?.uncalibrated?' (speed unknown)':'')+'\n'+speeds+'\nLast observed: '+(last?new Date(last.at).toLocaleString():'never')+limitInfo+(p.stopped?'\nPAUSED due to fault':'');
 el('pivotStop').textContent=p.stopped?'Resume pivot':'Pause faulty pivot';
 el('pivotMarker').textContent=visible?'Hide pivot arms':'Show pivot arms';
}
function form(){
 el('pivotSelect').value=String(selected);
 el('pivotStart').value=data.start;el('pivotEnd').value=data.end;
 el('pivotType').value=data.pivots[selected].type;
 const needsLimits=data.pivots[selected].type==='sector';
 el('pivotLimit1').hidden=!needsLimits;el('pivotLimit2').hidden=!needsLimits;
 el('pivotDirection').value=String(data.pivots[selected].direction||1);
 el('pivotCW').value=data.pivots[selected].speedCW??'';
 el('pivotCCW').value=data.pivots[selected].speedCCW??'';
 status();draw();
}
function pointPlace(mode){
 if(mode.startsWith('limit')&&data.pivots[selected].type!=='sector')return;
 if(!map){alert('Map is unavailable');return;}
 placing=mode;
 el('pivotStatus').textContent='Tap the location on the map to mark '+mode+'.';
 el('pivotDialog').close();
}
function sample(atPoint){
 if(!placing)return;
 const p=data.pivots[selected],pt={lat:atPoint.lat,lng:atPoint.lng},mode=placing;
 placing=null;
 if(mode==='centre'){p.centre=pt;p.tip=null;p.observations=[];p.bounds=[];}
 else if(!p.centre){alert('Mark the fixed centre first.');form();return;}
 else if(mode==='arm'){
  p.tip=pt;const a=angle(p.centre,pt),now=Date.now();
  const prev=p.observations.at(-1),d=Number(el('pivotDirection').value)||p.direction||1;
  if(prev&&now>prev.at){
   const hours=runHours(prev.at,now);
   if(hours>0.1){
    // One observation interval may include full turns or reversals.
    // Only calibrate directly when a plausible single-direction arc is observed.
    const observed=between(prev.angle,a,d);
    const old=speedFor(p,d);
    const nearest=old>0?Math.round(((old*hours)-observed)/360):0;
    const travel=observed+360*Math.max(0,nearest);
    const next=travel/hours;
    if(p.type==='circle'&&next>0&&next<=80){
     if(d===1)p.speedCW=next;else p.speedCCW=next;
    }
    // Sector speeds must be entered or inferred manually since a reversal may be hidden
    // between observations. Do not assume that endpoint angles imply a unique speed.
   }
  }
  p.observations.push({at:now,angle:a,direction:d});
  p.observations=p.observations.slice(-200);
  p.direction=d;
 }else if(mode==='limit1'){p.type='sector';p.bounds[0]=angle(p.centre,pt);}
 else if(mode==='limit2'){p.type='sector';p.bounds[1]=angle(p.centre,pt);}
 persist();form();
 const names={centre:'Pivot centre',arm:'Pivot arm position',limit1:'First turning limit',limit2:'Second turning limit'};
 const value=mode.startsWith('limit')?angle(p.centre,pt).toFixed(1)+'°':pt.lat.toFixed(5)+', '+pt.lng.toFixed(5);
 const oldNotice=document.getElementById('pivotMapSavedNotice');if(oldNotice)oldNotice.remove();
 const notice=document.createElement('div');notice.id='pivotMapSavedNotice';
 notice.style.cssText='position:absolute;z-index:2200;top:18%;left:50%;transform:translateX(-50%);padding:14px 17px;border-radius:12px;border:2px solid #8af0ad;background:#173e2e;color:#fff;box-shadow:0 4px 20px #000b;font-weight:750;max-width:85%;text-align:center;pointer-events:none';
 notice.textContent='✓ '+names[mode]+' saved: '+value;
 document.querySelector('.mapwrap').appendChild(notice);
 setTimeout(()=>notice.remove(),7000);
 // Keep the map visible so the newly marked turning limit can be inspected.

}
function markCentreGPS(){
 const p=data.pivots[selected], pivotIndex=selected;
 if(!navigator.geolocation){alert('GPS is unavailable in this browser.');return;}
 const button=el('pivotCentreGPS');
 button.disabled=true;button.textContent='Getting GPS fix…';
 const reset=()=>{button.disabled=false;button.textContent='Use current GPS for centre';};
 navigator.geolocation.getCurrentPosition(position=>{
  reset();
  const {latitude:lat,longitude:lng,accuracy}=position.coords;
  if(!Number.isFinite(lat)||!Number.isFinite(lng)){alert('GPS returned an invalid position. Nothing was saved.');return;}
  const metres=Math.round(accuracy);
  const warning=accuracy>15?'\nWarning: GPS accuracy is poor. Wait a moment and retry for a better fix.':'';
  const message='GPS centre reading for '+p.name+':\n'+lat.toFixed(6)+', '+lng.toFixed(6)+'\nEstimated accuracy: ±'+metres+' m.'+warning+'\n\nSave this as the pivot centre?'+(p.centre?'\n\nThis will replace the existing centre and clear the arm observations and turning limits.':'');
  if(!confirm(message))return;
  if(selected!==pivotIndex){alert('Pivot selection changed. Please retry.');return;}
  p.centre={lat,lng};p.tip=null;p.observations=[];p.bounds=[];
  persist();form();
  if(map){map.panTo([lat,lng]);draw();}
  alert('✓ Pivot centre saved using GPS (estimated accuracy ±'+metres+' m).');
 },error=>{reset();alert('Could not get GPS position: '+error.message+'\nNothing was changed.');},{enableHighAccuracy:true,timeout:20000,maximumAge:0});
}
function addUI(){
 const section=document.createElement('section');
 section.innerHTML='<details id="pivotSettings"><summary style="font-weight:700;cursor:pointer;padding:7px 0">🌀 Pivot tracking</summary><p class="small">Mark the fixed centre and arm on the map. Predictions count only scheduled irrigation hours.</p><button id="pivotOpen" type="button">Set up / check pivots</button><button id="pivotMarker" type="button">Hide pivot arms</button></details>';
 const planning=el('planningSettings');
 if(planning)planning.insertAdjacentElement('afterend',section);
 else document.querySelector('aside')?.appendChild(section);
 const quickButton=el('quickOpenPivots');
 if(quickButton)quickButton.onclick=()=>{el('quickPlanningDialog').close();openDialog();};
 const dlg=document.createElement('dialog');dlg.id='pivotDialog';dlg.style.cssText='width:min(430px,95vw);max-height:90dvh;overflow:auto;background:#152c27;color:white;border:2px solid #91bea6;border-radius:14px;padding:16px;z-index:5000';
 dlg.innerHTML='<h3>🌀 Pivot tracking</h3><p class="small">Use your finger on the map when marking positions. Recheck the arm to correct predictions.</p>'+
 '<label>Pivot<select id="pivotSelect"><option value="0">Full-circle pivot</option><option value="1">Back-and-forth pivot</option></select></label>'+
 '<label>Pattern<select id="pivotType"><option value="circle">Full circle</option><option value="sector">Back and forth (sector)</option></select></label>'+
 '<label>Common start time<input id="pivotStart" type="time"></label><label>Common stop time<input id="pivotEnd" type="time"></label>'+
 '<div class="bar"><button id="pivotCentre" type="button">Mark centre on map</button><button id="pivotCentreGPS" type="button">Use current GPS for centre</button><button id="pivotArm" type="button">Mark arm now</button><button id="pivotLimit1" type="button">Mark first limit</button><button id="pivotLimit2" type="button">Mark second limit</button></div>'+
 '<label>Current direction<select id="pivotDirection"><option value="1">Clockwise</option><option value="-1">Anticlockwise</option></select></label>'+
 '<p class="small">For the back-and-forth pivot, enter speeds after checking direction and travel. One day’s positions alone may not reveal when it reversed.</p>'+
 '<label>Clockwise speed (degrees per running hour)<input id="pivotCW" type="number" min="0.01" step="0.01" placeholder="Unknown"></label>'+
 '<label>Anticlockwise speed (degrees per running hour)<input id="pivotCCW" type="number" min="0.01" step="0.01" placeholder="Unknown"></label>'+
 '<p id="pivotStatus" class="small" style="white-space:pre-line"></p>'+
 '<div class="bar"><button type="button" id="pivotSave" class="primary">Save settings</button><button type="button" id="pivotStop">Pause faulty pivot</button><button type="button" id="pivotClose">Close</button></div>';
 document.body.appendChild(dlg);
 el('pivotOpen').onclick=openDialog;
 el('pivotMarker').onclick=()=>{visible=!visible;form();};
 el('pivotType').onchange=()=>{const needsLimits=el('pivotType').value==='sector';el('pivotLimit1').hidden=!needsLimits;el('pivotLimit2').hidden=!needsLimits;};
 el('pivotSelect').onchange=()=>{selected=Number(el('pivotSelect').value);form();};
 el('pivotCentre').onclick=()=>pointPlace('centre');
 el('pivotCentreGPS').onclick=markCentreGPS;
 el('pivotArm').onclick=()=>pointPlace('arm');
 el('pivotLimit1').onclick=()=>pointPlace('limit1');
 el('pivotLimit2').onclick=()=>pointPlace('limit2');
 el('pivotClose').onclick=()=>dlg.close();
 el('pivotStop').onclick=()=>{const p=data.pivots[selected];const now=Date.now();const last=p.observations.at(-1);const predicted=simulate(p,now);if(last&&predicted){p.observations.push({at:now,angle:predicted.angle,direction:predicted.direction});p.observations=p.observations.slice(-200);}p.stopped=!p.stopped;persist();form();};
 el('pivotSave').onclick=()=>{
  const start=el('pivotStart').value,end=el('pivotEnd').value;
  if(!/^\d\d:\d\d$/.test(start)||!/^\d\d:\d\d$/.test(end)||start===end){alert('Set different start and stop times');return;}
  data.start=start;data.end=end;const p=data.pivots[selected],newType=el('pivotType').value;
  if(p.type!==newType){p.type=newType;p.observations=[];p.bounds=[];}
  p.direction=Number(el('pivotDirection').value)||1;
  for(const [field,input] of [['speedCW','pivotCW'],['speedCCW','pivotCCW']]){
   const value=el(input).value.trim(),n=Number(value);
   if(value&&(!(n>0)||n>180)){alert('Speed must be 0–180 degrees per running hour.');return;}
   p[field]=value?n:null;
  }
  persist();form();
  let notice=el('pivotSettingsSaved');
  if(!notice){
   notice=document.createElement('div');
   notice.id='pivotSettingsSaved';
   notice.setAttribute('role','status');
   notice.style.cssText='background:#20583d;color:#effff4;border:2px solid #91dfaf;border-radius:10px;padding:12px;margin:10px 0;font-weight:750;text-align:center;';
   el('pivotSave').parentElement.before(notice);
  }
  notice.textContent='✓ Settings saved for '+p.name;
  notice.hidden=false;
  clearTimeout(window.pivotSavedTimer);
  window.pivotSavedTimer=setTimeout(()=>{notice.hidden=true;},5000);
 };
 map.on('click',e=>{if(placing)sample(e.latlng);});
 setInterval(()=>{if(el('pivotDialog')?.open)status();draw();},60000);
 form();
}
function openDialog(){form();const notice=el('pivotSettingsSaved');if(notice)notice.hidden=true;el('pivotDialog').showModal();}
window.irrigationPivots={exportData:()=>structuredClone(data),importData:value=>{if(value&&Array.isArray(value.pivots)&&value.pivots.length===2){data=value;persist();form();}}};
addUI();
})();