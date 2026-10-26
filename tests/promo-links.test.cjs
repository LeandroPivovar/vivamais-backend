// Links de oferta (/oferta/<slug>): 1º mês promocional, depois o preço cheio.
// Pix Automático (Woovi): assinatura de valor variável (value = promo, minimumValue = cheio)
// e PUT do valor cheio depois do 1º pagamento. Cartão (Pagar.me): preço cheio com
// desconto fixo de 1 ciclo. Roda contra o build: `npm test`.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { BillingService } = require('../dist/billing/billing.service');
const { AdminService } = require('../dist/admin/admin.service');
const { PagarmeService } = require('../dist/payment/pagarme.service');
const { WooviService } = require('../dist/payment/woovi.service');

const cfg = { activeGateway: 'woovi', planIndividualPrice: 79.9, planFamilyPrice: 129.9 };
const future = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

function promo(overrides = {}) {
  return { id: 7, slug: 'black-friday', plan: 'Família', firstMonthPrice: 29.9, maxUses: null, usesCount: 0, expiresAt: future(), active: true, ...overrides };
}

const dto = (overrides = {}) => ({
  name: 'Cliente Teste', email: 'cliente@example.invalid', cpf: '52998224725', phone: '41999887766',
  birthDate: '01/01/1990', gender: 'MASCULINO', address: 'Rua A', neighborhood: 'Centro', city: 'Curitiba',
  state: 'PR', zipCode: '80000000', planType: 'Família', paymentMethod: 'pix', promoSlug: 'black-friday', ...overrides,
});

function checkoutFixture(link) {
  const calls = { woovi: [], pagarme: [], txs: [], usersCreated: 0 };
  const svc = new BillingService();
  svc.logger = { log() {}, warn() {}, error() {} };
  svc.promoLinksRepo = { findOne: async ({ where }) => (link && where.slug === link.slug ? link : null), increment: async () => {} };
  svc.configRepo = { findOne: async () => cfg };
  svc.usersRepo = {
    findOne: async () => null,
    create: (x) => ({ ...x, id: 500 }),
    save: async (x) => { calls.usersCreated++; return x; },
    remove: async () => {},
  };
  svc.txRepo = {
    create: (x) => ({ ...x, id: 900 }),
    save: async (x) => { calls.txs.push({ ...x }); return x; },
    remove: async () => {},
  };
  svc.mailService = { sendWelcomePassword: async () => {} };
  svc.telegramService = { notifyError: async () => {} };
  svc.wooviService = {
    isEnabled: async () => true,
    createPixAutomaticSubscription: async (input) => { calls.woovi.push(input); return { ok: true, emv: 'qr', subscriptionId: 'sub-1' }; },
  };
  svc.pagarmeService = {
    isEnabled: async () => true,
    createCardSubscription: async (input) => { calls.pagarme.push(input); return { ok: true, subscriptionId: 'sub_card' }; },
    getLatestChargeStatus: async () => 'pending',
  };
  return { svc, calls };
}

test('Pix: link de oferta cria assinatura variável (R$ 29,90 agora, teto mínimo R$ 129,90)', async () => {
  const f = checkoutFixture(promo());
  const r = await f.svc.checkout(dto());
  assert.equal(r.status, 'pending');
  assert.equal(f.calls.woovi[0].amountCents, 2990);
  assert.equal(f.calls.woovi[0].minimumValueCents, 12990);
  const tx = f.calls.txs.at(-1);
  assert.equal(tx.value, 29.9);
  assert.equal(tx.recurringValue, 129.9);
  assert.equal(tx.promoLinkId, 7);
  assert.equal(tx.plan, 'Família');
});

test('Cartão: link de oferta cobra o cheio com desconto de R$ 100,00 só no 1º ciclo', async () => {
  const f = checkoutFixture(promo());
  await f.svc.checkout(dto({ paymentMethod: 'card', cardToken: 'tok_x' }));
  assert.equal(f.calls.pagarme[0].amountCents, 12990);
  assert.equal(f.calls.pagarme[0].firstCycleDiscountCents, 10000);
  assert.equal(f.calls.txs.at(-1).recurringValue, 129.9);
});

test('Sem link: checkout normal não vira assinatura variável', async () => {
  const f = checkoutFixture(promo());
  await f.svc.checkout(dto({ promoSlug: undefined }));
  assert.equal(f.calls.woovi[0].amountCents, 12990);
  assert.equal(f.calls.woovi[0].minimumValueCents, undefined);
  assert.equal(f.calls.txs.at(-1).recurringValue, null);
});

