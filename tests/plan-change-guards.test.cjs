// Troca de plano com cobrança pendente: tela e banco nunca podem mostrar valores diferentes.
// Complementa pix-plan-regression.cjs (Woovi) com o caminho da Veenca, a troca de plano
// pelo admin e o alarme de pagamento com plano/valor diferente da conta.
// Roda contra o build: `npm run build && node --test tests/`.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { BillingService } = require('../dist/billing/billing.service');
const { AdminService } = require('../dist/admin/admin.service');

const cfg = { activeGateway: 'veenca', planIndividualPrice: 79.9, planFamilyPrice: 129.9 };

function veencaFixture(existing) {
  const events = [];
  const user = { id: 208, plan: 'Família', status: 'pendente', phone: '11999999999', cpf: '00000000000', name: 'Teste', email: 'test@example.invalid' };
  const svc = new BillingService();
  svc.ensurePaidAccessForUser = async () => {};
  svc.usersService = { findById: async () => user };
  svc.configRepo = { findOne: async () => cfg };
  svc.pagarmeService = { isEnabled: async () => false };
  svc.wooviService = { isEnabled: async () => false };
  svc.paymentService = {
    isEnabled: async () => true,
    createSubscription: async (input) => {
      events.push(['create', input]);
      return { ok: true, transactionId: 'veenca-new', pixCode: 'new-qr-129' };
    },
    getTransaction: async () => ({ status: 'PENDING' }),
  };
  svc.txRepo = {
    findOne: async () => existing,
    create: (x) => ({ ...x, id: 300 }),
    save: async (x) => x,
    update: async (id, patch) => {
      events.push(['update', id, patch]);
      Object.assign(existing, patch);
    },
    remove: async () => {},
  };
  return { svc, events };
}

test('Veenca: PIX pendente de outro plano não é reaproveitado e vira cancelado', async () => {
  const old = { id: 279, plan: 'Individual', value: 79.9, status: 'pendente', paymentMethod: 'PIX', pixCode: 'old-qr-79', createdAt: new Date() };
  const f = veencaFixture(old);
  const r = await f.svc.payCurrentSubscription(208, { paymentMethod: 'pix' });
  assert.equal(r.pixCode, 'new-qr-129');
  assert.equal(r.value, 'R$ 129,90');
  assert.equal(old.status, 'cancelado');
  assert.equal(old.pixCode, null);
  assert.equal(f.events.find((e) => e[0] === 'create')[1].amount, 129.9);
});

test('Veenca: PIX pendente do mesmo plano e valor é reaproveitado com o valor dele', async () => {
  const same = { id: 280, plan: 'Família', value: 129.9, status: 'pendente', paymentMethod: 'PIX', pixCode: 'qr-129', createdAt: new Date() };
  const f = veencaFixture(same);
  const r = await f.svc.payCurrentSubscription(208, { paymentMethod: 'pix' });
  assert.equal(r.pixCode, 'qr-129');
  assert.equal(r.value, 'R$ 129,90');
  assert.equal(f.events.length, 0);
});

function adminFixture(rows, wooviState, cancelOk = true) {
  const events = [];
  const svc = new AdminService();
  svc.txRepo = {
    find: async () => rows,
    update: async (id, patch) => {
      events.push(['update', id, patch]);
      Object.assign(rows.find((r) => r.id === id), patch);
    },
  };
  svc.wooviService = {
    getSubscriptionForPayment: async () => wooviState,
    cancelPendingSubscription: async (id) => {
      events.push(['cancel', id]);
      return cancelOk;
    },
  };
  svc.pagarmeService = { cancelSubscription: async (id) => (events.push(['pagarme-cancel', id]), true) };
  return { svc, events };
}

