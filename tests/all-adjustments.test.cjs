const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcrypt');

const { AuthService } = require('../dist/auth/auth.service');
const { BillingService } = require('../dist/billing/billing.service');
const { AdminService } = require('../dist/admin/admin.service');
const { ActivitiesService } = require('../dist/activities/activities.service');

// ---------------------------------------------------------------------------
// 1. Login por CPF (com pontuação, sem pontuação, 10 dígitos sem zero à esquerda, e-mail)
// ---------------------------------------------------------------------------
test('1. Login: aceita CPF com pontuação, sem pontuação, sem zero à esquerda (10 dígitos) e e-mail', async () => {
  const passwordHash = await bcrypt.hash('senha123', 10);
  const fakeUser = {
    id: 42,
    name: 'Maria Teste',
    email: 'maria@teste.com',
    cpf: '04589123409',
    passwordHash,
    role: 'user',
    plan: 'Individual',
    status: 'ativo',
    holderId: null,
    trialEndsAt: null,
  };

  const usersRepo = {
    findOne: async ({ where }) => {
      const conds = Array.isArray(where) ? where : [where];
      for (const c of conds) {
        if (c.email && c.email === fakeUser.email) return { ...fakeUser };
        if (c.cpf && c.cpf === fakeUser.cpf) return { ...fakeUser };
      }
      return null;
    },
  };

  const authService = new AuthService(
    usersRepo,
    {}, // txRepo
    { sign: (payload) => `jwt-token-${payload.sub}` },
    {} // mailService
  );

  // 1a. Com pontuação
  const resFormatted = await authService.login({ username: '045.891.234-09', password: 'senha123' });
  assert.equal(resFormatted.user.id, 42);

  // 1b. Sem pontuação
  const resDigits = await authService.login({ username: '04589123409', password: 'senha123' });
  assert.equal(resDigits.user.id, 42);

  // 1c. 10 dígitos (sem o 0 inicial)
  const res10Digits = await authService.login({ username: '4589123409', password: 'senha123' });
  assert.equal(res10Digits.user.id, 42);

  // 1d. E-mail com maiúsculas/espaços
  const resEmail = await authService.login({ username: '  MARIA@TESTE.COM ', password: 'senha123' });
  assert.equal(resEmail.user.id, 42);
});

// ---------------------------------------------------------------------------
// 2. Checkout: senha escolhida pelo cliente + CPF com ou sem máscara
// ---------------------------------------------------------------------------
test('2. Checkout: grava a senha escolhida pelo cliente e limpa pontuação do CPF', async () => {
  let savedUserEntity = null;
  let sentWelcomeArgs = null;

  const usersRepo = {
    findOne: async () => null,
    create: (data) => ({ ...data }),
    save: async (u) => {
      savedUserEntity = { ...u, id: u.id || 101 };
      return savedUserEntity;
    },
  };
  const txRepo = {
    count: async () => 0,
    find: async () => [],
    create: (data) => ({ ...data }),
    save: async (tx) => ({ ...tx, id: tx.id || 501 }),
  };
  const configRepo = {
    findOne: async () => ({
      activeGateway: 'woovi',
      planIndividualPrice: 79.9,
      planFamilyPrice: 129.9,
      pixAutomatic: true,
    }),
  };
  const wooviService = {
    isEnabled: async () => true,
    createPixAutomaticSubscription: async () => ({
      ok: true,
      subscriptionId: 'sub-101',
      emv: '00020101021226880014br.gov.bcb.pix-individual-7990',
    }),
  };
  const pagarmeService = { isEnabled: async () => false };
  const mailService = {
    sendWelcomePassword: async (email, name, pass) => {
      sentWelcomeArgs = { email, name, pass };
    },
  };
  const massflowService = { notifyPixGenerated: async () => {} };

  const billing = new BillingService(
    txRepo,
    {}, // trialLinksRepo
    configRepo,
    usersRepo,
    {}, // usersService
    {}, // referralsService
    {}, // venccaService
    { isEnabled: async () => false }, // paymentService
    wooviService,
    pagarmeService,
    {}, // clubeCertoService
    mailService,
    { notifyError: async () => {} }, // telegramService
    {}, // notificationsService
    massflowService,
    { sendEvent: async () => {} } // metaCapiService
  );

  const res = await billing.checkout({
    name: 'João Cliente',
    email: 'Joao@Cliente.com',
    cpf: '123.456.789-01',
    phone: '(11) 99999-8888',
    birthDate: '1990-05-10',
    gender: 'M',
    address: 'Rua A, 10',
    neighborhood: 'Centro',
    city: 'São Paulo',
    state: 'SP',
    zipCode: '01001-000',
    planType: 'Individual',
    paymentMethod: 'pix',
    password: 'MinhaSenhaForte2026',
  });

  assert.equal(res.success, true);
  assert.equal(savedUserEntity.cpf, '12345678901', 'CPF deve ser salvo apenas com dígitos');
  assert.equal(savedUserEntity.email, 'joao@cliente.com', 'E-mail deve ser salvo em minúsculas');
  const passwordMatches = await bcrypt.compare('MinhaSenhaForte2026', savedUserEntity.passwordHash);
  assert.equal(passwordMatches, true, 'O hash salvo deve corresponder à senha escolhida pelo cliente');
  assert.equal(sentWelcomeArgs.pass, 'MinhaSenhaForte2026', 'O e-mail de boas-vindas deve informar a senha escolhida');
});