for (const [name, link, msg] of [
  ['expirado', promo({ expiresAt: new Date(Date.now() - 1000) }), /expirou/],
  ['esgotado', promo({ maxUses: 3, usesCount: 3 }), /esgotou/],
  ['encerrado', promo({ active: false }), /encerrada/],
  ['inexistente', null, /não encontrada/],
]) {
  test(`Link ${name} é recusado antes de criar o cadastro`, async () => {
    const f = checkoutFixture(link);
    await assert.rejects(f.svc.checkout(dto()), msg);
    assert.equal(f.calls.usersCreated, 0);
    assert.equal(f.calls.woovi.length, 0);
  });
}

test('Link de um plano não vale para outro', async () => {
  const f = checkoutFixture(promo());
  await assert.rejects(f.svc.checkout(dto({ planType: 'Individual' })), /apenas para o plano Família/);
  assert.equal(f.calls.usersCreated, 0);
});

test('Oferta antiga /plano-familia passa a cobrar o cheio do 2º mês em diante', async () => {
  const f = checkoutFixture(null);
  await f.svc.checkout(dto({ promoSlug: undefined, offer: 'promocional' }));
  assert.equal(f.calls.woovi[0].amountCents, 1990);
  assert.equal(f.calls.woovi[0].minimumValueCents, 12990);
  assert.equal(f.calls.txs.at(-1).plan, 'Família');
});

function syncFixture(updateOk) {
  const calls = { put: [], updates: [], alerts: [] };
  const svc = new BillingService();
  svc.logger = { log() {}, warn() {}, error() {} };
  const origin = { id: 900, userId: 500, status: 'pago', gatewayProvider: 'woovi', gatewaySubscriptionId: 'sub-1', value: 29.9, recurringValue: 129.9, recurringValueSyncedAt: null };
  svc.wooviService = { updateSubscriptionValue: async (id, cents) => { calls.put.push([id, cents]); return updateOk; } };
  svc.txRepo = { update: async (id, patch) => calls.updates.push([id, patch]), find: async () => [origin] };
  svc.notificationsService = { notifyError: async (p) => calls.alerts.push(p) };
  return { svc, calls, origin };
}

test('Depois do 1º pagamento a assinatura Woovi sobe para R$ 129,90', async () => {
  const f = syncFixture(true);
  assert.equal(await f.svc.syncRecurringValue(f.origin), true);
  assert.deepEqual(f.calls.put[0], ['sub-1', 12990]);
  assert.ok(f.origin.recurringValueSyncedAt instanceof Date);
  assert.equal(await f.svc.syncRecurringValue(f.origin), true);
  assert.equal(f.calls.put.length, 1, 'idempotente: não troca duas vezes');
});

test('Falha ao subir o valor fica pendente e avisa o grupo de erros na reconciliação', async () => {
  const f = syncFixture(false);
  await f.svc.retryRecurringValueSync();
  assert.equal(f.origin.recurringValueSyncedAt, null);
  assert.equal(f.calls.alerts.length, 1);
  assert.match(f.calls.alerts[0].detail, /R\$ 29,90.*R\$ 129,90/);
});

test('Renovação usa o preço cheio, não o promocional do 1º mês', () => {
  const svc = new BillingService();
  assert.equal(svc.recurringValueOf({ value: 29.9, recurringValue: 129.9 }), 129.9);
  assert.equal(svc.recurringValueOf({ value: 79.9, recurringValue: null }), 79.9);
});

test('Página pública do link informa disponibilidade e valores', async () => {
  const f = checkoutFixture(promo({ maxUses: 1, usesCount: 1 }));
  const r = await f.svc.getPromoLink('BLACK-FRIDAY');
  assert.equal(r.available, false);
  assert.match(r.reason, /esgotou/);
  assert.equal(r.firstMonthPrice, 29.9);
  assert.equal(r.regularPrice, 129.9);
});

function adminFixture(existing = null) {
  const saved = [];
  const svc = new AdminService();
  svc.configRepo = { findOne: async () => cfg };
  svc.promoLinksRepo = {
    findOne: async () => existing,
    create: (x) => ({ ...x, id: 1, createdAt: new Date() }),
    save: async (x) => { saved.push(x); return x; },
  };
  return { svc, saved };
}

