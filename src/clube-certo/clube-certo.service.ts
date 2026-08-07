import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfig } from '../admin/entities/config.entity';

/**
 * Integração com o Clube Certo (clube de descontos).
 * Docs: https://integrations.clubecerto.com.br/docs/  — base https://node.clubecerto.com.br/superapp
 *
 * Fluxo de auth:
 *   1. POST /companyAPI/login (cnpj + senha)          -> Token de Empresa
 *   2. POST /companyAPI/associate/token (cpf + tokenEmpresa) -> Token de Usuário
 *   3. endpoints de desconto/cashback usam o Token de Usuário
 *
 * Fica inerte enquanto clubeCertoEnabled != true ou faltar credencial — a tela de
 * Clube de Descontos cai no conteúdo estático até o Admin ligar com credenciais reais.
 *
 * Credenciais (cnpj/senha) ficam em app_config, configuradas pelo Admin.
 */

const BASE = 'https://node.clubecerto.com.br/superapp';
const COMPANY_TOKEN_TTL_MS = 45 * 60 * 1000; // login é rate-limited; cacheia ~45min

@Injectable()
export class ClubeCertoService {
  private readonly logger = new Logger(ClubeCertoService.name);
  private companyToken: { value: string; at: number } | null = null;

  constructor(@InjectRepository(AppConfig) private configRepo: Repository<AppConfig>) {}

  private async getConfig(): Promise<AppConfig | null> {
    return this.configRepo.findOne({ where: {} });
  }

  async isEnabled(): Promise<boolean> {
    const c = await this.getConfig();
    return !!(c && c.clubeCertoEnabled && c.clubeCertoCnpj && c.clubeCertoPassword);
  }

  private onlyDigits(v: string | null | undefined): string {
    return (v ?? '').replace(/\D/g, '');
  }

  /** Nosso birthDate é DD/MM/AAAA; o Clube Certo exige YYYY-MM-DD. */
  private toIsoDate(v: string | null | undefined): string | undefined {
    if (!v) return undefined;
    const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v; // já ISO
    return undefined;
  }

  /** Nosso gender é MASCULINO/FEMININO; o Clube Certo espera M/F. */
  private toGender(v: string | null | undefined): 'M' | 'F' | undefined {
    if (!v) return undefined;
    const u = v.toUpperCase();
    if (u.startsWith('M')) return 'M';
    if (u.startsWith('F')) return 'F';
    return undefined;
  }

