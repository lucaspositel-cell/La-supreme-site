let dispatchData=null,dispatchOrders=[],dispatchMap=null,dispatchMarkers=[],dispatchTimer=null,dispatchBusy=false;
async function openTrackingPanel(){
 if(!panelFinanceAllowed())return panelDenyFinance();
 closeTrackingPanel();const overlay=document.createElement('div');overlay.id='dispatchOverlay';overlay.className='dispatch-overlay';
 overlay.innerHTML=`<div class="dispatch-shell"><div class="dispatch-heading"><div><h2>🛵 Entregas e rastreamento</h2><p>Vincule o motoboy ao pedido e copie o link exclusivo do cliente.</p></div><button onclick="closeTrackingPanel()">Fechar</button></div><div id="dispatchError" role="status"></div><div class="dispatch-grid"><section class="dispatch-card"><h3>1. Cadastrar motoboy</h3><p>Crie antes a conta em Supabase → Authentication → Users. Use aqui o mesmo e-mail.</p><label>Nome de exibição<input id="dispatchDriverName" maxlength="80"></label><label>E-mail da conta<input id="dispatchDriverEmail" type="email"></label><label><input id="dispatchDriverActive" type="checkbox" checked> Conta ativa</label><button onclick="dispatchSaveDriver(this)">Salvar motoboy</button><p><a href="motoboy.html" target="_blank" rel="noopener">Abrir acesso do motoboy ↗</a></p></section><section class="dispatch-card"><h3>2. Atribuir uma entrega</h3><label>Pedido em preparo / saída<select id="dispatchOrder"></select></label><label>Motoboy<select id="dispatchDriver"></select></label><p>Destino no mapa (opcional). Sem coordenadas, o cliente verá somente o motoboy. O endereço continua visível ao entregador.</p><div class="dispatch-grid"><label>Latitude<input id="dispatchLat" inputmode="decimal" placeholder="Opcional"></label><label>Longitude<input id="dispatchLng" inputmode="decimal" placeholder="Opcional"></label></div><button onclick="dispatchAssign(this)">Atribuir pedido</button></section></div><div class="dispatch-tools"><button onclick="dispatchLoad()">↻ Atualizar</button><span>Mapa com última posição enviada; não representa uma rota calculada.</span></div><div id="dispatchMap"></div><div id="dispatchJobs"></div></div>`;
 document.body.appendChild(overlay);await dispatchLoad();dispatchTimer=setInterval(dispatchLoad,10000);
}
function closeTrackingPanel(){if(dispatchTimer)clearInterval(dispatchTimer);dispatchTimer=null;if(dispatchMap){dispatchMap.remove();dispatchMap=null}dispatchMarkers=[];document.getElementById('dispatchOverlay')?.remove()}
async function dispatchCall(name,args={}){if(!panelFinanceAllowed())throw Error('Acesso restrito');return api('rpc/'+name,{method:'POST',body:JSON.stringify(args)})}
async function dispatchLoad(){
 if(dispatchBusy||!document.getElementById('dispatchJobs'))return;dispatchBusy=true;
 try{
  const [d,orders]=await Promise.all([dispatchCall('ls_track_dispatch'),api('orders?select=id,order_no,customer_name,address&fulfillment=eq.delivery&status=in.(preparo,entrega)&order=created_at.asc&limit=1000')]);
  if(!document.getElementById('dispatchJobs'))return;
  dispatchData=d;dispatchOrders=orders;
  const orderSelect=document.getElementById('dispatchOrder'),driverSelect=document.getElementById('dispatchDriver'),oldOrder=orderSelect.value,oldDriver=driverSelect.value;
  const assigned=new Set(d.jobs.filter(j=>['assigned','enroute','arrived'].includes(j.state)).map(j=>String(j.order_id)));
  orderSelect.innerHTML='<option value="">Selecione o pedido</option>'+orders.filter(o=>!assigned.has(String(o.id))).map(o=>`<option value="${esc(o.id)}">${esc(o.order_no)} · ${esc(o.customer_name||'Cliente')}</option>`).join('');driverSelect.innerHTML='<option value="">Selecione o motoboy</option>'+d.drivers.filter(x=>x.active).map(x=>`<option value="${esc(x.user_id)}">${esc(x.name)} · ${Date.parse(x.shift_until||'')>Date.now()?'turno ativo':'fora de turno'}</option>`).join('');orderSelect.value=oldOrder;driverSelect.value=oldDriver;
  document.getElementById('dispatchError').textContent='Atualizado às '+new Date().toLocaleTimeString('pt-BR')+'. Link expira em até 8 horas; conclua ou cancele atribuições antigas para liberar o pedido.';
  document.getElementById('dispatchJobs').innerHTML=d.jobs.map(j=>{
   const active=['assigned','enroute','arrived'].includes(j.state),driver=d.drivers.find(x=>x.user_id===j.driver_id),sharing=active&&driver?.active&&Date.parse(driver.shift_until||'')>Date.now()&&Date.parse(j.expires_at)>Date.now()&&!['cancelado','cancelada','concluido'].includes(j.order_status)&&j.lat!=null;
   const f=trackFreshness({...j,sharing});
   return `<article class="dispatch-card"><h3>${esc(j.order_no)} · ${esc(j.driver_name)}</h3><p>${esc(j.customer_name||'')} · ${esc(j.address||'')}</p><p><b>${esc(trackStates[j.state]||j.state)}</b> · ${esc(f.text)}</p>${active?`<div class="dispatch-tools"><button onclick="dispatchCopy('${j.id}')">Copiar link do cliente</button><button onclick="dispatchRevoke('${j.id}',this)">Cancelar rastreio / trocar motoboy</button></div>`:'<p>Localização encerrada.</p>'}</article>`;
  }).join('')||'<div class="dispatch-card">Nenhuma entrega atribuída.</div>';
  dispatchDraw();
 }catch(e){if(document.getElementById('dispatchError'))document.getElementById('dispatchError').textContent='Não foi possível atualizar. Execute RASTREAMENTO_LA_SUPREME.sql e confira seu acesso. '+e.message}
 finally{dispatchBusy=false}
}
function dispatchDraw(){
 if(!window.L)return;if(!dispatchMap)dispatchMap=trackInitMap('dispatchMap');if(!dispatchMap)return;
 dispatchMarkers.forEach(m=>m.remove());dispatchMarkers=[];const positions=[];
 for(const j of dispatchData.jobs){const driver=dispatchData.drivers.find(c=>c.user_id===j.driver_id);if(!['enroute','arrived'].includes(j.state)||!driver?.active||Date.parse(driver.shift_until||'')<=Date.now()||Date.parse(j.expires_at)<=Date.now()||['cancelado','cancelada','concluido'].includes(j.order_status)||j.lat==null||j.lng==null)continue;
  const f=trackFreshness({...j,sharing:true}),ll=[j.lat,j.lng];positions.push(ll);dispatchMarkers.push(L.circleMarker(ll,{radius:10,color:f.kind==='fresh'?'#39a769':'#d29952',fillOpacity:.7}).addTo(dispatchMap).bindTooltip(esc(j.driver_name)+' · '+esc(j.order_no)+' · '+esc(f.text)));
 }
 if(positions.length&&!dispatchMap._lsCentered){dispatchMap.fitBounds(positions,{maxZoom:15,padding:[25,25]});dispatchMap._lsCentered=true}
}
async function dispatchSaveDriver(button){
 if(button.disabled)return;button.disabled=true;
 try{const email=document.getElementById('dispatchDriverEmail').value.trim(),name=document.getElementById('dispatchDriverName').value.trim();if(!email||name.length<2)throw Error('Informe nome e e-mail do motoboy');await dispatchCall('ls_track_set_driver',{p_email:email,p_name:name,p_active:document.getElementById('dispatchDriverActive').checked});await dispatchLoad()}catch(e){alert(e.message)}finally{button.disabled=false}
}
async function dispatchAssign(button){
 if(button.disabled)return;button.disabled=true;
 try{
  const id=document.getElementById('dispatchOrder').value,driver=document.getElementById('dispatchDriver').value,lat=document.getElementById('dispatchLat').value.trim(),lng=document.getElementById('dispatchLng').value.trim();if(!id||!driver)throw Error('Selecione pedido e motoboy');
  const a=lat?Number(lat.replace(',','.')):null,b=lng?Number(lng.replace(',','.')):null;
  if((a===null)!==(b===null)||(a!==null&&(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a)>90||Math.abs(b)>180)))throw Error('Informe as duas coordenadas válidas ou deixe ambas vazias');
  await dispatchCall('ls_track_assign',{p_order:String(id),p_driver:driver,p_lat:a,p_lng:b});await dispatchLoad();document.getElementById('dispatchLat').value='';document.getElementById('dispatchLng').value='';
 }catch(e){alert(e.message)}finally{button.disabled=false}
}
async function dispatchCopy(id){
 const job=dispatchData?.jobs.find(j=>j.id===id);if(!job||!['assigned','enroute','arrived'].includes(job.state))return;
 if(Date.parse(job.expires_at)<=Date.now())return alert('Link expirado. Cancele e crie nova atribuição.');
 const link=new URL('acompanhar.html',location.href);link.hash=job.token;
 try{await navigator.clipboard.writeText(link.href);alert('Link copiado. Cole na conversa do cliente. Nenhuma mensagem foi enviada automaticamente.')}catch(e){prompt('Copie o link exclusivo desta entrega:',link.href)}
}
async function dispatchRevoke(id,button){
 if(!confirm('Encerrar este rastreio e revogar o acesso à localização? O pedido e o pagamento não serão cancelados.'))return;
 button.disabled=true;try{await dispatchCall('ls_track_transition',{p_id:id,p_state:'canceled'});await dispatchLoad()}catch(e){alert(e.message)}finally{button.disabled=false}
}