test('Admin cria link com fim de URL, limite de usos e validade', async () => {
  const f = adminFixture();
  const expiresAt = future().toISOString();
  const r = await f.svc.createPromoLink({ slug: 'Black-Friday', plan: 'Família', firstMonthPrice: 29.9, maxUses: 50, expiresAt }, 1);
  assert.equal(r.slug, 'black-friday');
  assert.match(r.url, /\/oferta\/black-friday$/);
  assert.equal(r.status, 'ativo');
  assert.equal(f.saved[0].maxUses, 50);
});

test('Admin cria link ilimitado (sem limite de usos nem validade)', async () => {
  const f = adminFixture();
  const r = await f.svc.createPromoLink({ slug: 'sempre', plan: 'Individual', firstMonthPrice: 9.9 }, 1);
  assert.equal(r.maxUses, null);
  assert.equal(r.expiresAt, null);
});

test('Admin não cria link com fim de URL repetido', async () => {
  const f = adminFixture(promo());
  await assert.rejects(f.svc.createPromoLink({ slug: 'black-friday', plan: 'Família', firstMonthPrice: 29.9 }, 1), /Já existe/);
});

test('Admin não cria oferta com 1º mês igual ou maior que o preço normal', async () => {
  const f = adminFixture();
  await assert.rejects(f.svc.createPromoLink({ slug: 'x', plan: 'Individual', firstMonthPrice: 79.9 }, 1), /menor que o preço normal/);
});

test('Admin não cria link já vencido', async () => {
  const f = adminFixture();
  await assert.rejects(
    f.svc.createPromoLink({ slug: 'x', plan: 'Família', firstMonthPrice: 9.9, expiresAt: new Date(Date.now() - 1000).toISOString() }, 1),
    /no futuro/,
  );
});

test('Pagar.me recebe o desconto de 1 ciclo no corpo da assinatura', async (t) => {
  const original = global.fetch;
  t.after(() => { global.fetch = original; });
  let body;
  global.fetch = async (_url, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({ id: 'sub_1', status: 'active' }) }; };
  const svc = new PagarmeService({ findOne: async () => ({ pagarmeEnabled: true, pagarmeSecretKey: 'sk_test_x' }) });
  await svc.createCardSubscription({ code: 'c', customer: { name: 'A', email: 'a@x.invalid', document: '52998224725', phone: '41999887766' }, cardToken: 't', planName: 'Família', amountCents: 12990, firstCycleDiscountCents: 10000 });
  assert.deepEqual(body.discounts, [{ cycles: '1', value: '10000', discount_type: 'flat' }]);
  assert.equal(body.items[0].pricing_scheme.price, 12990);
});

test('Woovi recebe minimumValue na criação e PUT /value na troca', async (t) => {
  const original = global.fetch;
  t.after(() => { global.fetch = original; });
  const reqs = [];
  global.fetch = async (url, init = {}) => {
    reqs.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
    if (String(url).endsWith('/value')) return { ok: true, text: async () => '' };
    if ((init.method || 'GET') === 'GET' && String(url).includes('/subscriptions/')) {
      return { ok: true, json: async () => ({ subscription: { globalID: 'sub-1', value: 12990, status: 'ACTIVE', pixRecurring: { status: 'APPROVED' } } }) };
    }
    return { ok: true, json: async () => ({ subscription: { globalID: 'sub-1', pixRecurring: { emv: 'qr' } }, webhooks: [] }) };
  };
  const svc = new WooviService({ findOne: async () => ({ wooviEnabled: true, wooviAppId: 'app', wooviSandbox: false }) });
  svc.logger = { log() {}, warn() {}, error() {} };
  svc.webhookEnsured = true;
  await svc.createPixAutomaticSubscription({ correlationID: 'c', amountCents: 2990, planName: 'Família', client: { name: 'A', email: 'a@x.invalid', phone: '+5541999887766', taxID: '52998224725' }, minimumValueCents: 12990 });
  const create = reqs.find((r) => r.method === 'POST');
  assert.equal(create.body.value, 2990);
  assert.equal(create.body.pixRecurringOptions.minimumValue, 12990);
  assert.equal(await svc.updateSubscriptionValue('sub-1', 12990), true);
  const put = reqs.find((r) => r.method === 'PUT');
  assert.match(put.url, /\/subscriptions\/sub-1\/value$/);
  assert.deepEqual(put.body, { value: 12990 });
});
