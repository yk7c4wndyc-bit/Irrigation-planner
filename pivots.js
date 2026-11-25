/* Pivot observation and prediction tools. Saved independently of lateral shifting. */
(()=>{
'use strict';
const KEY='irrigation-pivots-v1', DEFAULT={start:'23:00',end:'07:00',pivots:[
 {name:'Full-circle pivot',type:'circle',centre:{lat:-40.98649924075225,lng:145.5290366496638},tip:null,bounds:[],observations:[],speedCW:null,speedCCW:null,direction:1,stopped:false},
 {name:'Back-and-forth pivot',type:'sector',centre:{lat:-40.98196593842062,lng:145.5324355807702},tip:null,bounds:[],observations:[],speedCW:null,speedCCW:null,direction:1,stopped:false}
]};
let data;try{data=JSON.parse(localStorage.getItem(KEY))}catch(e){}
if(!data||!Array.isArray(data.pivots)||data.pivots.length!==2)data=structuredClone(DEFAULT);
data.pivots.forEach((p,i)=>{p.name||=DEFAULT.pivots[i].name;p.type||=DEFAULT.pivots[i].type;p.bounds||=[];p.observations||=[];p.direction||=1;if(!(p.sprayRadiusMetres>0))p.sprayRadiusMetres=null;});
// Fill missing centres from the confirmed 14 Nov export; preserve device edits.
data.pivots.forEach((p,i)=>{if(!p.centre)p.centre=structuredClone(DEFAULT.pivots[i].centre);});
let selected=0,placing=null,pivotLayer=null,visible=true,refresh=null,review=null,reviewLayer=null;
const el=id=>document.getElementById(id),norm=x=>((x%360)+360)%360;
const angle=(a,b)=>norm(Math.atan2((b.lng-a.lng)*Math.cos(a.lat*Math.PI/180),b.lat-a.lat)*180/Math.PI);
const cw=(a,b)=>norm(b-a),ccw=(a,b)=>norm(a-b);
const between=(a,b,dir)=>dir===1?cw(a,b):ccw(a,b);
function persist(){try{localStorage.setItem(KEY,JSON.stringify(data));return true;}catch(e){alert('Could not save pivots in this browser. Nothing was saved.');return false;}}
function mins(t){const [h,m]=t.split(':').map(Number);return h*60+m;}
// Only explicitly scheduled nights count; older observations remain intact.
function runHours(t0,t1){
 if(t1<=t0)return 0;
 return (Array.isArray(data.authorizedRuns)?data.authorizedRuns:[]).reduce((sum,r)=>sum+(Number.isFinite(r.start)&&Number.isFinite(r.end)?Math.max(0,Math.min(t1,r.end)-Math.max(t0,r.start))/3600000:0),0);
}
function authorizeNextRun(completedAt=Date.now()){
 const now=new Date(completedAt), start=mins(data.start),end=mins(data.end);
 const a=new Date(now);a.setHours(Math.floor(start/60),start%60,0,0);
 if(+a<+now)a.setDate(a.getDate()+1);
 const b=new Date(a);b.setHours(Math.floor(end/60),end%60,0,0);if(end<=start)b.setDate(b.getDate()+1);
 const runs=Array.isArray(data.authorizedRuns)?data.authorizedRuns:[];
 if(runs.some(r=>r.start===+a))return true;
 data.authorizedRuns=[...runs,{start:+a,end:+b}];if(!persist()){data.authorizedRuns=runs;return false;}draw();return true;
}
function legacyRunHours(t0,t1){
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
function speedFor(p,d){return (d===1?p.speedCW:p.speedCCW)||(p.type==='sector'?(d===1?p.speedCCW:p.speedCW):null);}
// A sector initially uses the measured speed in either direction until a return speed is learned.
function calibrateSector(p,prev,a,dir,now){
 if(p.type!=='sector'||!prev||p.bounds.length!==2)return;
 const span=cw(p.bounds[0],p.bounds[1]),hours=runHours(prev.at,now);
 if(!(span>=10&&span<=350&&hours>0.1))return;
 const start=cw(p.bounds[0],prev.angle),end=cw(p.bounds[0],a);
 if(start>span+3||end>span+3)return;
 // Only infer speed when the observation pair can represent one uninterrupted leg.
 // A crossing of a turning limit is ambiguous and must not be used to calibrate.
 const travel=dir===1?end-start:start-end;
 const priorDirection=prev.direction||dir;
 if(priorDirection!==dir||travel<=0)return;
 const rate=travel/hours;
 if(rate>0&&rate<=80){if(dir===1)p.speedCW=rate;else p.speedCCW=rate;}
}
// Derive a provisional sector speed from recorded movement when the saved
// clockwise/anticlockwise speed is still empty. Ignore implausible intervals.
function recoverSectorSpeed(p){
 if(p.type!=='sector'||p.bounds?.length!==2||p.observations.length<2)return;
 const span=cw(p.bounds[0],p.bounds[1]);
 if(!(span>=10&&span<=350))return;
 const candidates={1:[],[-1]:[]},obs=p.observations;
 for(let i=Math.max(1,obs.length-15);i<obs.length;i++){
  const a=obs[i-1],b=obs[i],hours=runHours(a.at,b.at);
  if(!(hours>=0.5))continue;
  const x=cw(p.bounds[0],a.angle),y=cw(p.bounds[0],b.angle);
  if(x>span+3||y>span+3)continue;
  const delta=y-x,dir=Math.sign(delta),rate=Math.abs(delta)/hours;
  if(dir&&rate>=0.1&&rate<=40)candidates[dir].push({rate,weight:i});
 }
 for(const dir of [1,-1]){
  const list=candidates[dir];
  if(!list.length)continue;
  const mean=list.reduce((a,x)=>a+x.rate*x.weight,0)/list.reduce((a,x)=>a+x.weight,0);
  if(dir===1&&!(p.speedCW>0))p.speedCW=mean;
  if(dir===-1&&!(p.speedCCW>0))p.speedCCW=mean;
 }
 const a=obs.at(-2),b=obs.at(-1);
 const x=cw(p.bounds[0],a.angle),y=cw(p.bounds[0],b.angle);
 if(x<=span+3&&y<=span+3&&Math.abs(y-x)>1){
  const dir=Math.sign(y-x);
  p.direction=dir;b.direction=dir;
 }
}
// Do not recalibrate old observations against unknown historical run dates.
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
function sprayPoint(c,b,r){const t=b*Math.PI/180,lat=c.lat*Math.PI/180,d=r/6371000,la=Math.asin(Math.sin(lat)*Math.cos(d)+Math.cos(lat)*Math.sin(d)*Math.cos(t)),lo=c.lng*Math.PI/180+Math.atan2(Math.sin(t)*Math.sin(d)*Math.cos(lat),Math.cos(d)-Math.sin(lat)*Math.sin(la));return [la*180/Math.PI,lo*180/Math.PI];}
function coveragePoints(p,r){
 if(!(r>0))return null;
 if(p.type==='circle')return Array.from({length:121},(_,i)=>sprayPoint(p.centre,i*3,r));
 if(p.bounds.length!==2||!p.bounds.every(Number.isFinite))return null;
 const span=cw(p.bounds[0],p.bounds[1]);if(span<10||span>350)return null;
 const steps=Math.ceil(span/3);return [[p.centre.lat,p.centre.lng],...Array.from({length:steps+1},(_,i)=>sprayPoint(p.centre,p.bounds[0]+span*i/steps,r))];
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
  const tip=p.tip,last=p.observations.at(-1),observed=last?.angle??(tip?angle(p.centre,tip):null);
  const length=tip?map.distance(centre,[tip.lat,tip.lng]):90;
  const radius=p.sprayRadiusMetres||(tip?length:null),outline=coveragePoints(p,radius);
  if(outline)L.polygon(outline,{color:'#37b7ff',weight:3,fillColor:'#2389ce',fillOpacity:0.10,dashArray:p.sprayRadiusMetres?null:'7 6'}).addTo(pivotLayer).bindTooltip(p.name+' coverage — '+(p.sprayRadiusMetres?'outer spray limit':'estimated from arm')+' ('+Math.round(radius)+' m)');
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
  L.polyline([centre,to],{color:i?'#e6a0ff':'#75edfc',weight:3}).addTo(pivotLayer).bindTooltip(p.name+' last recorded arm position');
  if(prediction&&!prediction.uncalibrated){
    const predictedEnd=sprayPoint(p.centre,prediction.angle,length);
    L.polyline([centre,predictedEnd],{color:'#ff9e2c',weight:5,dashArray:'10 8'}).addTo(pivotLayer).bindTooltip(p.name+' predicted now: '+prediction.angle.toFixed(1)+'°');
  }
  L.circleMarker(to,{radius:5,color:'#fff',fillColor:i?'#e6a0ff':'#75edfc',fillOpacity:1}).addTo(pivotLayer);

 });
}
function status(){
 const p=data.pivots[selected],last=p.observations.at(-1),pred=simulate(p,Date.now());
 const deg=pred?pred.angle.toFixed(1)+'°':'Not calibrated';
 const speeds='Clockwise: '+(p.speedCW?.toFixed(2)??'—')+'°/running hr · Anticlockwise: '+(p.speedCCW?.toFixed(2)??'—')+'°/running hr'+(p.type==='sector'&&((!p.speedCW&&p.speedCCW)||(!p.speedCCW&&p.speedCW))?' (using known speed for both directions until recalibrated)':'');
 const sprayInfo='\nOuter spray limit: '+(p.sprayRadiusMetres?Math.round(p.sprayRadiusMetres)+' m saved':'not marked');
 const limitInfo=p.type==='sector'?'\nFirst turning limit: '+(Number.isFinite(p.bounds[0])?p.bounds[0].toFixed(1)+'° saved':'not marked')+'\nSecond turning limit: '+(Number.isFinite(p.bounds[1])?p.bounds[1].toFixed(1)+'° saved':'not marked'):'';
 el('pivotStatus').textContent='Estimated angle: '+deg+(pred?.uncalibrated?' (speed unknown)':'')+'\n'+speeds+'\nLast observed: '+(last?new Date(last.at).toLocaleString():'never')+limitInfo+sprayInfo+(p.stopped?'\nPAUSED due to fault':'');
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
 alert('Tap the '+(mode==='arm'?'outer end of the pivot arm':mode==='centre'?'fixed pivot centre':mode==='spray'?'outermost reach of the spray':'turning limit')+' on the map to save its position.');
 el('pivotStatus').textContent='Tap the location on the map to mark '+mode+'.';
 el('pivotDialog').close();
}
function sample(atPoint){
 if(!placing)return;
 const before=structuredClone(data);
 const p=data.pivots[selected],pt={lat:atPoint.lat,lng:atPoint.lng},mode=placing;
 placing=null;
 if(mode==='centre'){p.centre=pt;p.tip=null;p.observations=[];p.bounds=[];p.sprayRadiusMetres=null;}
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
    if(p.type==='sector')calibrateSector(p,prev,a,d,now);
   }
  }
  p.observations.push({at:now,angle:a,direction:d});
  p.observations=p.observations.slice(-200);
  p.direction=d;
  recoverSectorSpeed(p);
 }else if(mode==='spray'){const d=map.distance([p.centre.lat,p.centre.lng],[pt.lat,pt.lng]);if(d<5||d>2500){alert('Spray limit must be 5–2500 m from the pivot centre. Nothing saved.');form();return false;}p.sprayRadiusMetres=d;}
 else if(mode==='limit1'){p.type='sector';p.bounds[0]=angle(p.centre,pt);}
 else if(mode==='limit2'){p.type='sector';p.bounds[1]=angle(p.centre,pt);}
 if(!persist()){data=before;form();return false;}
 visible=true;form();
 const names={centre:'Pivot centre',arm:'Pivot arm position',limit1:'First turning limit',limit2:'Second turning limit',spray:'Outer spray limit'};
 const value=mode==='spray'?Math.round(p.sprayRadiusMetres)+' m from centre':mode.startsWith('limit')?angle(p.centre,pt).toFixed(1)+'°':pt.lat.toFixed(5)+', '+pt.lng.toFixed(5);
 const oldNotice=document.getElementById('pivotMapSavedNotice');if(oldNotice)oldNotice.remove();
 const notice=document.createElement('div');notice.id='pivotMapSavedNotice';
 notice.style.cssText='position:absolute;z-index:2200;top:18%;left:50%;transform:translateX(-50%);padding:14px 17px;border-radius:12px;border:2px solid #8af0ad;background:#173e2e;color:#fff;box-shadow:0 4px 20px #000b;font-weight:750;max-width:85%;text-align:center;pointer-events:none';
 notice.textContent='✓ '+names[mode]+' saved: '+value;
 document.querySelector('.mapwrap').appendChild(notice);
 setTimeout(()=>notice.remove(),7000);
 return true;
 // Keep the map visible so the newly marked turning limit can be inspected.

}
function markSprayGPS(){
 const i=selected,p=data.pivots[i];if(!p.centre){alert('Mark centre first.');return;}
 if(!navigator.geolocation){alert('GPS unavailable. Nothing saved.');return;}
 const button=el('pivotSprayGPS');button.disabled=true;button.textContent='Getting GPS fix…';
 const reset=()=>{button.disabled=false;button.textContent='Use GPS for outer spray limit';};
 navigator.geolocation.getCurrentPosition(pos=>{
  reset();if(selected!==i){alert('Pivot selection changed. Nothing saved.');return;}
  const {latitude:lat,longitude:lng,accuracy}=pos.coords;
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||!Number.isFinite(accuracy)){alert('Invalid GPS. Nothing saved.');return;}
  const r=map.distance([p.centre.lat,p.centre.lng],[lat,lng]);
  if(r<5||r>2500){alert('Outside 5–2500 m range. Nothing saved.');return;}
  if(!confirm('Save outer spray reach '+Math.round(r)+' m for '+p.name+'?\nStand at the furthest reach of water, not at the metal arm end.\nGPS accuracy ±'+Math.round(accuracy)+' m.'))return;
  placing='spray';if(sample({lat,lng})){el('pivotDialog').close();alert('✓ Outer spray limit saved: '+Math.round(r)+' m');}
 },e=>{reset();alert('GPS failed: '+e.message+'\nNothing saved.');},{enableHighAccuracy:true,timeout:20000,maximumAge:0});
}
function markArmGPS(){
 const pivotIndex=selected,p=data.pivots[pivotIndex];
 if(!p.centre){alert('Mark the fixed centre first.');return;}
 if(!navigator.geolocation){alert('GPS is unavailable in this browser. Nothing was saved.');return;}
 placing=null;
 const button=el('pivotArmGPS');
 button.disabled=true;button.textContent='Getting GPS fix…';
 const reset=()=>{button.disabled=false;button.textContent='Mark arm at my GPS location';};
 navigator.geolocation.getCurrentPosition(position=>{
  reset();
  if(selected!==pivotIndex||data.pivots[pivotIndex]!==p){alert('Pivot selection changed. Nothing was saved. Please retry.');return;}
  const {latitude:lat,longitude:lng,accuracy}=position.coords;
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||!Number.isFinite(accuracy)){alert('GPS returned an invalid position. Nothing was saved.');return;}
  const metres=Math.round(accuracy);
  if(!confirm('Save your current GPS location as the outer end of '+p.name+'?'+
   '\nStand at the outer end of the arm, not the centre.'+
   '\nEstimated GPS accuracy: ±'+metres+' m.'+
   (accuracy>15?'\nGPS accuracy is poor. Cancel and retry for a better fix.':'')))return;
  placing='arm';
  if(sample({lat,lng})){
   el('pivotDialog').close();
   alert('✓ Arm position saved for '+p.name+' at '+new Date().toLocaleTimeString()+'. GPS accuracy ±'+metres+' m.');
  }
 },error=>{reset();alert('Could not get GPS position: '+error.message+'\nNothing was saved.');},
 {enableHighAccuracy:true,timeout:20000,maximumAge:0});
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
  p.centre={lat,lng};p.tip=null;p.observations=[];p.bounds=[];p.sprayRadiusMetres=null;
  persist();form();
  if(map){map.panTo([lat,lng]);draw();}
  alert('✓ Pivot centre saved using GPS (estimated accuracy ±'+metres+' m).');
 },error=>{reset();alert('Could not get GPS position: '+error.message+'\nNothing was changed.');},{enableHighAccuracy:true,timeout:20000,maximumAge:0});
}
function addUI(){
 const section=document.createElement('section');
 section.innerHTML='<details id="pivotSettings"><summary style="font-weight:700;cursor:pointer;padding:7px 0">🌀 Pivot tracking</summary><p class="small">Mark the centre and arm on the map or use GPS while standing at the position. Predictions count only overnight runs authorised after a completed lateral shift.</p><button id="pivotOpen" type="button">Set up / check pivots</button><button id="pivotMarker" type="button">Hide pivot arms</button></details>';
 const planning=el('planningSettings');
 if(planning)planning.insertAdjacentElement('afterend',section);
 else document.querySelector('aside')?.appendChild(section);
 const quickButton=el('quickOpenPivots');
 if(quickButton)quickButton.onclick=()=>{el('quickPlanningDialog').close();openDialog();};
 const dlg=document.createElement('dialog');dlg.id='pivotDialog';dlg.style.cssText='width:min(430px,95vw);max-height:90dvh;overflow:auto;background:#152c27;color:white;border:2px solid #91bea6;border-radius:14px;padding:16px;z-index:5000';
 dlg.innerHTML='<h3>🌀 Pivot tracking</h3><p class="small">For GPS arm marking, stand at the outer end of the arm. For map marking, tap its outer end on the map after closing this panel.</p>'+
 '<label>Pivot<select id="pivotSelect"><option value="0">Full-circle pivot</option><option value="1">Back-and-forth pivot</option></select></label>'+
 '<label>Pattern<select id="pivotType"><option value="circle">Full circle</option><option value="sector">Back and forth (sector)</option></select></label>'+
 '<label>Common start time<input id="pivotStart" type="time"></label><label>Common stop time<input id="pivotEnd" type="time"></label>'+
 '<div class="bar"><button id="pivotCentre" type="button">Mark centre on map</button><button id="pivotCentreGPS" type="button">Use current GPS for centre</button><button id="pivotArmGPS" type="button">Mark arm at my GPS location</button><button id="pivotArm" type="button">Mark arm on map</button><button id="pivotSpray" type="button">Mark outer spray limit on map</button><button id="pivotSprayGPS" type="button">Use GPS for outer spray limit</button><button id="pivotLimit1" type="button">Mark first limit</button><button id="pivotLimit2" type="button">Mark second limit</button></div>'+
 '<label>Current direction<select id="pivotDirection"><option value="1">Clockwise</option><option value="-1">Anticlockwise</option></select></label>'+
 '<p class="small">For the back-and-forth pivot, the known speed is used for both directions until a new same-direction GPS or map observation measures the return speed. Check the turning limits and current direction.</p>'+
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
 el('pivotArmGPS').onclick=markArmGPS;
 el('pivotArm').onclick=()=>pointPlace('arm');
 el('pivotSpray').onclick=()=>pointPlace('spray');
 el('pivotSprayGPS').onclick=markSprayGPS;
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

/* Map-based review is shown after laterals 20 and 27. No stored data are changed
   until the operator explicitly confirms a position. */
function recordReviewPosition(index,pt,dir,recalibrate=true){
 const p=data.pivots[index],before=structuredClone(data),now=Date.now(),a=angle(p.centre,pt);
 const prev=p.observations.at(-1);
 if(recalibrate&&prev&&now>prev.at&&p.type==='sector')calibrateSector(p,prev,a,dir,now);
 if(recalibrate&&prev&&now>prev.at&&p.type==='circle'){
  const hours=runHours(prev.at,now);
  if(hours>0.1){
   const travel=between(prev.angle,a,dir);
   const old=speedFor(p,dir);
   const extra=old>0?Math.max(0,Math.round((old*hours-travel)/360)):0;
   const rate=(travel+extra*360)/hours;
   if(rate>0&&rate<=80){if(dir===1)p.speedCW=rate;else p.speedCCW=rate;}
  }
 }
 p.tip=pt;p.direction=dir;
 p.observations.push({at:now,angle:a,direction:dir});
 p.observations=p.observations.slice(-200);
 if(!persist()){data=before;return false;}
 draw();return true;
}
function closeReview(success){
 if(!review)return;
 const current=review;review=null;
 if(reviewLayer){reviewLayer.clearLayers();map.removeLayer(reviewLayer);reviewLayer=null;}
 current.panel.remove();
 map.off('click',current.onMapClick);
 if(current.previousTransform!==undefined)el('map').style.transform=current.previousTransform;
 if(typeof fitMovement==='function')fitMovement(true,true);
 if(success)current.continueNavigation();
}
function reviewAfterLateral(n,continueNavigation){
 const index=n===20?0:n===27?1:-1;
 if(index<0||!map||!data.pivots[index]?.centre)return false;
 if(review)closeReview(false);
 selected=index;visible=true;draw();
 const p=data.pivots[index],prediction=simulate(p,Date.now()),last=p.observations.at(-1);
 const radius=p.sprayRadiusMetres||(p.tip?map.distance([p.centre.lat,p.centre.lng],[p.tip.lat,p.tip.lng]):100);
 const outline=coveragePoints(p,Math.max(radius,50));
 const points=outline?.length?outline:[[p.centre.lat,p.centre.lng],sprayPoint(p.centre,0,radius),sprayPoint(p.centre,180,radius)];
 const previousTransform=el('map').style.transform;
 el('map').style.transform='';
 map.invalidateSize();
 map.fitBounds(L.latLngBounds(points).pad(0.28),{animate:false,maxZoom:17});
 reviewLayer=L.layerGroup().addTo(map);
 const panel=document.createElement('div');panel.id='pivotReviewPanel';
 panel.style.cssText='position:absolute;z-index:2400;left:50%;top:10%;transform:translateX(-50%);width:min(92%,530px);padding:16px;background:#102c27f5;color:white;border:3px solid #ffb153;border-radius:16px;text-align:center;box-shadow:0 6px 30px #000d;touch-action:none;';
 const dragHandle=document.createElement('div');dragHandle.textContent='☰ Drag this box to move it';dragHandle.style.cssText='padding:8px;margin:-8px -8px 8px;cursor:grab;font-size:13px;color:#ffdda1;touch-action:none;user-select:none';
 let dragStart=null;
 dragHandle.addEventListener('pointerdown',e=>{const host=document.querySelector('.mapwrap'),rect=panel.getBoundingClientRect(),hostRect=host.getBoundingClientRect();dragStart={x:e.clientX,y:e.clientY,left:rect.left-hostRect.left,top:rect.top-hostRect.top};panel.style.transform='none';panel.style.left=dragStart.left+'px';panel.style.top=dragStart.top+'px';dragHandle.setPointerCapture(e.pointerId);e.preventDefault();});
 dragHandle.addEventListener('pointermove',e=>{if(!dragStart)return;const host=document.querySelector('.mapwrap');const left=dragStart.left+e.clientX-dragStart.x,top=dragStart.top+e.clientY-dragStart.y;panel.style.left=Math.max(-panel.offsetWidth+45,Math.min(host.clientWidth-45,left))+'px';panel.style.top=Math.max(-panel.offsetHeight+45,Math.min(host.clientHeight-45,top))+'px';});
 const endDrag=()=>{dragStart=null};dragHandle.addEventListener('pointerup',endDrag);dragHandle.addEventListener('pointercancel',endDrag);
 const heading=document.createElement('div');heading.style.cssText='font-size:clamp(19px,4vw,29px);font-weight:900';
 heading.textContent=(index===0?'FULL-CIRCLE':'BACK-AND-FORTH')+' PIVOT CHECK';
 const detail=document.createElement('p');detail.style.cssText='font-size:16px;color:white;line-height:1.4';
 detail.textContent=prediction&&!prediction.uncalibrated?'Orange dashed line = predicted position now ('+prediction.angle.toFixed(1)+'°). Confirm or correct it.':'Prediction not yet calibrated. Mark the actual arm position to improve tracking.';
 const direction=document.createElement('select');direction.style.cssText='display:block;margin:8px auto;color:white;background:#24443c;font-size:16px';
 direction.innerHTML='<option value="1">Moving clockwise</option><option value="-1">Moving anticlockwise</option>';direction.value=String(prediction?.direction||p.direction||1);direction.hidden=p.type!=='sector';
 const bar=document.createElement('div');bar.style.cssText='display:flex;gap:10px;justify-content:center;flex-wrap:wrap';
 const correct=document.createElement('button');correct.textContent='✓ Correct';correct.className='primary';
 correct.disabled=!prediction||!!prediction.uncalibrated;
 const adjust=document.createElement('button');adjust.textContent='Adjust position on map';
 const gps=document.createElement('button');gps.textContent='📍 Mark arm tip at my GPS';gps.type='button';
 const cancel=document.createElement('button');cancel.textContent='Not now';cancel.style.cssText='font-size:13px';
 bar.append(correct,adjust,gps,cancel);panel.append(dragHandle,heading,detail,direction,bar);
 document.querySelector('.mapwrap').appendChild(panel);
 const onMapClick=e=>{
  if(!review?.adjusting)return;
  const pt={lat:e.latlng.lat,lng:e.latlng.lng},a=angle(p.centre,pt);
  if(!confirm('Save actual arm position at '+a.toFixed(1)+'° for '+p.name+'?'))return;
  if(recordReviewPosition(index,pt,Number(direction.value)))closeReview(true);
 };
 review={panel,onMapClick,previousTransform,continueNavigation,adjusting:false};
 map.on('click',onMapClick);
 correct.onclick=()=>{
  if(!prediction||prediction.uncalibrated)return;
  const point=sprayPoint(p.centre,prediction.angle,radius);
  if(recordReviewPosition(index,{lat:point[0],lng:point[1]},Number(direction.value),false))closeReview(true);
 };
 gps.onclick=()=>{
  if(!navigator.geolocation){alert('GPS is not available in this browser.');return;}
  gps.disabled=true;gps.textContent='Getting precise GPS…';
  navigator.geolocation.getCurrentPosition(pos=>{
   gps.disabled=false;gps.textContent='📍 Mark arm tip at my GPS';
   if(!review||review.panel!==panel)return;
   const pt={lat:pos.coords.latitude,lng:pos.coords.longitude};
   const metres=Math.round(pos.coords.accuracy||0),bearing=angle(p.centre,pt);
   if(!confirm('Use GPS position as '+p.name+' arm tip?\\nDirection: '+bearing.toFixed(1)+'°\\nGPS accuracy: ±'+metres+' metres.\\n\\nOnly confirm if you are standing at the OUTER END of the pivot arm.'))return;
   if(recordReviewPosition(index,pt,Number(direction.value)))closeReview(true);
  },err=>{gps.disabled=false;gps.textContent='📍 Mark arm tip at my GPS';alert('Could not get GPS: '+err.message);},{enableHighAccuracy:true,timeout:20000,maximumAge:0});
 };
 adjust.onclick=()=>{
  review.adjusting=true;panel.style.top='2%';detail.textContent='Tap the ACTUAL arm tip on the map. You will confirm before saving.';bar.style.display='none';
  const back=document.createElement('button');back.textContent='Cancel adjustment';back.onclick=()=>{review.adjusting=false;detail.textContent='Choose Correct or Adjust position.';bar.style.display='flex';back.remove();};panel.appendChild(back);
 };
 cancel.onclick=()=>closeReview(true);
 return true;
}

function openDialog(){form();const notice=el('pivotSettingsSaved');if(notice)notice.hidden=true;el('pivotDialog').showModal();}
window.irrigationPivots={authorizeNextRun,reviewAfterLateral,isReviewing:()=>!!review,exportData:()=>structuredClone(data),importData:value=>{if(value&&Array.isArray(value.pivots)&&value.pivots.length===2){data=value;persist();form();}}};
addUI();
})();
