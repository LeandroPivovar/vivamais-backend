import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { publicBaseOrigin } from '../common/public-url';

/** Base pública do portal — usada nos links e nas imagens hospedadas dos e-mails. */
const PORTAL_URL = publicBaseOrigin();

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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
    void name; // o template não usa saudação nominal
    const html = this.kidsTeensShell({
      title: 'Recuperação de senha | Viva Mais Club',
      heading: 'Use o código abaixo para redefinir sua senha',
      bodyHtml:
        this.p('Recebemos uma solicitação para redefinir a senha da sua conta no Viva Mais Club.') +
        this.p(
          'Para continuar com a recuperação de acesso, utilize o código de verificação abaixo na tela de redefinição de senha.',
        ) +
        this.p(
          'Por motivos de segurança, este código é válido por tempo limitado e pode ser utilizado apenas uma vez. Se você não solicitou a redefinição, desconsidere este e-mail.',
        ) +
        `<div style="margin:24px 0;padding:20px;border:1px solid #b8ece8;border-radius:12px;background:#f2fbfa;text-align:center;font-family:Montserrat,Arial,sans-serif;font-size:30px;font-weight:700;letter-spacing:9px;color:#002e73">${code}</div>`,
      ctaLabel: 'Redefinir senha →',
      ctaUrl: PORTAL_URL,
    });
    await this.send(to, 'Seu código de recuperação — Viva Mais Club', html);
  }

  /** Senha inicial gerada quando o admin cria um usuário. */
  async sendWelcomePassword(to: string, name: string, password: string): Promise<void> {
    const html = this.wrap(
      'Bem-vindo(a) ao Viva Mais Club!',
      `
        <p>Olá, ${name}.</p>
        <p>Sua conta foi criada. Use a senha temporária abaixo para acessar em
          <a href="${PORTAL_URL}">${PORTAL_URL.replace(/^https?:\/\//, '')}</a>:</p>
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
          <a href="${PORTAL_URL}">${PORTAL_URL.replace(/^https?:\/\//, '')}</a>:</p>
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
    // Layout novo (template 13). `name` fica na assinatura porque há 9 pontos de
    // chamada; o template não usa saudação nominal.
    void name;
    await this.sendPaymentConfirmedTemplate(to, plan, value);
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
          <a href="${PORTAL_URL}">${PORTAL_URL.replace(/^https?:\/\//, '')}</a>.</p>
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
    void name; // o template não usa saudação nominal
    const html = this.kidsTeensShell({
      title: 'Saque aprovado | Viva Mais Club',
      heading: 'Seu saque foi aprovado!',
      bodyHtml:
        this.p('Seu pedido de saque foi analisado e aprovado com sucesso.') +
        this.p(
          `Valor: <strong style="color:#00a99f">${value}</strong> &nbsp;·&nbsp; Protocolo: <strong>#${details.id}</strong> &nbsp;·&nbsp; Solicitado em ${formatDateTime(details.requestedAt)}.`,
        ) +
        this.p(
          'Em breve, o valor será transferido para a conta cadastrada, conforme o prazo de processamento informado pelo Viva Mais Club.',
        ) +
        this.p('Você pode acompanhar o status e consultar o histórico de saques sempre que desejar na sua área do parceiro.'),
      ctaLabel: 'Acompanhar saque →',
      ctaUrl: `${PORTAL_URL}/indicacoes`,
    });
    await this.send(to, `Saque aprovado (${value}) — Viva Mais Club`, html);
  }

  // ---- Viva Kids / Viva Teens (layout próprio, fora do wrap padrão) ----

  /**
   * Casca dos e-mails Kids/Teens. Os templates originais vinham com as imagens
   * embutidas em base64 (2 MB no Kids), o que o Gmail corta em 102 KB — aqui as
   * imagens são servidas por URL do portal e o HTML fica em ~3 KB.
   */
  private kidsTeensShell(opts: {
    title: string;
    /** Rótulo pequeno em maiúsculas acima do título (Kids/Teens). */
    eyebrow?: string;
    /** Pílula azul acima do título — usada nos e-mails de chamado. */
    badge?: string;
    heading: string;
    bodyHtml: string;
    ctaLabel: string;
    ctaUrl: string;
    heroHtml?: string;
  }): string {
    const eyebrowHtml = opts.eyebrow
      ? `<p style="margin:0 0 10px;color:#00a99f;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase">${opts.eyebrow}</p>`
      : '';
    const badgeHtml = opts.badge
      ? `<div style="display:inline-block;background:#e8f0ff;border-radius:999px;color:#002e73;font-size:11px;font-weight:700;letter-spacing:.7px;padding:8px 12px">${opts.badge}</div>`
      : '';
    // Com pílula o título ganha respiro em cima; sem ela, cola no topo do bloco.
    const headingMargin = opts.badge ? '20px 0 16px' : '0 0 16px';
    return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${opts.title}</title>
<style>@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');@media only screen and (max-width:620px){.email{width:100%!important;max-width:100%!important}.pad{padding-left:24px!important;padding-right:24px!important}.title{font-size:28px!important;line-height:34px!important}.cta{display:block!important;text-align:center!important}.email img{max-width:100%!important;height:auto!important}}</style></head>
<body style="margin:0;padding:0;background:#f3f6f7;font-family:'Plus Jakarta Sans',Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:32px 12px"><table class="email" role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;background:#fff;border-radius:20px;overflow:hidden">
<tr><td style="height:10px;background:#00b3a9"></td></tr><tr><td class="pad" style="padding:30px 48px;background:#002e73"><img src="${PORTAL_URL}/emails/logo-header.png" alt="Viva Mais Club" width="143" style="display:block;width:143px;max-width:100%;height:auto;border:0"></td></tr>
<tr><td class="pad" style="padding:38px 48px ${opts.heroHtml ? '28px' : '42px'}">${eyebrowHtml}${badgeHtml}<h1 class="title" style="margin:${headingMargin};font-family:'Plus Jakarta Sans',Arial,sans-serif;font-size:32px;line-height:39px;letter-spacing:-1.3px;color:#002e73">${opts.heading}</h1>${opts.bodyHtml}<a class="cta" href="${opts.ctaUrl}" style="display:inline-block;margin-top:${opts.heroHtml ? '2px' : '8px'};background:#00b3a9;border-radius:9px;color:#fff;padding:15px 23px;text-decoration:none;font-size:14px;font-weight:700">${opts.ctaLabel}</a></td></tr>
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

  // ---- Comissão / pagamento / chamados (mesmo layout dos templates) ----

  /** Parágrafo no estilo do corpo dos templates. */
  private p(html: string): string {
    return `<p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#24313d">${html}</p>`;
  }

  /** Herdeiro cadastrado — e-mail para a pessoa escolhida pelo titular. */
  async sendHeirSelectedToHeir(to: string, heirName: string, ownerName: string): Promise<void> {
    const html = this.kidsTeensShell({
      title: 'Você foi selecionado | Viva Mais Club',
      eyebrow: 'Herdeiro da conta',
      heading: 'Você foi selecionado!',
      bodyHtml:
        this.p(
          `<strong>${escapeHtml(heirName)}</strong>, você foi selecionado como herdeiro por <strong>${escapeHtml(ownerName)}</strong>.`,
        ) +
        this.p('Você agora faz parte da conta e poderá acompanhar os benefícios que foram disponibilizados para você.'),
      ctaLabel: 'Acessar minha conta →',
      ctaUrl: PORTAL_URL,
    });
    await this.send(to, 'Você foi selecionado como herdeiro — Viva Mais Club', html);
  }

  /** Herdeiro cadastrado — confirmação para o titular da conta. */
  async sendHeirSelectedToOwner(to: string, ownerName: string, heirName: string): Promise<void> {
    void ownerName;
    const html = this.kidsTeensShell({
      title: 'Herdeiro selecionado | Viva Mais Club',
      eyebrow: 'Herdeiro da conta',
      heading: 'Você selecionou seu herdeiro!',
      bodyHtml:
        this.p(
          `Parabéns! <strong>${escapeHtml(heirName)}</strong> foi escolhido para fazer parte da sua história no Viva Mais Club.`,
        ) +
        this.p('Agora essa pessoa terá acesso às informações e aos benefícios definidos para a sua conta.'),
      ctaLabel: 'Ver detalhes da conta →',
      ctaUrl: `${PORTAL_URL}/herdeiro`,
    });
    await this.send(to, 'Herdeiro selecionado — Viva Mais Club', html);
  }

  /** Comissão processada — enviado ao indicador quando um indicado dele paga. */
  async sendCommissionProcessed(
    to: string,
    referredName?: string,
    value?: string,
  ): Promise<void> {
    const html = this.kidsTeensShell({
      title: 'Comissão processada | Viva Mais Club',
      heading: 'Sua comissão foi processada com sucesso!',
      bodyHtml:
        this.p(
          referredName
            ? `Temos uma ótima notícia: <strong>${referredName}</strong> ativou a assinatura pela sua indicação e sua comissão foi processada.`
            : 'Temos uma ótima notícia: sua comissão foi processada e está disponível conforme as condições do programa.',
        ) +
        (value ? this.p(`Valor creditado: <strong style="color:#00a99f">${value}</strong>.`) : '') +
        this.p(
          'Agradecemos pela sua parceria e confiança no Viva Mais Club. Seu empenho faz parte do nosso compromisso de levar mais saúde, praticidade e qualidade de vida para cada vez mais pessoas.',
        ) +
        this.p('Você pode acompanhar os detalhes da comissão e o histórico de pagamentos na sua área do parceiro.'),
      ctaLabel: 'Ver minhas comissões →',
      ctaUrl: `${PORTAL_URL}/indicacoes`,
    });
    await this.send(to, 'Sua comissão foi processada — Viva Mais Club', html);
  }

  /** Pagamento confirmado (layout novo dos templates). */
  async sendPaymentConfirmedTemplate(to: string, plan: string, value: string): Promise<void> {
    const html = this.kidsTeensShell({
      title: 'Pagamento confirmado | Viva Mais Club',
      heading: 'Seu pagamento foi confirmado!',
      bodyHtml:
        this.p('Recebemos seu pagamento com sucesso e está tudo certo!') +
        this.p(`Plano <strong>${plan}</strong> — <strong style="color:#00a99f">${value}</strong>.`) +
        this.p(
          'Agora você já pode aproveitar todos os benefícios do Viva Mais Club com mais praticidade, economia e cuidado para a sua saúde.',
        ) +
        this.p('A partir de agora, você terá acesso aos serviços e vantagens exclusivos da plataforma, sempre que precisar.'),
      ctaLabel: 'Acessar minha área →',
      ctaUrl: PORTAL_URL,
    });
    await this.send(to, 'Pagamento confirmado — Viva Mais Club', html);
  }

  /** Lembrete de pagamento pendente. */
  async sendPaymentPending(to: string, plan?: string, value?: string): Promise<void> {
    const html = this.kidsTeensShell({
      title: 'Pagamento pendente | Viva Mais Club',
      heading: 'Seu pagamento ainda está pendente',
      bodyHtml:
        this.p('Identificamos que o pagamento da sua assinatura ainda não foi concluído.') +
        (plan && value ? this.p(`Plano <strong>${plan}</strong> — <strong>${value}</strong>.`) : '') +
        this.p(
          'Para continuar aproveitando todos os benefícios do Viva Mais Club, basta finalizar o pagamento. É rápido, seguro e garante que seu acesso permaneça ativo.',
        ) +
        this.p(
          'Caso o pagamento já tenha sido realizado, desconsidere esta mensagem. A confirmação pode levar alguns instantes para ser processada.',
        ),
      ctaLabel: 'Finalizar pagamento →',
      ctaUrl: `${PORTAL_URL}/financeiro`,
    });
    await this.send(to, 'Seu pagamento ainda está pendente — Viva Mais Club', html);
  }

  /** Renovação automática (PIX Automático) ativada. */
  async sendAutoRenewalActive(to: string): Promise<void> {
    const html = this.kidsTeensShell({
      title: 'Renovação automática | Viva Mais Club',
      heading: 'Sua renovação automática está ativa!',
      bodyHtml:
        this.p('Tudo certo! A renovação automática da sua assinatura foi ativada com sucesso.') +
        this.p(
          'Com isso, você continua aproveitando todos os benefícios do Viva Mais Club sem interrupções, garantindo acesso contínuo aos serviços de telemedicina, vantagens exclusivas e muito mais.',
        ) +
        this.p('Você pode gerenciar ou alterar essa configuração sempre que desejar na sua área do cliente.'),
      ctaLabel: 'Gerenciar assinatura →',
      ctaUrl: `${PORTAL_URL}/financeiro`,
    });
    await this.send(to, 'Renovação automática ativada — Viva Mais Club', html);
  }

  /** Chamado respondido pelo suporte. */
  async sendTicketAnswered(to: string, ticketId: number, title?: string): Promise<void> {
    const html = this.kidsTeensShell({
      title: 'Chamado respondido | Viva Mais Club',
      badge: `CHAMADO #${ticketId}`,
      heading: 'Seu chamado recebeu uma resposta!',
      bodyHtml:
        this.p(title ? `Temos uma atualização sobre a sua solicitação: <strong>${title}</strong>.` : 'Temos uma atualização sobre a sua solicitação.') +
        this.p(
          'Nossa equipe respondeu ao seu chamado e já disponibilizou as informações necessárias para dar continuidade ao atendimento.',
        ) +
        this.p(
          'Acesse sua área no Viva Mais Club para visualizar a resposta completa e, se necessário, enviar novas informações ou continuar a conversa com nossa equipe.',
        ),
      ctaLabel: 'Ver resposta do chamado →',
      ctaUrl: `${PORTAL_URL}/suporte`,
    });
    await this.send(to, `Chamado #${ticketId} respondido — Viva Mais Club`, html);
  }

  /** Chamado encerrado. */
  async sendTicketClosed(to: string, ticketId: number, title?: string): Promise<void> {
    const html = this.kidsTeensShell({
      title: 'Chamado encerrado | Viva Mais Club',
      badge: `CHAMADO #${ticketId}`,
      heading: 'Seu chamado foi encerrado',
      bodyHtml:
        this.p(title ? `Informamos que o seu chamado <strong>${title}</strong> foi concluído e encerrado com sucesso.` : 'Informamos que o seu chamado foi concluído e encerrado com sucesso.') +
        this.p(
          'Esperamos que a solicitação tenha sido resolvida de forma satisfatória. Caso ainda precise de ajuda ou tenha uma nova dúvida, nossa equipe estará à disposição para atendê-lo.',
        ) +
        this.p('Agradecemos pela confiança em nossos serviços e por fazer parte do Viva Mais Club.'),
      ctaLabel: 'Abrir novo chamado →',
      ctaUrl: `${PORTAL_URL}/suporte`,
    });
    await this.send(to, `Chamado #${ticketId} encerrado — Viva Mais Club`, html);
  }

  /** Chamado aberto — confirmação de recebimento. */
  async sendTicketOpened(to: string, ticketId: number, title?: string): Promise<void> {
    const html = this.kidsTeensShell({
      title: 'Abertura de chamado | Viva Mais Club',
      badge: `CHAMADO #${ticketId}`,
      heading: 'Recebemos sua solicitação!',
      bodyHtml:
        this.p(title ? `Seu chamado <strong>${title}</strong> foi registrado com sucesso e nossa equipe já foi notificada.` : 'Seu chamado foi registrado com sucesso e nossa equipe já foi notificada.') +
        this.p(
          'Em breve, um de nossos atendentes analisará sua solicitação e dará andamento ao atendimento. Você poderá acompanhar o status do chamado sempre que precisar pela sua área no Viva Mais Club.',
        ) +
        this.p(
          'Agradecemos pela confiança. Estamos à disposição para oferecer o suporte necessário e garantir a melhor experiência possível.',
        ),
      ctaLabel: 'Acompanhar chamado →',
      ctaUrl: `${PORTAL_URL}/suporte`,
    });
    await this.send(to, `Chamado #${ticketId} registrado — Viva Mais Club`, html);
  }

  /** Clube de Descontos liberado. */
  async sendClubeAccessReleased(to: string): Promise<void> {
    const html = this.kidsTeensShell({
      title: 'Clube de descontos | Viva Mais Club',
      heading: 'Seu acesso ao Clube de Descontos foi liberado!',
      bodyHtml:
        this.p('Agora você já pode aproveitar os benefícios exclusivos do Clube de Descontos Viva Mais Club.') +
        this.p(
          'Tenha acesso a ofertas especiais e condições diferenciadas em uma ampla rede de parceiros, com economia em produtos e serviços para facilitar o seu dia a dia.',
        ) +
        this.p('Basta acessar sua área do cliente para conhecer todas as vantagens disponíveis e começar a economizar.'),
      ctaLabel: 'Acessar Clube de Descontos →',
      ctaUrl: PORTAL_URL,
    });
    await this.send(to, 'Clube de Descontos liberado — Viva Mais Club', html);
  }

  /** Telemedicina + Telemedicina Pet liberadas. */
  async sendTelemedAccessReleased(to: string): Promise<void> {
    const html = this.kidsTeensShell({
      title: 'Acesso liberado | Viva Mais Club',
      heading: 'Seu acesso foi liberado!',
      bodyHtml:
        this.p(
          'Boas notícias! Seu acesso aos serviços de Telemedicina e Telemedicina Pet já está disponível no Viva Mais Club.',
        ) +
        this.p(
          'A partir de agora, você pode utilizar os serviços sempre que precisar, com praticidade, segurança e atendimento de qualidade para cuidar da sua saúde e também da saúde do seu pet.',
        ) +
        this.p('Basta acessar sua área do cliente para iniciar um atendimento ou consultar os serviços disponíveis.'),
      ctaLabel: 'Acessar Telemedicina →',
      ctaUrl: PORTAL_URL,
    });
    await this.send(to, 'Telemedicina liberada — Viva Mais Club', html);
  }

  /** Senha alterada — aviso de segurança. */
  async sendPasswordChanged(to: string): Promise<void> {
    const html = this.kidsTeensShell({
      title: 'Senha alterada | Viva Mais Club',
      heading: 'Sua nova senha foi criada com sucesso!',
      bodyHtml:
        this.p('Pronto! A senha da sua conta no Viva Mais Club foi atualizada.') +
        this.p(
          'A partir de agora, utilize sua nova senha para acessar a plataforma e aproveitar todos os benefícios disponíveis para você.',
        ) +
        this.p(
          'Caso você não reconheça esta alteração, entre em contato com nossa equipe de suporte imediatamente para proteger sua conta.',
        ),
      ctaLabel: 'Acessar minha conta →',
      ctaUrl: PORTAL_URL,
    });
    await this.send(to, 'Sua senha foi alterada — Viva Mais Club', html);
  }

  /** Boas-vindas — conta criada. */
  async sendWelcome(to: string): Promise<void> {
    const html = this.kidsTeensShell({
      title: 'Boas-vindas | Viva Mais Club',
      heading: 'Seja bem-vindo(a) ao Viva Mais Club!',
      bodyHtml:
        this.p('É uma alegria ter você conosco!') +
        this.p(
          'A partir de agora, você faz parte de um clube criado para tornar o cuidado com a saúde mais simples, acessível e presente no seu dia a dia.',
        ) +
        this.p(
          'Aqui, você conta com consultas por telemedicina, benefícios exclusivos e uma plataforma pensada para oferecer praticidade sempre que precisar.',
        ),
      ctaLabel: 'Conhecer minha área →',
      ctaUrl: PORTAL_URL,
    });
    await this.send(to, 'Bem-vindo(a) ao Viva Mais Club', html);
  }
}
