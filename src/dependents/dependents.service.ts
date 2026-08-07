import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../users/entities/user.entity';
import { AppConfig } from '../admin/entities/config.entity';
import { MailService } from '../mail/mail.service';
import { CreateDependentDto } from './dto/create-dependent.dto';

/** Plano do titular -> coluna de limite no app_config. */
const DEPENDENT_LIMIT_FIELD: Record<string, keyof AppConfig> = {
  Bronze: 'planBronzeDependents',
  Individual: 'planIndividualDependents',
  Família: 'planFamilyDependents',
  'Viva Mais Premium': 'planPremiumDependents',
};

function onlyDigits(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '');
}

/** Senha aleatória legível (sem caracteres ambíguos). */
function randomPassword(length = 10): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

@Injectable()
export class DependentsService {
  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(AppConfig) private configRepo: Repository<AppConfig>,
    private mailService: MailService,
  ) {}

  /** Limite de dependentes do plano do titular. */
  private async limitFor(holder: User): Promise<number> {
    const field = DEPENDENT_LIMIT_FIELD[holder.plan];
    if (!field) return 0;
    const config = await this.configRepo.findOne({ where: {} });
    return config ? Number(config[field] ?? 0) : 0;
  }

  private toResponse(dep: User) {
    return {
      id: dep.id,
      name: dep.name,
      email: dep.email,
      cpf: dep.cpf,
      phone: dep.phone,
      createdAt: dep.createdAt,
    };
  }

  /** Dependentes do titular + limite/uso (para a tela do usuário). */
  async listMine(holderId: number) {
    const holder = await this.usersRepo.findOne({ where: { id: holderId } });
    if (!holder) throw new NotFoundException('Titular não encontrado.');
    const dependents = await this.usersRepo.find({
      where: { holderId },
      order: { createdAt: 'ASC' },
    });
    const limit = await this.limitFor(holder);
    return {
      limit,
      used: dependents.length,
      canAdd: dependents.length < limit,
      dependents: dependents.map((d) => this.toResponse(d)),
    };
  }

  async create(holderId: number, dto: CreateDependentDto) {
    const holder = await this.usersRepo.findOne({ where: { id: holderId } });
    if (!holder) throw new NotFoundException('Titular não encontrado.');

    // Dependente não cria dependente.
    if (holder.holderId) throw new ForbiddenException('Dependentes não podem cadastrar dependentes.');

    const limit = await this.limitFor(holder);
    const used = await this.usersRepo.count({ where: { holderId } });
    if (used >= limit) {
      throw new BadRequestException(
        limit === 0
          ? 'Seu plano não permite dependentes.'
          : `Você atingiu o limite de ${limit} dependente(s) do seu plano.`,
      );
    }

    const cpf = onlyDigits(dto.cpf);
    const existing = await this.usersRepo.findOne({ where: [{ email: dto.email }, { cpf }] });
    if (existing) throw new ConflictException('Já existe uma conta com esse e-mail ou CPF.');

    const password = randomPassword();
    const dependent = this.usersRepo.create({
      name: dto.name,
      email: dto.email,
      cpf,
      phone: dto.phone ?? null,
      birthDate: dto.birthDate ?? null,
      passwordHash: await bcrypt.hash(password, 10),
      plan: holder.plan, // herda o plano do titular, sem acesso a funcionalidades
      holderId,
      status: 'ativo',
      // Sem funcionalidades por enquanto: nenhum benefício ativo.
      accessHealth: false,
      accessClube: false,
      accessPet: false,
      accessFuneral: false,
    });
    const saved = await this.usersRepo.save(dependent);

    // Envia o convite (link do portal + senha aleatória) por e-mail. Best-effort.
    try {
      await this.mailService.sendWelcomePassword(saved.email, saved.name, password);
    } catch {
      // cadastro segue mesmo se o e-mail falhar; a senha pode ser reenviada depois
    }

    return this.toResponse(saved);
  }

  async remove(holderId: number, dependentId: number) {
    const dependent = await this.usersRepo.findOne({ where: { id: dependentId } });
    if (!dependent || dependent.holderId !== holderId) {
      throw new NotFoundException('Dependente não encontrado.');
    }
    await this.usersRepo.remove(dependent);
    return { success: true };
  }
}
