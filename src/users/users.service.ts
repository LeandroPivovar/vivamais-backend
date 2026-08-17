import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { AppConfig, ModuleConfig } from '../admin/entities/config.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { basePriceForPlan, mmnForPlan } from '../common/pricing';

const MODULE_PRICE_KEYS: Array<keyof AppConfig['modules']> = ['health', 'clube', 'pet', 'funeral'];
const LEVEL_LABELS = ['1º Nível', '2º Nível', '3º Nível', '4º Nível', '5º Nível'];

function formatDate(date: Date): string {
  return date.toLocaleDateString('pt-BR');
}

function saoPauloTodayWindow(date = new Date()): { start: Date; endInclusive: Date } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const getPart = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const year = getPart('year');
  const month = getPart('month');
  const day = getPart('day');

  const start = new Date(Date.UTC(year, month - 1, day, 3, 0, 0, 0));
  const endInclusive = new Date(start);
  endInclusive.setUTCDate(endInclusive.getUTCDate() + 1);
  endInclusive.setUTCMilliseconds(endInclusive.getUTCMilliseconds() - 1);

  return { start, endInclusive };
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(AppConfig) private configRepo: Repository<AppConfig>,
  ) {}

  private async getConfig(): Promise<AppConfig> {
    const config = await this.configRepo.findOne({ where: {} });
    if (!config) throw new NotFoundException('Configuração do sistema não encontrada.');
    return config;
  }

  toProfileResponse(user: User) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      cpf: user.cpf,
      phone: user.phone,
      plan: user.plan,
      active: user.status === 'ativo',
      role: user.role,
      isDependent: user.holderId != null,
      memberSince: formatDate(user.createdAt),
      address: user.address,
      neighborhood: user.neighborhood,
      complement: user.complement,
      city: user.city,
      state: user.state,
      zipCode: user.zipCode,
    };
  }

  toAdminResponse(user: User) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      cpf: user.cpf,
      plan: user.plan,
      level: user.level,
      referredBy: user.referredBy?.name ?? 'Nenhum',
      access: {
        health: user.accessHealth,
        clube: user.accessClube,
        pet: user.accessPet,
        funeral: user.accessFuneral,
      },
      status: user.status,
      date: formatDate(user.createdAt),
      phone: user.phone,
      birthDate: user.birthDate,
      gender: user.gender,
      address: user.address,
      neighborhood: user.neighborhood,
      complement: user.complement,
      city: user.city,
      state: user.state,
      zipCode: user.zipCode,
    };
  }

  async findById(id: number): Promise<User> {
    const user = await this.usersRepo.findOne({ where: { id }, relations: ['referredBy'] });
    if (!user) throw new NotFoundException('Usuário não encontrado.');
    return user;
  }

  async updateProfile(id: number, dto: UpdateProfileDto): Promise<User> {
    const user = await this.findById(id);
    Object.assign(user, dto);
    return this.usersRepo.save(user);
  }

  /** Marca que o associado já foi cadastrado com sucesso na telemedicina (Vencca). */
  async markTelemedRegistered(id: number): Promise<void> {
    await this.usersRepo.update(id, { telemedRegistered: true });
  }

  /** Incrementa o contador de tentativas de cadastro na telemedicina. */
  async incrementTelemedAttempts(id: number): Promise<void> {
    await this.usersRepo.increment({ id }, 'telemedAttempts', 1);
  }

  /**
   * Contadores de assinaturas (titulares) para o painel.
   * Totais (active/pending/canceled) + o recorte do DIA (today*).
   */
  async subscriptionStats(): Promise<{
    active: number;
    pending: number;
    canceled: number;
    today: number;
    todayActive: number;
    todayPending: number;
    todayCanceled: number;
  }> {
    const { start, endInclusive } = saoPauloTodayWindow();
    const base = { holderId: IsNull() }; // só titulares (dependentes não são assinaturas)
    const todayBase = { ...base, createdAt: Between(start, endInclusive) };
    const [active, pending, canceled, today, todayActive, todayPending, todayCanceled] = await Promise.all([
      this.usersRepo.count({ where: { ...base, status: 'ativo' } }),
      this.usersRepo.count({ where: { ...base, status: 'pendente' } }),
      this.usersRepo.count({ where: { ...base, status: 'inativo' } }),
      this.usersRepo.count({ where: todayBase }),
      this.usersRepo.count({ where: { ...todayBase, status: 'ativo' } }),
      this.usersRepo.count({ where: { ...todayBase, status: 'pendente' } }),
      this.usersRepo.count({ where: { ...todayBase, status: 'inativo' } }),
    ]);
    return { active, pending, canceled, today, todayActive, todayPending, todayCanceled };
  }

  /** Define a senha diretamente (uso administrativo — sem checar senha atual). */
  async setPassword(id: number, plainPassword: string): Promise<void> {
    const user = await this.findById(id);
    user.passwordHash = await bcrypt.hash(plainPassword, 10);
    await this.usersRepo.save(user);
  }

  async changePassword(id: number, dto: ChangePasswordDto): Promise<void> {
    const user = await this.findById(id);
    const ok = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!ok) throw new ConflictException('Senha atual incorreta.');
    user.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.usersRepo.save(user);
  }

  async listAll(): Promise<User[]> {
    return this.usersRepo.find({ relations: ['referredBy'], order: { createdAt: 'ASC' } });
  }

  async findByName(name: string): Promise<User | null> {
    return this.usersRepo.findOne({ where: { name } });
  }

  /** Preço base do plano (por plano, configurável no Admin) + módulos ativados. */
  calculatePrice(
    access: { health: boolean; clube: boolean; pet: boolean; funeral: boolean },
    plan: string,
    config: AppConfig,
  ): number {
    const base = basePriceForPlan(plan, config);
    const modulesTotal = MODULE_PRICE_KEYS.reduce((sum, key) => {
      const enabled = access?.[key];
      return enabled ? sum + Number(config.modules[key].price) : sum;
    }, 0);
    return base + modulesTotal;
  }

  private mmnValueForPlan(plan: string, config: AppConfig): number {
    return mmnForPlan(plan, config);
  }

  async create(dto: CreateUserDto): Promise<User> {
    const existing = await this.usersRepo.findOne({
      where: [{ email: dto.email }, { cpf: dto.cpf }],
    });
    if (existing) throw new ConflictException('E-mail ou CPF já cadastrado.');

    let referredById: number | null = null;
    if (dto.referredBy && dto.referredBy !== 'Nenhum') {
      const referrer = await this.findByName(dto.referredBy);
      referredById = referrer?.id ?? null;
    }

    const user = this.usersRepo.create({
      name: dto.name,
      email: dto.email,
      cpf: dto.cpf,
      phone: dto.phone ?? null,
      birthDate: dto.birthDate,
      gender: dto.gender as User['gender'],
      address: dto.address,
      neighborhood: dto.neighborhood,
      complement: dto.complement ?? null,
      city: dto.city,
      state: dto.state,
      zipCode: dto.zipCode,
      passwordHash: await bcrypt.hash(dto.password || Math.random().toString(36).slice(2), 10),
      plan: dto.plan as User['plan'],
      level: dto.level as User['level'],
      referredById,
      accessHealth: dto.access.health,
      accessClube: dto.access.clube,
      accessPet: dto.access.pet,
      accessFuneral: dto.access.funeral,
      status: dto.status as User['status'],
    });
    return this.usersRepo.save(user);
  }

  async update(id: number, dto: UpdateUserDto): Promise<User> {
    const user = await this.findById(id);
    if (dto.referredBy !== undefined) {
      const referrer = dto.referredBy === 'Nenhum' ? null : await this.findByName(dto.referredBy);
      user.referredById = referrer?.id ?? null;
    }
    if (dto.access) {
      user.accessHealth = dto.access.health;
      user.accessClube = dto.access.clube;
      user.accessPet = dto.access.pet;
      user.accessFuneral = dto.access.funeral;
    }
    if (dto.name !== undefined) user.name = dto.name;
    if (dto.email !== undefined) user.email = dto.email;
    if (dto.cpf !== undefined) user.cpf = dto.cpf;
    if (dto.plan !== undefined) user.plan = dto.plan as User['plan'];
    if (dto.level !== undefined) user.level = dto.level as User['level'];
    if (dto.status !== undefined) user.status = dto.status as User['status'];
    if (dto.phone !== undefined) user.phone = dto.phone;
    if (dto.birthDate !== undefined) user.birthDate = dto.birthDate;
    if (dto.gender !== undefined) user.gender = dto.gender as User['gender'];
    if (dto.address !== undefined) user.address = dto.address;
    if (dto.neighborhood !== undefined) user.neighborhood = dto.neighborhood;
    if (dto.complement !== undefined) user.complement = dto.complement;
    if (dto.city !== undefined) user.city = dto.city;
    if (dto.state !== undefined) user.state = dto.state;
    if (dto.zipCode !== undefined) user.zipCode = dto.zipCode;
    return this.usersRepo.save(user);
  }

  async remove(id: number): Promise<void> {
    const user = await this.findById(id);
    await this.usersRepo.remove(user);
  }

  /** Árvore de indicados até 5 níveis abaixo do usuário (getReferralTree do front). */
  async getReferralTree(userId: number, depth = 1, maxDepth = 5): Promise<any> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) return null;
    const children =
      depth >= maxDepth
        ? []
        : await this.usersRepo.find({ where: { referredById: userId } });

    return {
      name: user.name,
      plan: user.plan,
      level: LEVEL_LABELS[depth - 1] ?? user.level,
      status: user.status,
      depth,
      children: await Promise.all(
        children.map((child) => this.getReferralTree(child.id, depth + 1, maxDepth)),
      ),
    };
  }

  /** Lista achatada dos indicados (até 5 níveis) com email/status/data/ganho reais — usada em GET /referrals. */
  async getReferralListFlat(userId: number): Promise<
    Array<{ name: string; email: string; phone: string; plan: string; level: string; status: string; date: string; gain: string; referredBy: string }>
  > {
    const config = await this.getConfig();
    const rows: Array<{ name: string; email: string; phone: string; plan: string; level: string; status: string; date: string; gain: string; referredBy: string }> = [];
    const root = await this.usersRepo.findOne({ where: { id: userId } });

    const walk = async (parentId: number, parentName: string, level: number): Promise<void> => {
      if (level > 5) return;
      // Mostra TODOS os indicados (inclui pendentes). O ganho, porém, só é contado
      // para quem pagou (status 'ativo'); pendente aparece na lista com ganho '-'.
      const children = await this.usersRepo.find({ where: { referredById: parentId } });
      for (const child of children) {
        const mmn = this.mmnValueForPlan(child.plan, config);
        const pct = config.percentages[level - 1] ?? 0;
        const gain = child.status === 'ativo' ? (mmn * pct) / 100 : 0;
        rows.push({
          name: child.name,
          email: child.email,
          phone: child.phone ?? '',
          plan: child.plan,
          level: LEVEL_LABELS[level - 1] ?? child.level,
          status: child.status,
          date: formatDate(child.createdAt),
          gain: gain > 0 ? `R$ ${gain.toFixed(2).replace('.', ',')}` : '-',
          referredBy: parentName,
        });
        await walk(child.id, child.name, level + 1);
      }
    };

    await walk(userId, root?.name ?? 'Você', 1);
    return rows;
  }

  /** Soma a comissão que o usuário recebe da sua rede (5 níveis), a partir do MMN de cada indicado. */
  async calculateUserCommission(userId: number): Promise<number> {
    const config = await this.getConfig();
    let total = 0;

    const walk = async (parentId: number, level: number): Promise<void> => {
      if (level > 5) return;
      // Só conta indicados que pagaram (status 'ativo') — comissão não conta na
      // criação da conta, só quando o pagamento é confirmado.
      const children = await this.usersRepo.find({ where: { referredById: parentId, status: 'ativo' } });
      for (const child of children) {
        const mmn = this.mmnValueForPlan(child.plan, config);
        const pct = config.percentages[level - 1] ?? 0;
        total += (mmn * pct) / 100;
        await walk(child.id, level + 1);
      }
    };

    await walk(userId, 1);
    return Math.round(total * 100) / 100;
  }

  /** Sobe a cadeia de indicação a partir de um usuário, calculando quem recebe comissão em cada nível. */
  async getCommissionReceivers(userId: number): Promise<Array<{ level: number; name: string; gain: number }>> {
    const config = await this.getConfig();
    const user = await this.findById(userId);
    const mmn = this.mmnValueForPlan(user.plan, config);

    const receivers: Array<{ level: number; name: string; gain: number }> = [];
    let currentId = user.referredById;
    let level = 1;
    while (currentId && level <= 5) {
      const parent = await this.usersRepo.findOne({ where: { id: currentId } });
      if (!parent) break;
      const pct = config.percentages[level - 1] ?? 0;
      receivers.push({ level, name: parent.name, gain: Math.round(((mmn * pct) / 100) * 100) / 100 });
      currentId = parent.referredById;
      level += 1;
    }
    return receivers;
  }
}
