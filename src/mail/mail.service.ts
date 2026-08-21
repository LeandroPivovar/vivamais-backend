import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

/** Base pública do portal — usada nos links e nas imagens hospedadas dos e-mails. */
const PORTAL_URL = (process.env.PUBLIC_URL ?? 'https://conta.vivamaisclub.net').replace(/\/+$/, '');

/** DD/MM/AAAA às HH:MM no fuso de São Paulo (e-mails vão para clientes no Brasil). */
function formatDateTime(date: Date): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '-';
  return d
    .toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    .replace(',', ' às');
}

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

  /** Bloco de detalhes (rótulo → valor) usado nos e-mails de saque. */
  private detailsBox(rows: Array<[string, string]>): string {
    const lines = rows
      .map(
        ([label, value], i) => `
          <tr>
            <td style="padding: 8px 0; font-size: 13px; color: #6b7280;${i > 0 ? ' border-top: 1px solid #f3f4f6;' : ''}">${label}</td>
            <td style="padding: 8px 0; font-size: 14px; font-weight: bold; text-align: right;${i > 0 ? ' border-top: 1px solid #f3f4f6;' : ''}">${value}</td>
          </tr>`,
      )
      .join('');
    return `
      <table style="width: 100%; border-collapse: collapse; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 16px; margin: 16px 0;">
        ${lines}
      </table>`;
  }

  /** Confirmação de que o pedido de saque entrou na fila (processamento às segundas). */
  async sendWithdrawalRequested(
    to: string,
    name: string,
    value: string,
    details: { id: number; requestedAt: Date; pixKey?: string; pixKeyTypeLabel?: string },
  ): Promise<void> {
    const html = this.wrap(
      'Saque solicitado!',
      `
        <p>Olá, ${name}.</p>
        <p>Recebemos seu pedido de saque das suas comissões de indicação.</p>
        ${this.detailsBox([
          ['Valor solicitado', `<span style="color: #059669;">${value}</span>`],
          ['Protocolo', `#${details.id}`],
          ...(details.pixKey
            ? ([[`Chave PIX (${details.pixKeyTypeLabel ?? 'PIX'})`, details.pixKey]] as Array<[string, string]>)
            : []),
          ['Data do pedido', formatDateTime(details.requestedAt)],
          ['Status', '<span style="color: #d97706;">Pendente</span>'],
        ])}
        <p style="font-size: 13px; color: #6b7280;">Confira a chave PIX acima. Se estiver errada,
          entre em contato com o suporte antes da segunda-feira.</p>
        <p>Os saques são processados <strong>toda segunda-feira</strong>. Assim que o pagamento
          for realizado, você receberá um novo e-mail de confirmação.</p>
        <p>Acompanhe seus ganhos em
          <a href="https://conta.vivamaisclub.net">conta.vivamaisclub.net</a>.</p>
      `,
    );
    await this.send(to, `Saque solicitado (${value}) — Viva Mais Club`, html);
  }

  /** Aviso de que o saque solicitado foi liberado (admin deu baixa). */
  async sendWithdrawalPaid(
    to: string,
    name: string,
    value: string,
    details: { id: number; requestedAt: Date; paidAt: Date },
  ): Promise<void> {
    const html = this.wrap(
      'Saque realizado!',
      `
        <p>Olá, ${name}.</p>
        <p>Seu saque foi <strong>processado</strong> e o valor será creditado na conta informada.</p>
        ${this.detailsBox([
          ['Valor pago', `<span style="color: #059669;">${value}</span>`],
          ['Protocolo', `#${details.id}`],
          ['Data do pedido', formatDateTime(details.requestedAt)],
          ['Data do pagamento', formatDateTime(details.paidAt)],
          ['Status', '<span style="color: #059669;">Pago</span>'],
        ])}
        <p>Acompanhe seus ganhos em
          <a href="https://conta.vivamaisclub.net">conta.vivamaisclub.net</a>.</p>
      `,
    );
    await this.send(to, `Saque realizado (${value}) — Viva Mais Club`, html);
  }

  // ---- Viva Kids / Viva Teens (layout próprio, fora do wrap padrão) ----

  /**
   * Casca dos e-mails Kids/Teens. Os templates originais vinham com as imagens
   * embutidas em base64 (2 MB no Kids), o que o Gmail corta em 102 KB — aqui as
   * imagens são servidas por URL do portal e o HTML fica em ~3 KB.
   */
  private kidsTeensShell(opts: {
    title: string;
    eyebrow: string;
    heading: string;
    bodyHtml: string;
    ctaLabel: string;
    ctaUrl: string;
    heroHtml?: string;
  }): string {
    return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${opts.title}</title>
<style>@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');@media only screen and (max-width:620px){.email{width:100%!important;max-width:100%!important}.pad{padding-left:24px!important;padding-right:24px!important}.title{font-size:28px!important;line-height:34px!important}.cta{display:block!important;text-align:center!important}.email img{max-width:100%!important;height:auto!important}}</style></head>
<body style="margin:0;padding:0;background:#f3f6f7;font-family:'Plus Jakarta Sans',Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:32px 12px"><table class="email" role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;background:#fff;border-radius:20px;overflow:hidden">
<tr><td style="height:10px;background:#00b3a9"></td></tr><tr><td class="pad" style="padding:30px 48px;background:#002e73"><img src="${PORTAL_URL}/emails/logo-header.png" alt="Viva Mais Club" width="143" style="display:block;width:143px;max-width:100%;height:auto;border:0"></td></tr>
<tr><td class="pad" style="padding:38px 48px ${opts.heroHtml ? '28px' : '42px'}"><p style="margin:0 0 10px;color:#00a99f;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase">${opts.eyebrow}</p><h1 class="title" style="margin:0 0 16px;font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:32px;line-height:39px;letter-spacing:-1.3px;color:#002e73">${opts.heading}</h1>${opts.bodyHtml}<a class="cta" href="${opts.ctaUrl}" style="display:inline-block;margin-top:${opts.heroHtml ? '2px' : '8px'};background:#00b3a9;border-radius:9px;color:#fff;padding:15px 23px;text-decoration:none;font-size:14px;font-weight:700">${opts.ctaLabel}</a></td></tr>
${opts.heroHtml ?? ''}
<tr><td class="pad" align="center" style="padding:28px 48px 26px;background:#fff;border-top:1px solid #e5eaed"><img src="${PORTAL_URL}/emails/logo-footer.png" alt="Viva Mais Club" width="115" style="display:block;width:115px;max-width:100%;height:auto;border:0;margin:0 auto 14px"><p style="margin:0;font-size:11px;line-height:18px;color:#67747e">Você recebeu este e-mail por ter uma conta no Viva Mais Club.</p><p style="margin:8px 0 0;font-size:11px;color:#002e73">© Viva Mais Club</p></td></tr><tr><td style="height:9px;background:#00b3a9"></td></tr>
</table></td></tr></table></body></html>`;
  }

  /** Viva Kids liberado — vai para o titular, que é quem o texto trata (dependente até 10 anos). */
  async sendVivaKidsWelcome(to: string, holderName: string, dependentName: string): Promise<void> {
    const html = this.kidsTeensShell({
      title: 'Viva Kids | Viva Mais Club',
      eyebrow: 'Viva Kids',
      heading: 'Uma nova jornada acaba de começar!',
      bodyHtml: `<p style="margin:0 0 18px;font-size:15px;line-height:24px;color:#24313d">Olá, <strong>${holderName}</strong>! O Viva Kids foi ativado para <strong>${dependentName}</strong>. Agora o dependente já pode utilizar os benefícios e experiências disponíveis para curtir em família.</p>`,
      ctaLabel: 'Acessar o Viva Kids →',
      ctaUrl: `${PORTAL_URL}/kids`,
      heroHtml: `<tr><td align="center" style="padding:0 32px 34px"><img src="${PORTAL_URL}/kids/banners/turma.png" alt="Turma Viva Kids" width="520" style="display:block;width:100%;max-width:520px;height:auto;border:0"></td></tr>`,
    });
    await this.send(to, 'Viva Kids ativado — Viva Mais Club', html);
  }

  /** Viva Teens liberado — vai para o próprio dependente (11 a 17 anos), que o texto trata direto. */
  async sendVivaTeensWelcome(to: string, dependentName: string): Promise<void> {
    const html = this.kidsTeensShell({
      title: 'Viva Teens | Viva Mais Club',
      eyebrow: 'Viva Teens',
      heading: 'Idiomas para chegar mais longe.',
      bodyHtml: `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#24313d">Olá, <strong>${dependentName}</strong>! O Viva Teens ajuda você a aprender novos idiomas, se comunicar melhor e alcançar fronteiras com mais confiança.</p>`,
      ctaLabel: 'Explorar o Viva Teens →',
      ctaUrl: `${PORTAL_URL}/teen`,
    });
    await this.send(to, 'Viva Teens ativado — Viva Mais Club', html);
  }
}
