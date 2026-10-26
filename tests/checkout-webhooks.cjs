const test = require('node:test');
const assert = require('node:assert/strict');
const { MassflowService } = require('../dist/massflow/massflow.service');
const sale = 'https://tracking.example.invalid/sale';
const cart = 'https://tracking.example.invalid/cart';
const oldSale = 'https://existing.example.invalid/events';
const oldCart = 'https://existing.example.invalid/cart';
function fixture(t, config = {}) {
  const originalFetch = global.fetch;
  const prior = { sale: process.env.CHECKOUT_SALE_WEBHOOK_URL, cart: process.env.CHECKOUT_ABANDON_WEBHOOK_URL };
  process.env.CHECKOUT_SALE_WEBHOOK_URL = sale;
  process.env.CHECKOUT_ABANDON_WEBHOOK_URL = cart;
  t.after(() => {
    global.fetch = originalFetch;
    for (const [key, value] of [['CHECKOUT_SALE_WEBHOOK_URL', prior.sale], ['CHECKOUT_ABANDON_WEBHOOK_URL', prior.cart]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const requests = [];
  global.fetch = async (url, init) => { requests.push({ url, body: JSON.parse(init.body), headers: init.headers }); return { ok: true, status: 200, text: async () => 'ok' }; };
  const svc = new MassflowService({ findOne: async () => ({ massflowWebhookUrl: oldSale, massflowCartWebhookUrl: oldCart, ...config }) });
  svc.logger = { log() {}, warn() {} };
  return { svc, requests };
}
const lead = plan => ({ name: 'Teste local', phone: '', email: 'teste@example.invalid', plan, value: plan === 'Família' ? 129.9 : 79.9, transactionId: 123, paymentMethod: 'Pix Automático', minutesPending: 6, checkoutUrl: 'https://conta.example.invalid/financeiro' });
for (const plan of ['Individual', 'Família']) {
  test(`${plan}: venda usa o endpoint correto e preserva o envio existente`, async t => {
    const f = fixture(t); assert.equal(await f.svc.notifyPurchase(lead(plan)), true);
    assert.equal(f.requests.length, 2); assert.ok(f.requests.some(r => r.url === oldSale));
    const sent = f.requests.find(r => r.url === sale);
    assert.equal(sent.body.evento, 'compra_concluida'); assert.equal(sent.body.plano, plan);
    assert.equal(sent.body.valor, lead(plan).value); assert.equal(sent.body.transacaoId, 123);
    assert.equal(sent.headers['Idempotency-Key'], 'vivamais:compra_concluida:123');
    assert.ok(!f.requests.some(r => r.url === cart));
  });
  test(`${plan}: abandono usa o endpoint correto com plano e link de retorno`, async t => {
    const f = fixture(t); assert.equal(await f.svc.notifyAbandonedCart(lead(plan)), true);
    assert.equal(f.requests.length, 2); assert.ok(f.requests.some(r => r.url === oldCart));
    const sent = f.requests.find(r => r.url === cart);
    assert.equal(sent.body.evento, 'carrinho_abandonado'); assert.equal(sent.body.plano, plan);
    assert.equal(sent.body.minutosPendente, 6); assert.equal(sent.body.linkPagamento, lead(plan).checkoutUrl);
    assert.ok(!f.requests.some(r => r.url === sale));
  });
}
test('renovações, suporte e teste administrativo não entram no endpoint de vendas', async t => {
  const f = fixture(t);
  await f.svc.notifyRenewal(lead('Família')); await f.svc.notifyEvent('chamado', 'Teste'); await f.svc.sendTest('eventos', {});
  assert.equal(f.requests.length, 3); assert.ok(f.requests.every(r => r.url === oldSale));
});
test('outros planos não são enviados aos endpoints novos', async t => {
  const f = fixture(t);
  for (const plan of ['Bronze', 'Viva Mais Premium']) { await f.svc.notifyPurchase(lead(plan)); await f.svc.notifyAbandonedCart(lead(plan)); }
  assert.equal(f.requests.length, 4); assert.ok(f.requests.every(r => r.url === oldSale || r.url === oldCart));
});
test('sem configuração nova, mantém somente as automações existentes', async t => {
  const f = fixture(t); delete process.env.CHECKOUT_SALE_WEBHOOK_URL; delete process.env.CHECKOUT_ABANDON_WEBHOOK_URL;
  await f.svc.notifyPurchase(lead('Individual')); await f.svc.notifyAbandonedCart(lead('Família'));
  assert.deepEqual(f.requests.map(r => r.url), [oldSale, oldCart]);
});
test('URLs iguais não duplicam os envios', async t => {
  const f = fixture(t, { massflowWebhookUrl: sale, massflowCartWebhookUrl: cart });
  await f.svc.notifyPurchase(lead('Individual')); await f.svc.notifyAbandonedCart(lead('Família'));
  assert.deepEqual(f.requests.map(r => r.url), [sale, cart]);
});
test('falha no endpoint novo não interrompe pagamento nem o envio existente', async t => {
  const f = fixture(t); const fetchMock = global.fetch;
  global.fetch = async (url, init) => { if (url === sale) throw new Error('Timeout simulado'); return fetchMock(url, init); };
  assert.equal(await f.svc.notifyPurchase(lead('Individual')), false);
  assert.equal(f.requests[0].url, oldSale);
});