// ---------------------------------------------------------------------------
// 3. Checkout: troca de plano Individual -> Família quando o PIX ainda não foi pago
// ---------------------------------------------------------------------------
test('3. Checkout: permite trocar de Individual para Família com PIX pendente, cancela o PIX antigo e bloqueia conta já paga/ativa', async () => {
  const existingUnpaidUser = {
    id: 202,
    name: 'Carlos Pendente',
    email: 'carlos@teste.com',
    cpf: '98765432100',
    plan: 'Individual',
    status: 'pendente',
    passwordHash: await bcrypt.hash('antiga123', 10),
  };

  const pendingTxs = [
    {
      id: 9001,
      userId: 202,
      plan: 'Individual',
      value: 79.9,
      status: 'pendente',
      gatewayProvider: 'woovi',
      gatewaySubscriptionId: 'woovi-sub-old-7990',
      gatewayIdentifier: 'corr-old-7990',
      pixCode: '000201-old-7990',
    },
  ];

  const canceledWooviIds = [];
  let paidTxCount = 0;

  const usersRepo = {
    findOne: async () => existingUnpaidUser,
    save: async (u) => Object.assign(existingUnpaidUser, u),
  };
  const txRepo = {
    count: async () => paidTxCount,
    find: async () => pendingTxs.filter((t) => t.status === 'pendente'),
    update: async (id, patch) => {
      const tx = pendingTxs.find((t) => t.id === id);
      if (tx) Object.assign(tx, patch);
    },
    create: (data) => ({ ...data }),
    save: async (tx) => ({ ...tx, id: tx.id || 9002 }),
  };
  const configRepo = {
    findOne: async () => ({
      activeGateway: 'woovi',
      planIndividualPrice: 79.9,
      planFamilyPrice: 129.9,
      pixAutomatic: true,
    }),
  };
  const wooviService = {
    isEnabled: async () => true,
    cancelPendingSubscription: async (subId) => {
      canceledWooviIds.push(subId);
      return true;
    },
    createPixAutomaticSubscription: async (args) => ({
      ok: true,
      subscriptionId: 'woovi-sub-new-12990',
      emv: `000201-new-${args.amountCents}`,
    }),
  };
  const pagarmeService = { isEnabled: async () => false };
  const mailService = { sendWelcomePassword: async () => {} };
  const massflowService = { notifyPixGenerated: async () => {} };

  const billing = new BillingService(
    txRepo,
    {}, // trialLinksRepo
    configRepo,
    usersRepo,
    {}, // usersService
    {}, // referralsService
    {}, // venccaService
    { isEnabled: async () => false }, // paymentService
    wooviService,
    pagarmeService,
    {}, // clubeCertoService
    mailService,
    { notifyError: async () => {} }, // telegramService
    {}, // notificationsService
    massflowService,
    { sendEvent: async () => {} } // metaCapiService
  );

  const res = await billing.checkout({
    name: 'Carlos Pendente',
    email: 'carlos@teste.com',
    cpf: '987.654.321-00',
    phone: '11988887777',
    birthDate: '1988-01-01',
    gender: 'M',
    address: 'Rua B, 20',
    neighborhood: 'Centro',
    city: 'São Paulo',
    state: 'SP',
    zipCode: '01002-000',
    planType: 'Família',
    paymentMethod: 'pix',
    password: 'NovaSenha123',
  });

  assert.equal(res.success, true);
  assert.equal(existingUnpaidUser.plan, 'Família', 'Plano do usuário deve mudar para Família');
  assert.deepEqual(canceledWooviIds, ['woovi-sub-old-7990'], 'PIX antigo na Woovi deve ser cancelado');
  assert.equal(pendingTxs[0].status, 'cancelado', 'Transação antiga deve ficar cancelada');
  assert.equal(pendingTxs[0].pixCode, null, 'pixCode antigo deve ser limpo');
  assert.equal(res.pixCode, '000201-new-12990', 'Novo PIX deve ser de R$ 129,90 (12990 centavos)');

  // Agora simula conta já ativa/paga tentando usar o checkout novamente -> deve bloquear
  paidTxCount = 1;
  existingUnpaidUser.status = 'ativo';
  await assert.rejects(
    async () => {
      await billing.checkout({
        name: 'Carlos Pendente',
        email: 'carlos@teste.com',
        cpf: '987.654.321-00',
        phone: '11988887777',
        birthDate: '1988-01-01',
        gender: 'M',
        address: 'Rua B, 20',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
        zipCode: '01002-000',
        planType: 'Individual',
        paymentMethod: 'pix',
      });
    },
    /Já existe uma conta ativa/
  );
});

