// Notificações nativas do app (Firebase): Pagamento Aprovado, Renovação Confirmada,
// Renovação Pendente e Comissão Confirmada. Roda contra o build: `npm test`.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { generateKeyPairSync } = require('node:crypto');
const { writeFileSync, mkdtempSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { BillingService } = require('../dist/billing/billing.service');
const { PushService } = require('../dist/push/push.service');

const quiet = { log() {}, warn() {}, error() {} };

function billingFixture(user, referrer = null) {
  const pushes = [];
  const svc = new BillingService();
  svc.logger = quiet;
  svc.pushService = { sendToUser: async (userId, msg) => { pushes.push({ userId, ...msg }); return 1; } };
  svc.usersService = { findById: async () => user };
  svc.usersRepo = { save: async (x) => x, findOne: async () => referrer };
  svc.txRepo = { save: async (x) => x };
  svc.configRepo = { findOne: async () => ({ planIndividualPrice: 79.9, planFamilyPrice: 129.9 }) };
  svc.mailService = new Proxy({}, { get: () => async () => {} });
  svc.notificationsService = new Proxy({}, { get: () => async () => {} });
  svc.massflowService = new Proxy({}, { get: () => async () => true });
  svc.metaCapiService = new Proxy({}, { get: () => async () => {} });
  svc.telegramService = new Proxy({}, { get: () => async () => {} });
  svc.venccaService = { registerAssociates: async () => true, mapUserToCliente: () => ({}) };
  svc.clubeCertoService = { registerAssociate: async () => {} };
  svc.referralsService = { registerConversion: async () => ({ bonus: 30, commission: 20 }) };
  svc.ensurePaidAccess = async () => false;
  svc.referrerName = async () => null;
  return { svc, pushes };
}

const familia = () => ({ id: 226, name: 'Leandra ap de lima', email: 'l@example.invalid', plan: 'Família', status: 'ativo', accessHealth: true, accessClube: true, accessPet: true, telemedRegistered: true });

test('Renovação paga → "Renovação Confirmada" para o titular, abrindo o financeiro', async () => {
  const f = billingFixture(familia());
  await f.svc.notifyRenewalPaid({ id: 1, userId: 226, plan: 'Família', value: 129.9, paymentMethod: 'Pix Automático' });
  assert.equal(f.pushes.length, 1);
  assert.equal(f.pushes[0].title, 'Renovação Confirmada');
  assert.equal(f.pushes[0].userId, 226);
  assert.equal(f.pushes[0].tab, 'financeiro');
  assert.match(f.pushes[0].body, /R\$ 129,90/);
});

test('Cartão recusado com a assinatura já paga → "Renovação Pendente"', async () => {
  const f = billingFixture(familia());
  await f.svc.applyPagarmeStatus({ id: 2, userId: 226, plan: 'Família', value: 129.9, status: 'pago' }, 'failed');
  assert.deepEqual(f.pushes.map((p) => p.title), ['Renovação Pendente']);
});

test('1ª cobrança recusada (ainda pendente) não manda "Renovação Pendente"', async () => {
  const f = billingFixture({ ...familia(), status: 'pendente' });
  await f.svc.applyPagarmeStatus({ id: 3, userId: 226, plan: 'Família', value: 129.9, status: 'pendente' }, 'failed');
  assert.equal(f.pushes.length, 0);
});

test('1º pagamento com indicação → "Pagamento Aprovado" ao cliente e "Comissão Confirmada" ao indicador', async () => {
  const user = { ...familia(), status: 'pendente', referralBonusPaid: false, trialEndsAt: null };
  const f = billingFixture(user, { id: 45, name: 'Indicador', email: 'i@example.invalid' });
  await f.svc.confirmPaid({ id: 4, userId: 226, plan: 'Família', value: 129.9, referralBonus: 0 }, { id: 9, userId: 45 }, user);
  const byTitle = Object.fromEntries(f.pushes.map((p) => [p.title, p]));
  assert.equal(byTitle['Pagamento Aprovado'].userId, 226);
  assert.equal(byTitle['Comissão Confirmada'].userId, 45);
  assert.equal(byTitle['Comissão Confirmada'].tab, 'indicacoes');
  assert.match(byTitle['Comissão Confirmada'].body, /Leandra.*R\$ 50,00/);
});

test('Sem o serviço de push (testes antigos / desligado) o pagamento segue normal', async () => {
  const f = billingFixture(familia());
  f.svc.pushService = undefined;
  await f.svc.notifyRenewalPaid({ id: 5, userId: 226, plan: 'Família', value: 129.9 });
});

test('PushService: sem credencial não envia nada', async () => {
  const prev = process.env.FCM_SERVICE_ACCOUNT_FILE;
  delete process.env.FCM_SERVICE_ACCOUNT_FILE;
  const svc = new PushService({ find: async () => [{ id: 1, token: 't' }] });
  svc.logger = quiet;
  assert.equal(await svc.sendToUser(1, { title: 'x', body: 'y' }), 0);
  if (prev) process.env.FCM_SERVICE_ACCOUNT_FILE = prev;
});

test('PushService: envia pelo FCM v1 e remove celular desinstalado', async (t) => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const dir = mkdtempSync(join(tmpdir(), 'fcm-'));
  const file = join(dir, 'sa.json');
  writeFileSync(file, JSON.stringify({ project_id: 'viva-teste', client_email: 'sa@viva-teste.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
  const prev = process.env.FCM_SERVICE_ACCOUNT_FILE;
  process.env.FCM_SERVICE_ACCOUNT_FILE = file;
  const original = global.fetch;
  t.after(() => { global.fetch = original; if (prev) process.env.FCM_SERVICE_ACCOUNT_FILE = prev; else delete process.env.FCM_SERVICE_ACCOUNT_FILE; });
  const sent = [];
  global.fetch = async (url, init) => {
    if (url.includes('oauth2')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
    const body = JSON.parse(init.body);
    sent.push({ url, body });
    if (body.message.token === 'velho') return { ok: false, status: 404, text: async () => '{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}' };
    return { ok: true, text: async () => '{}' };
  };
  const deleted = [];
  const svc = new PushService({ find: async () => [{ id: 1, token: 'novo' }, { id: 2, token: 'velho' }], delete: async (w) => deleted.push(w) });
  svc.logger = quiet;
  const n = await svc.sendToUser(226, { title: 'Renovação Confirmada', body: 'ok', tab: 'financeiro' });
  assert.equal(n, 1);
  assert.match(sent[0].url, /projects\/viva-teste\/messages:send$/);
  assert.equal(sent[0].body.message.notification.title, 'Renovação Confirmada');
  assert.equal(sent[0].body.message.data.tab, 'financeiro');
  assert.deepEqual(deleted, [{ id: 2 }]);
});

test('PushService.broadcast: envia para todos os celulares do app e guarda no histórico', async (t) => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const dir = mkdtempSync(join(tmpdir(), 'fcm-'));
  const file = join(dir, 'sa.json');
  writeFileSync(file, JSON.stringify({ project_id: 'viva-teste', client_email: 'sa@viva-teste.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
  const prev = process.env.FCM_SERVICE_ACCOUNT_FILE;
  process.env.FCM_SERVICE_ACCOUNT_FILE = file;
  const original = global.fetch;
  t.after(() => { global.fetch = original; if (prev) process.env.FCM_SERVICE_ACCOUNT_FILE = prev; else delete process.env.FCM_SERVICE_ACCOUNT_FILE; });
  const tokens = [];
  global.fetch = async (url, init) => {
    if (url.includes('oauth2')) return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3600 }) };
    const body = JSON.parse(init.body);
    tokens.push(body.message.token);
    if (body.message.token === 'kid-3') return { ok: false, status: 500, text: async () => 'erro' };
    return { ok: true, text: async () => '{}' };
  };
  let where = null;
  const devices = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, token: `kid-${i + 1}`, app: 'kids' }));
  const saved = [];
  const svc = new PushService(
    { find: async (opts) => { where = opts.where; return devices; } },
    { create: (x) => x, save: async (x) => { saved.push(x); return { id: 7, ...x }; } },
  );
  svc.logger = quiet;
  const r = await svc.broadcast('kids', 'Novidade no Kids', 'Jogo novo liberado!', 1);
  assert.deepEqual(where, { app: 'kids' });
  assert.equal(tokens.length, 25);
  assert.deepEqual(r, { id: 7, app: 'kids', total: 25, sent: 24 });
  assert.equal(saved[0].title, 'Novidade no Kids');
  assert.equal(saved[0].createdById, 1);
});

test('PushService.broadcast: sem credencial avisa o admin em vez de fingir que enviou', async () => {
  const prev = process.env.FCM_SERVICE_ACCOUNT_FILE;
  delete process.env.FCM_SERVICE_ACCOUNT_FILE;
  const svc = new PushService({ find: async () => [] });
  svc.logger = quiet;
  await assert.rejects(() => svc.broadcast('teens', 'Oi', 'Teste'), /desligadas/);
  if (prev) process.env.FCM_SERVICE_ACCOUNT_FILE = prev;
});
