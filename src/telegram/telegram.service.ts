import { Injectable, Logger } from '@nestjs/common';

/**
 * Notificações no Telegram (bot @FinanceiroAlertBot).
 * - Venda confirmada  -> chat principal (TELEGRAM_CHAT_ID)
 * - Erro              -> chat principal + grupo de erros (TELEGRAM_ERROR_CHAT_ID)
 *
 * Tudo por env; se faltar token/chat, vira no-op (não quebra o fluxo).
 *   TELEGRAM_BOT_TOKEN=...
 *   TELEGRAM_CHAT_ID=...        (DM/canal das vendas)
 *   TELEGRAM_ERROR_CHAT_ID=...  (grupo de alertas de erro)
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  private get token(): string {
    return process.env.TELEGRAM_BOT_TOKEN ?? '';
  }
  private get chatId(): string {
    return process.env.TELEGRAM_CHAT_ID ?? '';
  }
  private get errorChatId(): string {
    return process.env.TELEGRAM_ERROR_CHAT_ID ?? '';
  }

  private nowBr(): string {
    return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  }

  private escape(v: string): string {
    return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private async send(chatId: string, text: string): Promise<void> {
    if (!this.token || !chatId) return;
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });
      if (!res.ok) {
        this.logger.warn(`Telegram sendMessage (${chatId}) falhou: HTTP ${res.status}`);
      }
    } catch (err) {
      this.logger.warn(`Telegram indisponível (${chatId}): ${(err as Error).message}`);
    }
  }

  /** Envia para todos os chats configurados (DM + grupo), sem duplicar. */
  private async broadcast(text: string): Promise<void> {
    const targets = [...new Set([this.chatId, this.errorChatId].filter(Boolean))];
    for (const chat of targets) await this.send(chat, text);
  }

  /** Venda confirmada. */
  async notifySale(d: {
    client: string;
    plan: string;
    value: number;
    method?: string;
    gateway?: string;
    platform?: string;
  }): Promise<void> {
    const value = `R$ ${Number(d.value).toFixed(2).replace('.', ',')}`;
    const text =
      `✅ <b>Venda confirmada</b>\n` +
      `🏷️ Plataforma: ${this.escape(d.platform ?? 'Viva Mais Club')}\n` +
      `👤 Cliente: ${this.escape(d.client)}\n` +
      `📦 Plano: ${this.escape(d.plan)}\n` +
      `💰 Valor: ${value}\n` +
      (d.method ? `💳 Pagamento: ${this.escape(d.method)}${d.gateway ? ` (${this.escape(d.gateway)})` : ''}\n` : '') +
      `🕒 ${this.nowBr()}`;
    await this.broadcast(text);
  }

  /** Pedido de saque de comissão — aguardando baixa no painel do admin. */
  async notifyWithdrawalRequested(d: {
    id: number;
    client: string;
    cpf?: string | null;
    value: number;
    pixKey?: string | null;
    pixKeyTypeLabel?: string | null;
    platform?: string;
  }): Promise<void> {
    const value = `R$ ${Number(d.value).toFixed(2).replace('.', ',')}`;
    const text =
      `🏦 <b>Saque solicitado</b>\n` +
      `🏷️ Plataforma: ${this.escape(d.platform ?? 'Viva Mais Club')}\n` +
      `🔖 Pedido: #${d.id}\n` +
      `👤 Cliente: ${this.escape(d.client)}\n` +
      (d.cpf ? `🪪 CPF: ${this.escape(d.cpf)}\n` : '') +
      `💰 Valor: ${value}\n` +
      (d.pixKey
        ? `🔑 Chave PIX (${this.escape(d.pixKeyTypeLabel ?? 'PIX')}): <code>${this.escape(d.pixKey)}</code>\n`
        : '') +
      `⏳ Status: Pendente — dar baixa na aba Saques\n` +
      `🕒 ${this.nowBr()}`;
    await this.broadcast(text);
  }

  /** Erro — vai pro chat principal E pro grupo de erros. */
  async notifyError(d: {
    context: string;
    detail: string;
    client?: string;
    value?: number;
    platform?: string;
  }): Promise<void> {
    const text =
      `⚠️ <b>Erro</b>\n` +
      `🏷️ Plataforma: ${this.escape(d.platform ?? 'Viva Mais Club')}\n` +
      `🔧 Contexto: ${this.escape(d.context)}\n` +
      (d.client ? `👤 Cliente: ${this.escape(d.client)}\n` : '') +
      (d.value != null ? `💰 Valor: R$ ${Number(d.value).toFixed(2).replace('.', ',')}\n` : '') +
      `❌ ${this.escape(d.detail)}\n` +
      `🕒 ${this.nowBr()}`;
    await this.broadcast(text);
  }
}