  /** Token de Empresa (cacheado em memória). */
  private async getCompanyToken(cfg: AppConfig): Promise<string | null> {
    if (this.companyToken && Date.now() - this.companyToken.at < COMPANY_TOKEN_TTL_MS) {
      return this.companyToken.value;
    }
    try {
      const res = await fetch(`${BASE}/companyAPI/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cnpj: this.onlyDigits(cfg.clubeCertoCnpj),
          password: cfg.clubeCertoPassword,
        }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        this.logger.error(`Clube Certo login falhou: HTTP ${res.status} — ${JSON.stringify(data)}`);
        return null;
      }
      const token = data?.token ?? data?.accessToken ?? data?.data?.token;
      if (!token) {
        this.logger.error(`Clube Certo login sem token no corpo: ${JSON.stringify(data)}`);
        return null;
      }
      this.companyToken = { value: token, at: Date.now() };
      return token;
    } catch (err) {
      this.logger.error(`Erro no login Clube Certo: ${(err as Error).message}`);
      return null;
    }
  }

  /** Token de Usuário a partir do CPF (necessário para descontos/cashback). */
  private async getUserToken(cfg: AppConfig, cpf: string): Promise<string | null> {
    const companyToken = await this.getCompanyToken(cfg);
    if (!companyToken) return null;
    try {
      const res = await fetch(`${BASE}/companyAPI/associate/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${companyToken}` },
        body: JSON.stringify({ cpf: this.onlyDigits(cpf) }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        this.logger.warn(`Clube Certo associate/token (cpf ${cpf}): HTTP ${res.status} — ${JSON.stringify(data)}`);
        return null;
      }
      return data?.token ?? data?.accessToken ?? data?.data?.token ?? null;
    } catch (err) {
      this.logger.error(`Erro no associate/token Clube Certo: ${(err as Error).message}`);
      return null;
    }
  }

  /** POST autenticado com o Token de Empresa (cadastro/gestão de associados). */
  private async companyPost(path: string, body: unknown): Promise<{ ok: boolean; data?: any; error?: string }> {
    const cfg = await this.getConfig();
    if (!cfg || !cfg.clubeCertoEnabled || !cfg.clubeCertoCnpj || !cfg.clubeCertoPassword) {
      return { ok: false, error: 'clube_certo_disabled' };
    }
    const companyToken = await this.getCompanyToken(cfg);
    if (!companyToken) return { ok: false, error: 'no_company_token' };
    try {
      const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${companyToken}` },
        body: JSON.stringify(body),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        this.logger.error(`Clube Certo POST ${path}: HTTP ${res.status} — ${JSON.stringify(data)}`);
        return { ok: false, data, error: data?.message || data?.error || `HTTP ${res.status}` };
      }
      return { ok: true, data };
    } catch (err) {
      this.logger.error(`Erro POST Clube Certo ${path}: ${(err as Error).message}`);
      return { ok: false, error: (err as Error).message };
    }
  }

  /**
   * Monta o payload de associado do Clube Certo a partir do nosso usuário.
   * A empresa (46.997.347/0001-51) tem os produtos Descontos e Cashback (confirmado
   * via /companyAPI/products), então ativamos `discount` + `cashback`. Telemedicina
   * fica com a Vencca. Sem produto, a listagem volta vazia (noProducts).
   */
  mapUserToAssociate(user: {
    name: string;
    cpf: string;
    phone?: string | null;
    email?: string | null;
    birthDate?: string | null;
    gender?: string | null;
  }): Record<string, unknown> {
    return {
      name: user.name,
      cpf: this.onlyDigits(user.cpf),
      phone: this.onlyDigits(user.phone) || undefined,
      email: user.email ?? undefined,
      birthDate: this.toIsoDate(user.birthDate),
      gender: this.toGender(user.gender),
      discount: true,
      cashback: true,
    };
  }

  /** Cadastra/atualiza um associado (POST /companyAPI/associate). No-op se desligado. */
  async registerAssociate(user: Parameters<ClubeCertoService['mapUserToAssociate']>[0]) {
    if (!(await this.isEnabled())) return { ok: false, error: 'clube_certo_disabled' };
    return this.companyPost('/companyAPI/associate', this.mapUserToAssociate(user));
  }

  /**
   * Cadastro em lote (POST /companyAPI/associate/bulk-register) — usado no backfill.
   * O corpo é um array direto de AssociateInput (não um objeto {associates}).
   */
  async bulkRegister(users: Array<Parameters<ClubeCertoService['mapUserToAssociate']>[0]>) {
    if (!(await this.isEnabled())) return { ok: false, error: 'clube_certo_disabled' };
    const associates = users.map((u) => this.mapUserToAssociate(u));
    return this.companyPost('/companyAPI/associate/bulk-register', associates);
  }

  /**
   * Testa a conexão: faz login (Token de Empresa) e lista os produtos da empresa.
   * Usado no Admin p/ confirmar credenciais e ver quais produtos o plano inclui
   * (discount, cashback, telemedicine, etc — o que a empresa pode ativar no associado).
   */
  async testConnection(): Promise<{ ok: boolean; error?: string; products?: any; companyId?: any; tokenKeys?: string[] }> {
    const cfg = await this.getConfig();
    if (!cfg?.clubeCertoEnabled) return { ok: false, error: 'clube_certo_disabled' };
    if (!cfg.clubeCertoCnpj || !cfg.clubeCertoPassword) return { ok: false, error: 'missing_credentials' };
    // força novo login (ignora cache) pra validar credenciais de verdade
    this.companyToken = null;
    const token = await this.getCompanyToken(cfg);
    if (!token) return { ok: false, error: 'login_failed' };
    const products = await this.listProducts();
    const payload = this.decodeJwt(token);
    const companyId =
      payload?.companyId ?? payload?.company_id ?? payload?.id ?? payload?.company?.id ?? null;
    return { ok: true, products: products ?? null, companyId, tokenKeys: payload ? Object.keys(payload) : [] };
  }

  /** Decodifica o payload de um JWT (sem verificar assinatura) — só p/ ler o companyId. */
  private decodeJwt(token: string): any {
    try {
      const part = token.split('.')[1];
      return JSON.parse(Buffer.from(part, 'base64').toString('utf8'));
    } catch {
      return null;
    }
  }

  /** Inativa um associado no Clube Certo (DELETE /companyAPI/associate/{cpf}). */
  async inactivateAssociate(cpf: string): Promise<{ ok: boolean; error?: string }> {
    const cfg = await this.getConfig();
    if (!cfg?.clubeCertoEnabled || !cfg.clubeCertoCnpj || !cfg.clubeCertoPassword) {
      return { ok: false, error: 'clube_certo_disabled' };
    }
    const companyToken = await this.getCompanyToken(cfg);
    if (!companyToken) return { ok: false, error: 'no_company_token' };
    try {
      const res = await fetch(`${BASE}/companyAPI/associate/${this.onlyDigits(cpf)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${companyToken}` },
      });
      if (!res.ok) {
        const data: any = await res.json().catch(() => ({}));
        return { ok: false, error: data?.message || data?.error || `HTTP ${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /**
   * Link de acesso do associado ao portal de DESCONTOS do Clube Certo.
   * O endpoint /webapp/{cpf}/{companyId} devolve um JSON com os deep-links por produto
   * (desconto, cashback, cinema...) já autenticados. Buscamos esse JSON e retornamos o
   * link de `desconto` (o portal de descontos). Retorna null se desligado/sem companyId.
   */
  async getAccessUrl(cpf: string): Promise<string | null> {
    const cfg = await this.getConfig();
    if (!cfg?.clubeCertoEnabled) return null;
    let companyId: string | number | null = cfg.clubeCertoCompanyId;
    if (!companyId) {
      const token = await this.getCompanyToken(cfg);
      const payload = token ? this.decodeJwt(token) : null;
      companyId = payload?.companyId ?? payload?.id ?? null;
    }
    if (!companyId) return null;
    const doc = this.onlyDigits(cpf);
    if (!doc) return null;
    try {
      const res = await fetch(`https://integrations.clubecerto.com.br/webapp/${doc}/${companyId}`);
      if (!res.ok) {
        this.logger.warn(`Clube Certo webapp ${doc}: HTTP ${res.status}`);
        return null;
      }
      const data: any = await res.json().catch(() => ({}));
      // Prioriza o portal de descontos; cai no cashback se descontos não vier.
      return data?.desconto ?? data?.discount ?? data?.cashback ?? null;
    } catch (err) {
      this.logger.error(`Erro webapp Clube Certo ${doc}: ${(err as Error).message}`);
      return null;
    }
  }

  /** Lista os produtos disponíveis para a empresa (ajuda a descobrir ids exigidos no cadastro). */
  async listProducts() {
    const cfg = await this.getConfig();
    if (!cfg || !cfg.clubeCertoEnabled) return null;
    const companyToken = await this.getCompanyToken(cfg);
    if (!companyToken) return null;
    try {
      const res = await fetch(`${BASE}/companyAPI/products`, {
        headers: { Authorization: `Bearer ${companyToken}` },
      });
      if (!res.ok) return null;
      return await res.json().catch(() => null);
    } catch {
      return null;
    }
  }

  /** GET autenticado com o Token de Usuário do CPF informado. */
  private async userGet(cpf: string, path: string): Promise<any | null> {
    const cfg = await this.getConfig();
    if (!cfg || !cfg.clubeCertoEnabled) return null;
    const userToken = await this.getUserToken(cfg, cpf);
    if (!userToken) return null;
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
      if (!res.ok) {
        this.logger.warn(`Clube Certo GET ${path}: HTTP ${res.status}`);
        return null;
      }
      return await res.json().catch(() => null);
    } catch (err) {
      this.logger.error(`Erro GET Clube Certo ${path}: ${(err as Error).message}`);
      return null;
    }
  }

  listCategories(cpf: string) {
    return this.userGet(cpf, '/companyAPI/establishment/categories');
  }

  searchEstablishments(cpf: string, query: Record<string, string | undefined>) {
    const qs = Object.entries(query)
      .filter(([, v]) => v != null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    return this.userGet(cpf, `/companyAPI/establishment/search${qs ? `?${qs}` : ''}`);
  }

  establishmentDetail(cpf: string, id: string) {
    return this.userGet(cpf, `/companyAPI/establishment/${encodeURIComponent(id)}`);
  }

  listStates(cpf: string) {
    return this.userGet(cpf, '/locations/states');
  }

  listCities(cpf: string, stateId: string) {
    return this.userGet(cpf, `/locations/cities/${encodeURIComponent(stateId)}`);
  }

  listCashback(cpf: string) {
    return this.userGet(cpf, '/companyAPI/cashback');
  }
}