test('Admin troca o plano: PIX pendente do plano antigo é cancelado na Woovi e localmente', async () => {
  const rows = [{ id: 279, plan: 'Individual', value: 79.9, status: 'pendente', gatewayProvider: 'woovi', gatewaySubscriptionId: 'old-sub', pixCode: 'old-qr' }];
  const f = adminFixture(rows, { valueCents: 7990, subStatus: 'ACTIVE', pixRecStatus: 'CREATED' });
  await f.svc.cancelPendingChargesForOtherPlan(208, 'Família');
  assert.deepEqual(f.events[0], ['cancel', 'old-sub']);
  assert.equal(rows[0].status, 'cancelado');
  assert.equal(rows[0].pixCode, null);
});

test('Admin troca o plano: cobrança pendente do plano novo fica intacta', async () => {
  const rows = [{ id: 280, plan: 'Família', value: 129.9, status: 'pendente', gatewayProvider: 'woovi', gatewaySubscriptionId: 'sub', pixCode: 'qr' }];
  const f = adminFixture(rows, { valueCents: 12990, subStatus: 'ACTIVE', pixRecStatus: 'CREATED' });
  await f.svc.cancelPendingChargesForOtherPlan(208, 'Família');
  assert.equal(f.events.length, 0);
  assert.equal(rows[0].status, 'pendente');
});

test('Admin troca o plano: Pix Automático já autorizado não é cancelado (vai para o suporte)', async () => {
  const rows = [{ id: 279, plan: 'Individual', value: 79.9, status: 'pendente', gatewayProvider: 'woovi', gatewaySubscriptionId: 'old-sub', pixCode: 'old-qr' }];
  const f = adminFixture(rows, { valueCents: 7990, subStatus: 'ACTIVE', pixRecStatus: 'APPROVED' });
  await f.svc.cancelPendingChargesForOtherPlan(208, 'Família');
  assert.equal(f.events.length, 0);
  assert.equal(rows[0].status, 'pendente');
});

test('Admin troca o plano: falha ao cancelar na Woovi mantém o registro pendente', async () => {
  const rows = [{ id: 279, plan: 'Individual', value: 79.9, status: 'pendente', gatewayProvider: 'woovi', gatewaySubscriptionId: 'old-sub', pixCode: 'old-qr' }];
  const f = adminFixture(rows, { valueCents: 7990, subStatus: 'ACTIVE', pixRecStatus: 'CREATED' }, false);
  await f.svc.cancelPendingChargesForOtherPlan(208, 'Família');
  assert.equal(rows[0].status, 'pendente');
  assert.ok(!f.events.some((e) => e[0] === 'update'));
});

function alarmFixture() {
  const alerts = [];
  const svc = new BillingService();
  svc.configRepo = { findOne: async () => ({ ...cfg }) };
  svc.notificationsService = { notifyError: async (p) => alerts.push(p) };
  return { svc, alerts };
}

test('Alarme: pagamento de plano diferente da conta avisa o grupo de erros', async () => {
  const f = alarmFixture();
  await f.svc.warnIfChargeDiffersFromPlan({ id: 279, plan: 'Individual', value: 79.9 }, { id: 208, plan: 'Família' }, true);
  assert.equal(f.alerts.length, 1);
  assert.match(f.alerts[0].detail, /pago Individual R\$ 79,90, conta no plano Família \(R\$ 129,90\)/);
});

test('Alarme: pagamento que bate com o plano não avisa', async () => {
  const f = alarmFixture();
  await f.svc.warnIfChargeDiffersFromPlan({ id: 280, plan: 'Família', value: 129.9 }, { id: 208, plan: 'Família' }, true);
  assert.equal(f.alerts.length, 0);
});

test('Alarme: renovação com preço antigo (reajuste de tabela) não avisa', async () => {
  const f = alarmFixture();
  await f.svc.warnIfChargeDiffersFromPlan({ id: 281, plan: 'Família', value: 119.9 }, { id: 90, plan: 'Família' }, false);
  assert.equal(f.alerts.length, 0);
});
