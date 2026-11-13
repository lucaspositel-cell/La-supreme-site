'use strict';
const customerToken=location.hash.slice(1);let customerLast=null,customerBusy=false,customerClosed=false;
function customerStatus(){
 if(!customerLast)return;
 const closed=['delivered','unavailable'].includes(customerLast.state);
 document.getElementById('deliveryStatus').textContent=trackStates[customerLast.state]||'Acompanhando entrega';
 document.getElementById('deliveryOrder').textContent=customerLast.order_no?'Pedido '+customerLast.order_no:'';
 document.getElementById('trackMap').hidden=closed;
 const status=document.getElementById('gpsStatus');
 if(closed){status.textContent=customerLast.state==='delivered'?'Entrega concluída. Localização encerrada.':'Este link não permite mais acompanhar a localização.';customerClosed=true;if(trackMap){trackMap.remove();trackMap=null;trackMarker=null;trackDestination=null}document.getElementById('gpsDetails').textContent='';return}
 const f=trackFreshness(customerLast);status.textContent=customerLast.state==='assigned'?'A loja está organizando a saída do pedido.':f.text;status.className='notice '+f.kind;
 document.getElementById('gpsDetails').textContent=customerLast.captured_at?'Última posição: '+new Date(customerLast.captured_at).toLocaleTimeString('pt-BR')+(customerLast.accuracy!=null?' · precisão aproximada de '+Math.round(customerLast.accuracy)+' m':''):'';
 trackDraw(customerLast);
}
async function customerPoll(){
 if(customerBusy||customerClosed||document.hidden)return;customerBusy=true;
 try{
  if(!/^[a-f0-9]{64}$/.test(customerToken))throw Error('Link inválido. Use o link enviado pela pizzaria.');
  customerLast=await trackRPC('ls_track_public',{p_token:customerToken});document.getElementById('networkStatus').textContent='';customerStatus();
 }catch(e){document.getElementById('networkStatus').textContent='Não foi possível atualizar: '+e.message;if(!customerLast)document.getElementById('gpsStatus').textContent='Sem informação de localização';else customerStatus()}
 finally{customerBusy=false}
}
customerPoll();setInterval(customerPoll,10000);setInterval(customerStatus,5000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)customerPoll()});
