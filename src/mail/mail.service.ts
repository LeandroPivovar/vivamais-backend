import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

/**
 * Envio de e-mail via SMTP. Gated por env: sem SMTP_HOST/SMTP_USER/SMTP_PASS o
 * serviço vira no-op (só loga), então dev/local roda sem quebrar. Em produção as
 * credenciais ficam no .env do servidor (nunca no repo).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;
  private readonly from: string;

  constructor() {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    this.from = process.env.SMTP_FROM ?? (user ? `Viva Mais Club <${user}>` : '');

    if (host && user && pass) {
      const port = Number(process.env.SMTP_PORT ?? 587);
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465, // 465 = SSL implícito; 587 = STARTTLS
        auth: { user, pass },
      });
    } else {
      this.logger.warn('SMTP não configurado — e-mails não serão enviados (no-op).');
    }
  }

  isEnabled(): boolean {
    return !!this.transporter;
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(`[no-op] E-mail para ${to} não enviado (SMTP desligado): ${subject}`);
      return;
    }
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, html });
      this.logger.log(`E-mail enviado para ${to}: ${subject}`);
    } catch (err) {
      // Não estoura pro fluxo do usuário — cadastro/reset não deve falhar por causa do e-mail.
      this.logger.error(`Falha ao enviar e-mail para ${to}: ${(err as Error).message}`);
    }
  }

  private wrap(title: string, bodyHtml: string): string {
    return `
      <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; color: #1f2937;">
        <div style="background: #215cff; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="color: #ffffff; margin: 0; font-size: 20px;">Viva Mais Club</h1>
        </div>
        <div style="border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 8px 8px;">
          <h2 style="font-size: 18px; margin-top: 0;">${title}</h2>
          ${bodyHtml}
          <p style="font-size: 12px; color: #9ca3af; margin-top: 24px;">
            Se você não solicitou este e-mail, ignore-o com segurança.
          </p>
        </div>
      </div>
    `;
  }

  /** Código de recuperação de senha (login → "Esqueci a senha"). */
  async sendPasswordResetCode(to: string, name: string, code: string): Promise<void> {
    const html = this.wrap(
      'Recuperação de senha',
      `
        <p>Olá, ${name}.</p>
        <p>Use o código abaixo para redefinir sua senha. Ele expira em 15 minutos.</p>
        <p style="text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #215cff; margin: 24px 0;">
          ${code}
        </p>
      `,
    );
    await this.send(to, 'Seu código de recuperação — Viva Mais Club', html);
  }

  /** Senha inicial gerada quando o admin cria um usuário. */
  async sendWelcomePassword(to: string, name: string, password: string): Promise<void> {
    const html = this.wrap(
      'Bem-vindo(a) ao Viva Mais Club!',
      `
        <p>Olá, ${name}.</p>
        <p>Sua conta foi criada. Use a senha temporária abaixo para acessar em
          <a href="https://conta.vivamaisclub.net">conta.vivamaisclub.net</a>:</p>
        <p style="text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 3px; color: #215cff; margin: 24px 0;">
          ${password}
        </p>
        <p>Recomendamos trocar a senha após o primeiro acesso, em <strong>Minha Conta</strong>.</p>
      `,
    );
    await this.send(to, 'Sua senha de acesso — Viva Mais Club', html);
  }

  /** Nova senha gerada pelo admin (botão "gerar nova senha"). */
  async sendNewPassword(to: string, name: string, password: string): Promise<void> {
    const html = this.wrap(
      'Sua senha foi redefinida',
      `
        <p>Olá, ${name}.</p>
        <p>Uma nova senha foi gerada para sua conta. Use-a para acessar em
          <a href="https://conta.vivamaisclub.net">conta.vivamaisclub.net</a>:</p>
        <p style="text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 3px; color: #215cff; margin: 24px 0;">
          ${password}
        </p>
        <p>Recomendamos trocar a senha após o acesso, em <strong>Minha Conta</strong>.</p>
      `,
    );
    await this.send(to, 'Nova senha de acesso — Viva Mais Club', html);
  }

  /** Confirmação de pagamento aprovado. */
  async sendPaymentConfirmed(to: string, name: string, plan: string, value: string): Promise<void> {
    const html = this.wrap(
      'Pagamento confirmado!',
      `
        <p>Olá, ${name}.</p>
        <p>Recebemos o pagamento da sua assinatura <strong>${plan}</strong> no valor de <strong>${value}</strong>.</p>
        <p>Seu plano está <strong>ativo</strong> — acesse seus benefícios em
          <a href="https://conta.vivamaisclub.net">conta.vivamaisclub.net</a>.</p>
      `,
    );
    await this.send(to, 'Pagamento confirmado — Viva Mais Club', html);
  }
}
