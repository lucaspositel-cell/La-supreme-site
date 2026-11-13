'use strict';
let driverSession=null;try{driverSession=JSON.parse(sessionStorage.getItem('ls_driver_session')||'null')}catch(e){}
let driverWakeLock=null;
let driverData=null,driverWatch=null,driverGPSJob=null,driverGPSSession=null,driverGPSGeneration=0,driverLastSend=0,driverSending=false,driverLoading=false,driverAction=false,driverRefreshPromise=null,driverStartingGPS=false;
const driverError=message=>{const el=document.getElementById('driverError');el.hidden=!message;el.textContent=message||''};
function driverSaveSession(s){driverSession=s;if(s)sessionStorage.setItem('ls_driver_session',JSON.stringify(s));else sessionStorage.removeItem('ls_driver_session')}
async function driverAuth(endpoint,body){
 const r=await fetch(TRACK_CONFIG.url+'/auth/v1/'+endpoint,{method:'POST',headers:{apikey:TRACK_CONFIG.key,'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error_description||d.msg||'Não foi possível entrar');return d;
}
async function driverRPC(name,args={}){
 if(!driverSession)throw Error('Entre com seu usuário');
 try{return await trackRPC(name,args,driverSession.access_token)}catch(e){
  if(e.status!==401||!driverSession.refresh_token)throw e;
  if(!driverRefreshPromise)driverRefreshPromise=driverAuth('token?grant_type=refresh_token',{refresh_token:driverSession.refresh_token}).then(driverSaveSession).finally(()=>driverRefreshPromise=null);
  await driverRefreshPromise;return trackRPC(name,args,driverSession.access_token);
 }
}
async function driverLoad(){
 if(driverLoading||!driverSession)return;driverLoading=true;
 try{
  driverData=await driverRPC('ls_track_driver_jobs');document.getElementById('driverLogin').hidden=true;document.getElementById('driverApp').hidden=false;driverError('');
  document.getElementById('driverName').textContent=driverData.name+' · Minhas entregas';
  const active=Date.parse(driverData.shift_until||'')>Date.now();document.getElementById('driverShiftStatus').textContent=active?'Turno ativo até '+new Date(driverData.shift_until).toLocaleTimeString('pt-BR'):'Turno encerrado. Inicie o turno para sair em entrega.';
  if(driverGPSJob&&(!active||!driverData.jobs.some(j=>j.id===driverGPSJob&&['enroute','arrived'].includes(j.state)&&Date.parse(j.expires_at)>Date.now()&&!['cancelado','cancelada','concluido'].includes(j.order_status))))await driverStopGPS(true);
  document.getElementById('driverJobs').innerHTML=driverData.jobs.map(j=>`<article class="card"><small>${trackEscape(trackStates[j.state])}</small><h2>Pedido ${trackEscape(j.order_no)}</h2><p>${trackEscape(j.customer_name||'')}<br>${trackEscape(j.address||'Confira o endereço com a loja')}</p>${driverRouteActions(j)}<p class="muted">Pagamento: ${trackEscape(j.payment||'')} · ${trackEscape(j.payment_status||'a conferir')}<br>Total do pedido: R$ ${Number(j.total||0).toFixed(2).replace('.',',')}<br>Entregar não confirma recebimento financeiro.</p>${Date.parse(j.expires_at)<=Date.now()?'<p>Rastreio expirado: solicite nova atribuição à loja.</p>':`<div class="actions">${j.state==='assigned'?`<button onclick="driverTransition('${j.id}','enroute')">Sair para entrega</button>`:''}${j.state==='enroute'?`<button onclick="driverTransition('${j.id}','arrived')">Cheguei</button>`:''}${['enroute','arrived'].includes(j.state)?`<button onclick="driverTransition('${j.id}','delivered')">Confirmar entrega</button>`:''}</div>`}</article>`).join('')||'<div class="card">Nenhuma entrega atribuída. Aguarde a loja.</div>';
 }catch(e){driverError(e.message);if(e.status===401){await driverStopGPS(false);driverSaveSession(null);document.getElementById('driverLogin').hidden=false;document.getElementById('driverApp').hidden=true}}
 finally{driverLoading=false}
}
async function driverShift(on){
 if(driverAction)return;driverAction=true;
 try{if(!on){if(!confirm('Encerrar o turno e parar o compartilhamento?'))return;await driverStopGPS(false)}await driverRPC('ls_track_shift',{p_on:on});await driverLoad()}catch(e){driverError(e.message)}finally{driverAction=false}
}
async function driverTransition(id,state){
 if(driverAction)return;
 if(state==='delivered'&&!confirm('Confirmar que este pedido foi entregue? O rastreio do cliente será encerrado. Isso NÃO confirma o pagamento.'))return;
 driverAction=true;
 try{await driverRPC('ls_track_transition',{p_id:id,p_state:state});if(state==='delivered'&&driverGPSJob===id)await driverStopGPS(false);await driverLoad();if(state==='enroute')document.getElementById('driverGpsStatus').textContent='Saída registrada. Toque em Ativar GPS para compartilhar a localização.'}catch(e){driverError(e.message)}finally{driverAction=false}
}
async function driverStopGPS(notify=true){
 const id=driverGPSJob,session=driverGPSSession;driverGPSGeneration++;if(driverWatch!==null)navigator.geolocation.clearWatch(driverWatch);driverWatch=null;driverGPSJob=null;driverGPSSession=null;driverLastSend=0;
 if(driverWakeLock){driverWakeLock.release().catch(()=>{});driverWakeLock=null}if(trackMap){trackMap.remove();trackMap=null;trackMarker=null;trackDestination=null}document.getElementById('trackMap').hidden=true;
 document.getElementById('driverGpsStatus').textContent='GPS pausado. Para retomar, toque em Ativar GPS.';
 if(notify&&id&&session&&driverSession){try{await driverRPC('ls_track_pause',{p_id:id,p_session:session})}catch(e){driverError('GPS local parado. Sem conexão para avisar a loja; a posição anterior ficará sinalizada como antiga.')}}
}
async function driverStartGPS(){if(driverStartingGPS)return;driverStartingGPS=true;try{return await driverStartGPSImpl()}finally{driverStartingGPS=false}}
async function driverStartGPSImpl(){
 if(!isSecureContext)return driverError('Abra pelo endereço HTTPS do site.');
 if(!navigator.geolocation)return driverError('Este navegador não oferece localização.');
 if(!document.getElementById('gpsConsent').checked)return driverError('Marque a autorização de localização para continuar.');
 if(!driverData||Date.parse(driverData.shift_until||'')<=Date.now())return driverError('Inicie seu turno primeiro.');
 const job=driverData.jobs.find(j=>['enroute','arrived'].includes(j.state)&&Date.parse(j.expires_at)>Date.now());
 if(!job)return driverError('Registre a saída de uma entrega antes de ativar o GPS.');
 await driverStopGPS(true);driverError('');driverGPSJob=job.id;const generation=driverGPSGeneration;
 try{driverGPSSession=await driverRPC('ls_track_gps_start',{p_id:job.id})}catch(e){await driverStopGPS(false);return driverError(e.message)}
 if(document.hidden||generation!==driverGPSGeneration){await driverStopGPS(true);return}
 document.getElementById('driverGpsStatus').textContent='Aguardando permissão e sinal GPS…';
 driverHoldScreen(generation);
 driverWatch=navigator.geolocation.watchPosition(async pos=>{
  if(driverSending||generation!==driverGPSGeneration||!driverGPSJob||document.hidden||Date.now()-driverLastSend<8000)return;
  driverSending=true;const id=driverGPSJob;driverLastSend=Date.now();
  try{await driverRPC('ls_track_position',{p_id:id,p_session:driverGPSSession,p_lat:pos.coords.latitude,p_lng:pos.coords.longitude,p_accuracy:pos.coords.accuracy,p_captured:new Date(pos.timestamp).toISOString()});if(generation===driverGPSGeneration){document.getElementById('trackMap').hidden=false;trackDraw({sharing:true,lat:pos.coords.latitude,lng:pos.coords.longitude,accuracy:pos.coords.accuracy,captured_at:new Date(pos.timestamp).toISOString(),received_at:new Date().toISOString(),dest_lat:job.dest_lat,dest_lng:job.dest_lng});document.getElementById('driverGpsStatus').textContent='Localização enviada às '+new Date().toLocaleTimeString('pt-BR')+' · precisão aproximada '+Math.round(pos.coords.accuracy)+' m'}}catch(e){if(generation===driverGPSGeneration){document.getElementById('driverGpsStatus').textContent='Sem atualização: '+e.message;if(e.status===400||e.status===401)await driverStopGPS(true)}}finally{driverSending=false}
 },async err=>{if(generation!==driverGPSGeneration)return;await driverStopGPS(true);driverError(err.code===1?'Permissão de localização negada. Autorize nas configurações do navegador e tente novamente.':'Não foi possível obter o GPS. Confira o sinal e tente novamente.')},{enableHighAccuracy:true,maximumAge:0,timeout:20000});
}
async function driverLogout(){
 await driverStopGPS(true);try{if(driverSession)await driverRPC('ls_track_shift',{p_on:false})}catch(e){}
 const old=driverSession;driverSaveSession(null);driverData=null;document.getElementById('driverApp').hidden=true;document.getElementById('driverLogin').hidden=false;
 if(old)fetch(TRACK_CONFIG.url+'/auth/v1/logout',{method:'POST',headers:{apikey:TRACK_CONFIG.key,Authorization:'Bearer '+old.access_token}}).catch(()=>{});
}
document.getElementById('driverLoginForm').addEventListener('submit',async e=>{
 e.preventDefault();const button=document.getElementById('driverLoginButton');if(button.disabled)return;button.disabled=true;
 const password=document.getElementById('driverPassword').value;document.getElementById('driverPassword').value='';
 try{driverSaveSession(await driverAuth('token?grant_type=password',{email:document.getElementById('driverEmail').value.trim(),password}));await driverLoad()}catch(err){driverError(err.message)}finally{button.disabled=false}
});
document.getElementById('gpsConsent').addEventListener('change',e=>{if(!e.target.checked)driverStopGPS(true)});
document.addEventListener('visibilitychange',()=>{if(document.hidden)driverStopGPS(true);else driverLoad()});
window.addEventListener('pagehide',()=>{const id=driverGPSJob,session=driverGPSSession;if(driverWatch!==null)navigator.geolocation.clearWatch(driverWatch);if(id&&session&&driverSession)fetch(TRACK_CONFIG.url+'/rest/v1/rpc/ls_track_pause',{method:'POST',keepalive:true,headers:{apikey:TRACK_CONFIG.key,Authorization:'Bearer '+driverSession.access_token,'Content-Type':'application/json'},body:JSON.stringify({p_id:id,p_session:session})}).catch(()=>{})});
driverLoad();setInterval(driverLoad,15000);

function driverRouteActions(job){
 if(['cancelado','cancelada','concluido'].includes(job.order_status))return '<p>Pedido encerrado pela loja. Aguarde nova atribuição.</p>';
 const route=trackRouteURL(job);
 return '<div class="actions">'+(route?'<a class="route-button" target="_blank" rel="noopener noreferrer" href="'+trackEscape(route)+'" onclick="return driverRouteConfirm()">📍 Abrir rota</a>':'<span>Solicite o endereço à loja.</span>')+'<button class="secondary" onclick="driverCopyAddress(\''+job.id+'\')">Copiar endereço</button></div>';
}
function driverRouteConfirm(){
 if(!confirm('Confira o destino no mapa. Ao abrir outro aplicativo, o rastreio pelo site pausa. Volte a esta página e toque em Ativar GPS para retomar. Abrir rota?'))return false;
 driverStopGPS(true);return true;
}
async function driverCopyAddress(id){
 const job=driverData?.jobs.find(j=>j.id===id);if(!job)return;
 try{await navigator.clipboard.writeText(job.address||'');driverError('Endereço copiado.')}catch(e){prompt('Copie o endereço:',job.address||'')}
}
async function driverHoldScreen(generation){
 if(!navigator.wakeLock||document.hidden)return;
 try{const lock=await navigator.wakeLock.request('screen');if(generation!==driverGPSGeneration||document.hidden){await lock.release();return}driverWakeLock=lock;lock.addEventListener('release',()=>{if(driverWakeLock===lock)driverWakeLock=null})}catch(e){/* GPS still works while the screen remains on. */}
}
