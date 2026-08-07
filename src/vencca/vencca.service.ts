import { Injectable, Logger } from '@nestjs/common';
import { User } from '../users/entities/user.entity';

/**
 * Integração com a Vencca (cadastro de associados + telemedicina médica).
 *
 * Tudo configurável por env — enquanto VENCCA_ENABLED não for 'true', o serviço
 * fica inerte (no-op / null), então o deploy funciona sem as credenciais reais.
 * Preencher no .env quando a Vencca fornecer host, token e id-parceiro:
 *   VENCCA_ENABLED=true
 *   VENCCA_CADASTRO_URL=https://.../<endpoint-de-cadastro>
 *   VENCCA_CADASTRO_USER / VENCCA_CADASTRO_PASSWORD  (opcional — Basic Auth do endpoint de import, se exigido)
 *   VENCCA_TOKEN=<token-do-parceiro>                 (vai no body {token, clientes})
 *   VENCCA_TELEMED_URL=https://.../   (base; o serviço concatena /beneficiarios)
 *   VENCCA_TELEMED_API_KEY=<x-api-key>               (header da consulta de beneficiários)
 *   VENCCA_PARTNER_ID=<id-parceiro>
 *   VENCCA_SSO_URL=https://.../       (base do Login SSO)
 *
 * Docs: https://app.veenca.com/docs (produtor teste: veenca8942@gmail.com / 123123)
 */

export interface VenccaCliente {
  StatusRegistro: string;
  TipoPlano: string;
  TipoAssociado: 'TITULAR' | 'DEPENDENTE';
  Matricula: string;
  MatriculaTitular?: string;
  Nome: string;
  DataNascimento: string; // DD/MM/AAAA
  CPF: string;
  Celular: string;
  Email: string;
  DataVencimento: string; // DD/MM/AAAA
  Sexo: string;
  Endereco: string;
  Bairro: string;
  Complemento: string;
  Cidade: string;
  Estado: string;
  CEP: string;
}

export interface VenccaBeneficiario {
  nome: string;
  cpf: string;
  tipo: string;
  holderCpf: string | null;
  ativo: boolean;
  uuid_telemed: string;
  criadoEm: string;
}

@Injectable()
export class VenccaService {
  private readonly logger = new Logger(VenccaService.name);

  private get enabled(): boolean {
    return process.env.VENCCA_ENABLED === 'true';
  }

