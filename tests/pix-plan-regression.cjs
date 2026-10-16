const assert = require('node:assert/strict');
const { test } = require('node:test');
const { BillingService } = require('../dist/billing/billing.service');
const { WooviService } = require('../dist/payment/woovi.service');
function fixture(overrides={}) {
  const row={id:279,userId:208,plan:'Individual',value:79.90,status:'pendente',gatewayProvider:'woovi',gatewaySubscriptionId:'old-sub',gatewayIdentifier:'old-correlation',pixCode:'old-qr',createdAt:new Date(),...overrides};
  const events=[];
  const cfg={activeGateway:'woovi',planIndividualPrice:79.90,planFamilyPrice:129.90};
  const user={id:208,plan:'Família',status:'pendente',phone:'11999999999',cpf:'00000000000',name:'Teste',email:'test@example.invalid'};
  const svc=new BillingService();
  svc.ensurePaidAccessForUser=async()=>{};
  svc.usersService={findById:async()=>user};
  svc.configRepo={findOne:async()=>cfg};
  svc.paymentService={isEnabled:async()=>true};
  svc.txRepo={find:async()=>[row],create:x=>({...x,id:280}),save:async x=>{events.push(['save',x.id]);return x},update:async(id,patch)=>{events.push(['update',id,patch]);Object.assign(row,patch)},remove:async()=>{}};
  svc.wooviService={isEnabled:async()=>true,getSubscriptionForPayment:async()=>({valueCents:7990,subStatus:'ACTIVE',pixRecStatus:'CREATED'}),cancelPendingSubscription:async id=>{events.push(['cancel',id]);return true},createPixAutomaticSubscription:async input=>{events.push(['create',input]);return {ok:true,emv:'new-qr-12990',subscriptionId:'new-sub'}}};
  return {svc,row,events,user,cfg};
}
const pay=f=>f.svc.payCurrentSubscription(208,{paymentMethod:'pix'});
test('Individual -> Família cancels old authorization before creating R$129.90',async()=>{
 const f=fixture(); const result=await pay(f);
 assert.equal(result.pixCode,'new-qr-12990');assert.equal(result.value,'R$ 129,90');assert.equal(result.plan,'Família');
 assert.equal(f.row.status,'cancelado');assert.equal(f.row.pixCode,null);
 const c=f.events.find(e=>e[0]==='create')[1];assert.equal(c.amountCents,12990);assert.equal(c.planName,'Família');
 assert.ok(f.events.findIndex(e=>e[0]==='cancel')<f.events.findIndex(e=>e[0]==='create'));
});
test('matching family authorization reuses QR with its own price',async()=>{
 const f=fixture({plan:'Família',value:129.90});f.svc.wooviService.getSubscriptionForPayment=async()=>({valueCents:12990,subStatus:'ACTIVE',pixRecStatus:'CREATED'});
 const r=await pay(f);assert.equal(r.pixCode,'old-qr');assert.equal(r.value,'R$ 129,90');assert.equal(f.events.length,0);
});
test('cancellation failure blocks replacement and preserves original record',async()=>{
 const f=fixture();f.svc.wooviService.cancelPendingSubscription=async()=>false;
 await assert.rejects(pay(f),/cancelar o PIX anterior/);assert.equal(f.events.length,0);assert.equal(f.row.status,'pendente');
});
test('gateway unavailable blocks issuing another authorization',async()=>{
 const f=fixture();f.svc.wooviService.getSubscriptionForPayment=async()=>null;
 await assert.rejects(pay(f),/conferir o PIX anterior/);assert.equal(f.events.length,0);
});
test('approved subscription at old price is not silently canceled or replaced',async()=>{
 const f=fixture();f.svc.wooviService.getSubscriptionForPayment=async()=>({valueCents:7990,subStatus:'ACTIVE',pixRecStatus:'APPROVED'});
 await assert.rejects(pay(f),/autorizado/);assert.equal(f.events.length,0);
});
test('paid subscription at old price is handled separately',async()=>{
 const f=fixture({status:'pago'});f.svc.wooviService.getSubscriptionForPayment=async()=>({valueCents:7990,subStatus:'ACTIVE',pixRecStatus:'APPROVED'});
 await assert.rejects(pay(f),/autorizado/);assert.equal(f.events.length,0);
});
test('gateway price mismatch cannot reuse a locally correct QR',async()=>{
 const f=fixture({plan:'Família',value:129.90});const r=await pay(f);
 assert.equal(r.pixCode,'new-qr-12990');assert.ok(f.events.some(e=>e[0]==='cancel'));
});
test('plan mismatch is invalid even if prices happen to be equal',async()=>{
 const f=fixture({value:129.90});f.svc.wooviService.getSubscriptionForPayment=async()=>({valueCents:12990,subStatus:'ACTIVE',pixRecStatus:'CREATED'});
 await pay(f);assert.ok(f.events.some(e=>e[0]==='cancel'));
});
test('expired authorization is discarded without a second cancel',async()=>{
 const f=fixture();f.svc.wooviService.getSubscriptionForPayment=async()=>({valueCents:7990,subStatus:'EXPIRED',pixRecStatus:'EXPIRED'});
 await pay(f);assert.equal(f.row.status,'cancelado');assert.ok(!f.events.some(e=>e[0]==='cancel'));
});
test('repeated simultaneous clicks create one new authorization',async()=>{
 const f=fixture();const results=await Promise.all([pay(f),pay(f),pay(f)]);
 assert.equal(f.events.filter(e=>e[0]==='create').length,1);assert.equal(new Set(results.map(r=>r.transactionId)).size,1);
});
test('failed request releases per-user lock so retry works',async()=>{
 const f=fixture();f.svc.wooviService.cancelPendingSubscription=async()=>false;
 await assert.rejects(pay(f));f.svc.wooviService.cancelPendingSubscription=async()=>true;
 assert.equal((await pay(f)).value,'R$ 129,90');
});
test('Woovi exact lookup, cancellation and confirmation use documented API',async()=>{
 const original=global.fetch;const calls=[];let canceled=false;
 const cfg={wooviEnabled:true,wooviAppId:'test-only',wooviSandbox:true};
 const w=new WooviService({findOne:async()=>cfg});
 global.fetch=async(url,opts)=>{calls.push({url,method:opts.method||'GET'});if(opts.method==='PUT'){canceled=true;return {ok:true}}return {ok:true,json:async()=>({subscription:{globalID:'sub/id=',value:7990,status:canceled?'CANCELED':'ACTIVE',pixRecurring:{status:canceled?'CANCELED':'CREATED'}}})}};
 try {
  assert.equal((await w.getSubscriptionForPayment('sub/id=')).valueCents,7990);
  assert.equal(await w.cancelPendingSubscription('sub/id='),true);
  assert.ok(calls[1].url.endsWith('/subscriptions/sub%2Fid%3D/cancel'));
  assert.equal(calls[1].method,'PUT');assert.equal(calls[2].method,'GET');
  global.fetch=async()=>({ok:true,json:async()=>({subscription:{globalID:'wrong-id',value:7990}})});
  assert.equal(await w.getSubscriptionForPayment('expected-id'),null);
 } finally {global.fetch=original}
});
test('successful HTTP cancellation without closed state does not allow replacement',async()=>{
 const original=global.fetch;const w=new WooviService({findOne:async()=>({wooviEnabled:true,wooviAppId:'test'})});
 global.fetch=async(url,opts)=>opts.method==='PUT'?{ok:true}:{ok:true,json:async()=>({subscription:{globalID:'id',value:7990,status:'ACTIVE',pixRecurring:{status:'CREATED'}}})};
 try {assert.equal(await w.cancelPendingSubscription('id'),false)} finally {global.fetch=original}
});
test('reconciliation only accepts the exact requested subscription',async()=>{
 const original=global.fetch;const w=new WooviService({findOne:async()=>({wooviEnabled:true,wooviAppId:'test'})});
 try {
  global.fetch=async url=>{assert.ok(url.endsWith('/subscriptions/vm-208-example'));return {ok:true,json:async()=>({subscription:{globalID:'sub',correlationID:'vm-208-example',status:'ACTIVE',pixRecurring:{status:'CREATED'}}})}};
  assert.equal((await w.getSubscriptionByCorrelation('vm-208-example')).pixRecStatus,'CREATED');
  global.fetch=async()=>({ok:true,json:async()=>({subscriptions:[{globalID:'someone-else',value:200,status:'ACTIVE'}]})});
  assert.equal(await w.getSubscriptionByCorrelation('vm-208-example'),null);
  global.fetch=async()=>({ok:true,json:async()=>({subscription:{globalID:'other',correlationID:'other'}})});
  assert.equal(await w.getSubscriptionByCorrelation('vm-208-example'),null);
 }finally{global.fetch=original}
});
test('billing through real Woovi adapter sends 12990 cents after confirmed cancellation',async()=>{
 const original=global.fetch;const f=fixture();const calls=[];let canceled=false;
 const w=new WooviService({findOne:async()=>({wooviEnabled:true,wooviAppId:'test',wooviSandbox:true})});w.webhookEnsured=true;f.svc.wooviService=w;
 global.fetch=async(url,opts)=>{
  const method=opts.method||'GET';calls.push(method);
  if(method==='PUT'){canceled=true;return {ok:true}}
  if(method==='POST'){const body=JSON.parse(opts.body);assert.equal(body.value,12990);assert.equal(body.name,'Viva Mais - Família');assert.equal(body.type,'PIX_RECURRING');return {ok:true,json:async()=>({subscription:{globalID:'new-sub',correlationID:body.correlationID,value:body.value,pixRecurring:{emv:'family-qr',status:'CREATED'}}})}}
  return {ok:true,json:async()=>({subscription:{globalID:'old-sub',value:7990,status:canceled?'CANCELED':'ACTIVE',pixRecurring:{status:canceled?'CANCELED':'CREATED'}}})};
 };
 try {const r=await pay(f);assert.equal(r.pixCode,'family-qr');assert.equal(r.value,'R$ 129,90');assert.deepEqual(calls,['GET','PUT','GET','POST'])} finally {global.fetch=original}
});