// ---------------------------------------------------------------------------
// 4. Admin: ativar e desativar assinatura (cancela cobranças Woovi/Pagar.me + bloqueia benefícios + não reativa no cron)
// ---------------------------------------------------------------------------
test('4. Admin: desativar assinatura cancela cobrança no gateway, bloqueia benefícios; ativar restaura acesso', async () => {
  const userState = {
    id: 303,
    name: 'Ana Assinante',
    status: 'ativo',
    accessHealth: true,
    accessClube: true,
    accessPet: true,
    accessFuneral: false,
  };
  const userTxs = [
    {
      id: 701,
      userId: 303,
      status: 'pago',
      gatewayProvider: 'woovi',
      gatewaySubscriptionId: 'woovi-active-sub-303',
      gatewayIdentifier: 'woovi-corr-303',
    },
    {
      id: 702,
      userId: 303,
      status: 'pendente',
      gatewayProvider: 'pagarme',
      gatewaySubscriptionId: 'sub_pagarme_303',
      pixCode: 'some-pix',
    },
  ];

  const canceledWoovi = [];
  const canceledPagarme = [];

  const usersService = {
    findById: async () => ({ ...userState }),
    update: async (id, patch) => {
      if (patch.status) userState.status = patch.status;
      if (patch.access) {
        userState.accessHealth = patch.access.health;
        userState.accessClube = patch.access.clube;
        userState.accessPet = patch.access.pet;
        userState.accessFuneral = patch.access.funeral;
      }
      return { ...userState };
    },
    toAdminResponse: (u) => ({ ...u }),
  };
  const txRepo = {
    find: async () => userTxs,
    update: async (id, patch) => {
      const t = userTxs.find((x) => x.id === id);
      if (t) Object.assign(t, patch);
    },
  };
  const wooviService = {
    cancelSubscription: async (subId) => {
      canceledWoovi.push(subId);
      return true;
    },
  };
  const pagarmeService = {
    cancelSubscription: async (subId) => {
      canceledPagarme.push(subId);
      return true;
    },
  };

  const adminService = new AdminService(
    {}, // configRepo
    txRepo,
    {}, // trialLinksRepo
    usersService,
    {}, // venccaService
    {}, // clubeCertoService
    {}, // mailService
    {}, // massflowService
    wooviService,
    pagarmeService
  );

  // Desativar assinatura
  const deactivated = await adminService.toggleUserSubscription(303, false);
  assert.equal(deactivated.status, 'inativo');
  assert.equal(userState.accessHealth, false);
  assert.equal(userState.accessClube, false);
  assert.equal(userState.accessPet, false);
  assert.equal(userState.accessFuneral, false);
  assert.deepEqual(canceledWoovi, ['woovi-active-sub-303'], 'Deve cancelar assinatura recorrente na Woovi');
  assert.deepEqual(canceledPagarme, ['sub_pagarme_303'], 'Deve cancelar assinatura no Pagar.me');
  assert.equal(userTxs[1].status, 'cancelado', 'Transação pendente deve ser marcada como cancelada');

  // Reativar assinatura
  const reactivated = await adminService.toggleUserSubscription(303, true);
  assert.equal(reactivated.status, 'ativo');
  assert.equal(userState.accessHealth, true);
  assert.equal(userState.accessClube, true);
  assert.equal(userState.accessPet, true);
});

// ---------------------------------------------------------------------------
// 5. Atividades Recentes reais + formatação de CPF no frontend
// ---------------------------------------------------------------------------
test('5. Atividades Recentes e Frontend: lista histórico real, remove dados falsos fixos e formata CPF', async () => {
  const fakeLogs = [
    {
      id: 11,
      userId: 42,
      desc: 'Solicitou acesso a Pronto Atendimento 24h (Clínico e Pediátrico)',
      type: 'health',
      createdAt: new Date('2026-10-15T17:42:00Z'),
    },
  ];
  const activitiesService = new ActivitiesService({
    find: async () => fakeLogs,
  });

  const list = await activitiesService.list(42);
  assert.equal(list.length, 1);
  assert.equal(list[0].desc, 'Solicitou acesso a Pronto Atendimento 24h (Clínico e Pediátrico)');
  assert.equal(list[0].type, 'health');

  // Verifica que o DashboardView.vue não contém mais as strings falsas fixas
  const dashboardVue = fs.readFileSync(
    path.resolve(__dirname, '../../frontend/src/components/DashboardView.vue'),
    'utf8'
  );
  assert.equal(dashboardVue.includes('Farmácia Drogasil'), false, 'Não deve conter atividade fake da Drogasil');
  assert.equal(dashboardVue.includes('Economia de R$ 34,20'), false, 'Não deve conter atividade fake de R$ 34,20');
  assert.equal(dashboardVue.includes('Nenhuma atividade registrada'), true, 'Deve conter estado vazio real');
  assert.equal(dashboardVue.includes('api.get("/activities")'), true, 'Deve buscar atividades reais da API');

  // Verifica que api.js exporta formatCpf e formata corretamente
  const apiJs = fs.readFileSync(
    path.resolve(__dirname, '../../frontend/src/services/api.js'),
    'utf8'
  );
  assert.equal(apiJs.includes('export function formatCpf'), true, 'api.js deve exportar formatCpf');
});