  private get token(): string {
    return process.env.VENCCA_TOKEN ?? '';
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** CPF só com dígitos (usado como Matrícula e nas consultas de beneficiário). */
  private onlyDigits(value: string | null | undefined): string {
    return (value ?? '').replace(/\D/g, '');
  }

  /**
   * Remove caracteres especiais que a Vencca rejeita em campos de texto (ex.: parênteses
   * em "Vila Iolanda(Lajeado)" → "Vila Iolanda Lajeado"). Mantém letras (com acento),
   * números, espaço e hífen; troca o resto por espaço e normaliza os espaços.
   */
  private sanitizeText(value: string | null | undefined): string {
    return (value ?? '')
      // Ordinais: "2ª" -> "2a", "3º" -> "3o".
      .replace(/ª/g, 'a')
      .replace(/º/g, 'o')
      // Remove acentos (ç->c, ã->a, ó->o, é->e...) — a Vencca só aceita ASCII simples.
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      // Sobra só letras A-Z, números, espaço e hífen; o resto vira espaço.
      .replace(/[^A-Za-z0-9\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Bairro: a Vencca não aceita número no campo (ex.: "Landi 2a" -> "Landi a" -> "Landi"). */
  private sanitizeBairro(value: string | null | undefined): string {
    return this.sanitizeText(value)
      .replace(/[0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** DD/MM/AAAA a partir de uma data — usado pra derivar o vencimento (registro + 1 mês). */
  private formatDate(date: Date): string {
    return date.toLocaleDateString('pt-BR');
  }

  /**
   * Mapeia um usuário nosso para o payload de associado da Vencca.
   * Todos são TITULAR: não modelamos titular/dependente (indicação ≠ dependente).
   */
  mapUserToCliente(user: User): VenccaCliente {
    const matricula = this.onlyDigits(user.cpf) || String(user.id);
    const dueDate = new Date(user.createdAt);
    dueDate.setMonth(dueDate.getMonth() + 1);
    return {
      StatusRegistro: '1',
      TipoPlano: user.plan === 'Família' ? 'FAMILIAR' : 'INDIVIDUAL',
      TipoAssociado: 'TITULAR',
      Matricula: matricula,
      Nome: this.sanitizeText(user.name),
      DataNascimento: user.birthDate ?? '',
      CPF: user.cpf,
      Celular: this.onlyDigits(user.phone),
      Email: user.email,
      DataVencimento: this.formatDate(dueDate),
      Sexo: user.gender ?? '',
      Endereco: this.sanitizeText(user.address),
      Bairro: this.sanitizeBairro(user.neighborhood),
      Complemento: this.sanitizeText(user.complement),
      Cidade: this.sanitizeText(user.city),
      Estado: user.state ?? '',
      // Vencca valida CEP como exatamente 8 dígitos — manda só números (sem máscara).
      CEP: this.onlyDigits(user.zipCode),
    };
  }

  /**
   * Envia associados para a API de Cadastro da Vencca. Best-effort: registra e
   * engole erro pra nunca derrubar o fluxo de criação de usuário local.
   * Retorna true se a Vencca respondeu 200 (condição de ativação junto de StatusRegistro=1).
   */
  async registerAssociates(clientes: VenccaCliente[]): Promise<boolean> {
    if (!this.enabled) {
      this.logger.debug('Vencca desabilitada — cadastro de associado ignorado.');
      return false;
    }
    const url = process.env.VENCCA_CADASTRO_URL;
    if (!url) {
      this.logger.warn('VENCCA_CADASTRO_URL não configurada — pulei o cadastro.');
      return false;
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const basicUser = process.env.VENCCA_CADASTRO_USER;
    const basicPass = process.env.VENCCA_CADASTRO_PASSWORD;
    if (basicUser && basicPass) {
      headers.Authorization = `Basic ${Buffer.from(`${basicUser}:${basicPass}`).toString('base64')}`;
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ token: this.token, clientes }),
      });
      if (!res.ok) {
        this.logger.error(`Cadastro Vencca falhou: HTTP ${res.status} — ${await res.text()}`);
        return false;
      }
      this.logger.log(`Cadastro Vencca OK (${clientes.length} associado(s)).`);
      return true;
    } catch (err) {
      this.logger.error(`Erro ao chamar cadastro Vencca: ${(err as Error).message}`);
      return false;
    }
  }

  /** Consulta um beneficiário da telemedicina pelo CPF (para obter uuid_telemed). */
  async getBeneficiaryByCpf(cpf: string): Promise<VenccaBeneficiario | null> {
    if (!this.enabled) return null;
    const base = process.env.VENCCA_TELEMED_URL;
    if (!base) {
      this.logger.warn('VENCCA_TELEMED_URL não configurada.');
      return null;
    }
    const url = `${base.replace(/\/$/, '')}/beneficiarios/cpf/${this.onlyDigits(cpf)}`;
    const apiKey = process.env.VENCCA_TELEMED_API_KEY;
    try {
      const res = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'x-api-key': apiKey } : {}),
        },
      });
      if (!res.ok) {
        this.logger.warn(`Beneficiário Vencca não encontrado (HTTP ${res.status}) para CPF ${cpf}.`);
        return null;
      }
      return (await res.json()) as VenccaBeneficiario;
    } catch (err) {
      this.logger.error(`Erro ao consultar beneficiário Vencca: ${(err as Error).message}`);
      return null;
    }
  }

  /** Monta a URL de Login SSO: https://[SSO_URL]/[id-parceiro]/beneficiary/[uuid]. */
  buildSsoUrl(uuidTelemed: string): string | null {
    const base = process.env.VENCCA_SSO_URL;
    const partnerId = process.env.VENCCA_PARTNER_ID;
    if (!base || !partnerId) return null;
    return `${base.replace(/\/$/, '')}/${partnerId}/beneficiary/${uuidTelemed}`;
  }
}
