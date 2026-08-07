import 'reflect-metadata';
import * as bcrypt from 'bcrypt';
import { AppDataSource } from './data-source';
import { User } from '../users/entities/user.entity';
import { ReferralLink } from '../referrals/entities/referral-link.entity';
import { Transaction } from '../billing/entities/transaction.entity';
import { Activity } from '../activities/entities/activity.entity';
import { AppConfig } from '../admin/entities/config.entity';

const SEED_PASSWORD = 'senha123';

async function run() {
  await AppDataSource.initialize();

  const configRepo = AppDataSource.getRepository(AppConfig);
  const usersRepo = AppDataSource.getRepository(User);
  const linksRepo = AppDataSource.getRepository(ReferralLink);
  const txRepo = AppDataSource.getRepository(Transaction);
  const activitiesRepo = AppDataSource.getRepository(Activity);

  const existingConfig = await configRepo.findOne({ where: {} });
  if (!existingConfig) {
    await configRepo.save(
      configRepo.create({
        planBronzePrice: 39.9,
        planBronzeMmn: 10.0,
        planIndividualPrice: 79.9,
        planIndividualMmn: 20.0,
        planFamilyPrice: 129.9,
        planFamilyMmn: 50.0,
        planPremiumPrice: 199.9,
        planPremiumMmn: 60.0,
        percentages: [40, 20, 20, 10, 10],
        modules: {
          health: { label: 'Telemedicina', price: 10.0, icon: 'ph-first-aid' },
          clube: { label: 'Clube de Descontos', price: 5.0, icon: 'ph-tag' },
          pet: { label: 'Veterinário (Pet)', price: 15.0, icon: 'ph-dog' },
          funeral: { label: 'Auxílio Funerário', price: 8.0, icon: 'ph-skull' },
        },
      }),
    );
    console.log('Config default criada.');
  }

  const alreadySeeded = await usersRepo.findOne({ where: { email: 'joao.silva@email.com' } });
  if (alreadySeeded) {
    console.log('Usuários já existentes — pulando seed de usuários.');
    await AppDataSource.destroy();
    return;
  }

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  const joao = await usersRepo.save(
    usersRepo.create({
      name: 'João Silva',
      email: 'joao.silva@email.com',
      cpf: '123.456.789-00',
      phone: '(11) 99999-7777',
      passwordHash,
      plan: 'Viva Mais Premium',
      level: 'Sem Nível (Diretor)',
      role: 'admin',
      status: 'ativo',
      accessHealth: true,
      accessClube: true,
      accessPet: true,
      accessFuneral: true,
    }),
  );

  const carlos = await usersRepo.save(
    usersRepo.create({
      name: 'Carlos Silva',
      email: 'carlos@email.com',
      cpf: '111.111.111-11',
      passwordHash,
      plan: 'Individual',
      level: '1º Nível',
      referredById: joao.id,
      status: 'ativo',
    }),
  );

  const marina = await usersRepo.save(
    usersRepo.create({
      name: 'Marina Costa',
      email: 'marina@email.com',
      cpf: '222.222.222-22',
      passwordHash,
      plan: 'Individual',
      level: '1º Nível',
      referredById: joao.id,
      status: 'pendente',
    }),
  );

  await usersRepo.save(
    usersRepo.create({
      name: 'Ana Pereira',
      email: 'ana@email.com',
      cpf: '333.333.333-33',
      passwordHash,
      plan: 'Família',
      level: '2º Nível',
      referredById: carlos.id,
      status: 'ativo',
    }),
  );

  await usersRepo.save(
    usersRepo.create({
      name: 'Pedro Santos',
      email: 'pedro@email.com',
      cpf: '444.444.444-44',
      passwordHash,
      plan: 'Bronze',
      level: '2º Nível',
      referredById: marina.id,
      status: 'inativo',
    }),
  );

  await linksRepo.save([
    linksRepo.create({
      userId: joao.id,
      name: 'Checkout - Plano Bronze (Promocional)',
      planType: 'Bronze',
      desc: 'Link de checkout promocional',
      price: 'R$ 29,90/mês',
      payment: 'Cartão ou PIX',
      url: 'https://conta.vivamaisclub.com/plano-bronze?ref=joao-silva-123',
      cliques: 845,
      conversoes: 25,
      comissao: 2450.0,
      status: 'Ativo',
    }),
    linksRepo.create({
      userId: joao.id,
      name: 'Checkout - Plano Individual',
      planType: 'Individual',
      desc: 'Link de checkout padrão',
      price: 'R$ 79,90/mês',
      payment: 'Cartão ou PIX',
      url: 'https://conta.vivamaisclub.com/plano-individual?ref=joao-silva-123',
      cliques: 320,
      conversoes: 12,
      comissao: 1180.0,
      status: 'Ativo',
    }),
    linksRepo.create({
      userId: joao.id,
      name: 'Checkout - Plano Família',
      planType: 'Família',
      desc: 'Link de checkout familiar',
      price: 'R$ 129,90/mês',
      payment: 'Cartão ou PIX',
      url: 'https://conta.vivamaisclub.com/plano-familia?ref=joao-silva-123',
      cliques: 150,
      conversoes: 6,
      comissao: 900.0,
      status: 'Ativo',
    }),
  ]);

  await txRepo.save([
    txRepo.create({ userId: joao.id, plan: 'Família', value: 129.9, status: 'pago', paymentMethod: 'PIX', commissionMmn: 50.0 }),
    txRepo.create({ userId: joao.id, plan: 'Família', value: 129.9, status: 'pago', paymentMethod: 'Cartão de Crédito', commissionMmn: 50.0 }),
    txRepo.create({ userId: joao.id, plan: 'Família', value: 129.9, status: 'pago', paymentMethod: 'Cartão de Crédito', commissionMmn: 50.0 }),
  ]);

  await activitiesRepo.save([
    activitiesRepo.create({ userId: joao.id, desc: 'Consulta de Telemedicina com Clínico Geral', type: 'health' }),
    activitiesRepo.create({ userId: joao.id, desc: 'Cupom Droga Raia resgatado (35% OFF)', type: 'clube' }),
    activitiesRepo.create({ userId: joao.id, desc: 'Atendimento Veterinário Preventivo', type: 'pet' }),
  ]);

  console.log('Seed concluído.');
  console.log(`Login admin: joao.silva@email.com / ${SEED_PASSWORD}`);

  await AppDataSource.destroy();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
