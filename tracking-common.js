'use strict';
const trackEscape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const trackStates={assigned:'Aguardando saída',enroute:'Saiu para entrega',arrived:'Chegou ao destino',delivered:'Entregue',canceled:'Cancelado',unavailable:'Acompanhamento encerrado ou indisponível'};
function trackFreshness(row,now=Date.now()){
 const captured=Date.parse(row.captured_at||''),received=Date.parse(row.received_at||'');
 if(!row.sharing||!Number.isFinite(captured)||!Number.isFinite(received)||row.lat==null||row.lng==null)return {kind:'paused',text:'Aguardando localização do entregador'};
 const seconds=Math.max(0,Math.floor((now-Math.min(captured,received))/1000));
 return {kind:seconds<=60?'fresh':'stale',text:seconds<=60?'Localização atualizada há '+seconds+' s':'Última localização há '+Math.floor(seconds/60)+' min · sem atualização ao vivo'};
}
async function trackRPC(name,args={},accessToken=null){
 const r=await fetch(TRACK_CONFIG.url+'/rest/v1/rpc/'+name,{method:'POST',cache:'no-store',headers:{apikey:TRACK_CONFIG.key,...(accessToken?{Authorization:'Bearer '+accessToken}:{}),'Content-Type':'application/json'},body:JSON.stringify(args)});
 const data=await r.json();if(!r.ok){const err=Error(data.message||'Não foi possível consultar o rastreio');err.status=r.status;throw err}return data;
}
let trackMap=null,trackMarker=null,trackDestination=null;
function trackInitMap(id){
 if(!window.L){document.getElementById(id).textContent='Mapa não carregou. Os horários e o status continuam disponíveis.';return null}
 const map=L.map(id).setView([-23.05,-47.84],12);
 L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);return map;
}
function trackDraw(row){
 if(!trackMap)trackMap=trackInitMap('trackMap');if(!trackMap)return;
 const f=trackFreshness(row);
 if(row.sharing&&row.lat!=null&&row.lng!=null){
  const ll=[Number(row.lat),Number(row.lng)];
  if(!trackMarker){trackMarker=L.circleMarker(ll,{radius:11,color:'#d7a852',fillColor:'#d7a852',fillOpacity:.9}).addTo(trackMap);trackMap.setView(ll,15)}else trackMarker.setLatLng(ll);
  trackMarker.setStyle({opacity:f.kind==='fresh'?1:.4,fillOpacity:f.kind==='fresh'?.9:.25});
  trackMarker.bindTooltip(f.kind==='fresh'?'Motoboy':'Última posição conhecida');
 }else if(trackMarker){trackMarker.remove();trackMarker=null}
 if(row.dest_lat!=null&&row.dest_lng!=null){if(!trackDestination){trackDestination=L.marker([row.dest_lat,row.dest_lng]).addTo(trackMap).bindTooltip('Destino confirmado pela loja');if(trackMarker)trackMap.fitBounds([[row.lat,row.lng],[row.dest_lat,row.dest_lng]],{maxZoom:16,padding:[30,30]})}else trackDestination.setLatLng([row.dest_lat,row.dest_lng])}
}

// Navigation uses the confirmed coordinates when available, otherwise the full order address.
function trackRouteURL(job){
 const coords=job.dest_lat!=null&&job.dest_lng!=null&&Number.isFinite(Number(job.dest_lat))&&Number.isFinite(Number(job.dest_lng));
 const destination=coords?Number(job.dest_lat)+','+Number(job.dest_lng):String(job.address||'').trim();
 if(!destination)return null;
 const url=new URL('https://www.google.com/maps/dir/');
 url.search=new URLSearchParams({api:'1',destination,travelmode:'driving',dir_action:'navigate'}).toString();
 return url.href;
}
