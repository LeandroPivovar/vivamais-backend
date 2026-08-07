import { NotFoundException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfig } from './entities/config.entity';
import { Transaction } from '../billing/entities/transaction.entity';
import { UpdateConfigDto } from './dto/update-config.dto';
import { UsersService } from '../users/users.service';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { VenccaService } from '../vencca/vencca.service';
import { ClubeCertoService } from '../clube-certo/clube-certo.service';
import { MailService } from '../mail/mail.service';
import { mmnForPlan, basePriceForPlan } from '../common/pricing';

function formatDate(date: Date): string {
  return date.toLocaleDateString('pt-BR');
}

/** Senha temporária legível (sem caracteres ambíguos como O/0, l/1). */
function generatePassword(length = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

/**
 * Config do painel: a chave secreta do gateway nunca sai do servidor — o painel
 * recebe só "existe?" e os 4 últimos dígitos, para exibição.
 */
export type AdminConfigResponse = Omit<
  AppConfig,
  'veencaSecretKey' | 'clubeCertoPassword' | 'wooviAppId' | 'pagarmeSecretKey'
> & {
  veencaSecretKeySet: boolean;
  veencaSecretKeyLast4: string | null;
  clubeCertoPasswordSet: boolean;
  wooviAppIdSet: boolean;
  wooviAppIdLast4: string | null;
  pagarmeSecretKeySet: boolean;
  pagarmeSecretKeyLast4: string | null;
};

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(AppConfig) private configRepo: Repository<AppConfig>,
    @InjectRepository(Transaction) private txRepo: Repository<Transaction>,
    private usersService: UsersService,
    private venccaService: VenccaService,
    private clubeCertoService: ClubeCertoService,
    private mailService: MailService,
  ) {}

  /** Config crua — uso interno (preços, gateway). Contém a chave secreta em texto puro. */
  async getConfig(): Promise<AppConfig> {
    const config = await this.configRepo.findOne({ where: {} });
    if (!config) throw new NotFoundException('Configuração do sistema não encontrada.');
    return config;
  }

  /** Config para o painel: sem segredos (gateway/Clube Certo), só o indicativo de que existem. */
  async getConfigForAdmin(): Promise<AdminConfigResponse> {
    const { veencaSecretKey, clubeCertoPassword, wooviAppId, pagarmeSecretKey, ...safe } = await this.getConfig();
    return {
      ...safe,
      veencaSecretKeySet: !!veencaSecretKey,
      veencaSecretKeyLast4: veencaSecretKey ? veencaSecretKey.slice(-4) : null,
      clubeCertoPasswordSet: !!clubeCertoPassword,
      wooviAppIdSet: !!wooviAppId,
      wooviAppIdLast4: wooviAppId ? wooviAppId.slice(-4) : null,
      pagarmeSecretKeySet: !!pagarmeSecretKey,
      pagarmeSecretKeyLast4: pagarmeSecretKey ? pagarmeSecretKey.slice(-4) : null,
    };
  }

  /** Cadastro manual pelo admin gera, como no fluxo antigo, um lançamento financeiro inicial já pago. */
  async createUserWithBilling(dto: CreateUserDto) {
    // Admin não digita senha: geramos uma temporária e enviamos por e-mail.
    const generatedPassword = dto.password?.trim() ? null : generatePassword();
    if (generatedPassword) dto.password = generatedPassword;

    // Os 3 benefícios são inclusos no plano — já entram liberados no cadastro.
    dto.access = { ...dto.access, health: true, clube: true, pet: true };

    const user = await this.usersService.create(dto);

    if (generatedPassword) {
      await this.mailService.sendWelcomePassword(user.email, user.name, generatedPassword);
    }

    const config = await this.getConfig();
    const price = basePriceForPlan(dto.plan, config); // valor da tabela do plano (79,90 / 129,90)
    const mmn = mmnForPlan(dto.plan, config);

    await this.txRepo.save(
      this.txRepo.create({
        userId: user.id,
        plan: dto.plan,
        value: price,
        status: 'Renovado (Pago)',
        commissionMmn: mmn,
      }),
    );

    // Envia o associado às integrações (cada uma é no-op se estiver desligada).
    const venccaOk = await this.venccaService.registerAssociates([this.venccaService.mapUserToCliente(user)]);
    if (venccaOk) await this.usersService.markTelemedRegistered(user.id);
    await this.clubeCertoService.registerAssociate(user);

    return this.usersService.toAdminResponse(await this.usersService.findById(user.id));
  }

  /** Gera nova senha para o usuário, envia por e-mail e devolve em texto puro pro admin ver. */
  async regeneratePassword(id: number) {
    const user = await this.usersService.findById(id);
    const password = generatePassword();
    await this.usersService.setPassword(id, password);
    await this.mailService.sendNewPassword(user.email, user.name, password);
    return { password, email: user.email, name: user.name };
  }

  async updateConfig(dto: UpdateConfigDto): Promise<AdminConfigResponse> {
    const config = await this.getConfig();
    const { veencaSecretKey, clubeCertoPassword, wooviAppId, pagarmeSecretKey, ...rest } = dto;
    Object.assign(config, rest);

    // Campo vazio significa "manter a senha/chave atual" — o painel nunca recebe o
    // segredo, então só um valor digitado de fato chega aqui e substitui o gravado.
    if (veencaSecretKey?.trim()) config.veencaSecretKey = veencaSecretKey.trim();
    if (clubeCertoPassword?.trim()) config.clubeCertoPassword = clubeCertoPassword.trim();
    // AppID Woovi: vazio ou mascarado (só •) = manter o gravado.
    if (wooviAppId?.trim() && !/^[•*]+$/.test(wooviAppId.trim())) config.wooviAppId = wooviAppId.trim();
    // Secret key Pagar.me: vazio ou mascarado = manter a gravada.
    if (pagarmeSecretKey?.trim() && !/^[•*]+$/.test(pagarmeSecretKey.trim())) config.pagarmeSecretKey = pagarmeSecretKey.trim();

    await this.configRepo.save(config);
    return this.getConfigForAdmin();
  }

  /**
   * Backfill: cadastra no Clube Certo os associados que já existem na base (os novos
   * entram sozinhos no checkout/cadastro). No-op se a integração estiver desligada.
   * Envia em lotes de 1000 (limite do bulk-register).
   */
  async backfillClubeCerto(): Promise<{ enabled: boolean; total: number; lotes: number; erros: string[] }> {
    if (!(await this.clubeCertoService.isEnabled())) {
      return { enabled: false, total: 0, lotes: 0, erros: [] };
    }
    const users = (await this.usersService.listAll()).filter((u) => u.status === 'ativo' && u.cpf);
    const erros: string[] = [];
    const CHUNK = 1000;
    let lotes = 0;
    for (let i = 0; i < users.length; i += CHUNK) {
      const lote = users.slice(i, i + CHUNK);
      const res = await this.clubeCertoService.bulkRegister(lote);
      lotes += 1;
      if (!res.ok) erros.push(`lote ${lotes}: ${res.error}`);
    }
    return { enabled: true, total: users.length, lotes, erros };
  }

  /** Testa a conexão com o Clube Certo (login + produtos da empresa). */
  async testClubeCerto() {
    return this.clubeCertoService.testConnection();
  }

  async listBillingHistory() {
    const transactions = await this.txRepo.find({
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });
    return transactions.map((tx) => ({
      id: tx.id,
      user: tx.user?.name ?? 'Desconhecido',
      plan: tx.plan,
      value: Number(tx.value),
      status: tx.status,
      date: formatDate(tx.createdAt),
      commissionMmn: Number(tx.commissionMmn),
    }));
  }
}
