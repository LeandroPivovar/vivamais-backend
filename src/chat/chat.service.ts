import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatConversation } from './entities/chat-conversation.entity';
import { ChatMessage } from './entities/chat-message.entity';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatConversation) private convRepo: Repository<ChatConversation>,
    @InjectRepository(ChatMessage) private msgRepo: Repository<ChatMessage>,
  ) {}

  /** Conversa do usuário (cria se não existir). Um chat por usuário. */
  async getOrCreateForUser(userId: number): Promise<ChatConversation> {
    let conv = await this.convRepo.findOne({ where: { userId } });
    if (!conv) conv = await this.convRepo.save(this.convRepo.create({ userId }));
    return conv;
  }

  async summary(conv: ChatConversation) {
    const withUser = conv.user
      ? conv
      : await this.convRepo.findOne({ where: { id: conv.id }, relations: ['user'] });
    const last = await this.msgRepo.findOne({
      where: { conversationId: conv.id },
      order: { createdAt: 'DESC' },
    });
    return {
      id: conv.id,
      userId: conv.userId,
      user: withUser?.user?.name ?? null,
      unreadForAdmin: conv.unreadForAdmin,
      unreadForUser: conv.unreadForUser,
      status: conv.status ?? 'aberto',
      lastMessageAt: conv.lastMessageAt,
      lastMessage: last?.body ?? null,
    };
  }

  private msg(m: ChatMessage) {
    return { id: m.id, conversationId: m.conversationId, senderRole: m.senderRole, body: m.body, createdAt: m.createdAt };
  }

  async messages(conversationId: number) {
    const list = await this.msgRepo.find({ where: { conversationId }, order: { createdAt: 'ASC' } });
    return list.map((m) => this.msg(m));
  }

  async listConversations() {
    const convs = await this.convRepo.find({ relations: ['user'], order: { lastMessageAt: 'DESC' } });
    return Promise.all(convs.map((c) => this.summary(c)));
  }

  async findConversation(id: number): Promise<ChatConversation> {
    const conv = await this.convRepo.findOne({ where: { id }, relations: ['user'] });
    if (!conv) throw new NotFoundException('Conversa não encontrada.');
    return conv;
  }

  /** Grava a mensagem e atualiza contadores de não-lidas do lado oposto. */
  async addMessage(conversationId: number, senderRole: 'user' | 'admin', body: string) {
    const conv = await this.findConversation(conversationId);
    const saved = await this.msgRepo.save(this.msgRepo.create({ conversationId, senderRole, body }));
    conv.lastMessageAt = saved.createdAt;
    if (senderRole === 'user') conv.unreadForAdmin += 1;
    else conv.unreadForUser += 1;
    await this.convRepo.save(conv);
    return { message: this.msg(saved), conversation: await this.summary(conv) };
  }

  async markRead(conversationId: number, role: 'user' | 'admin') {
    const conv = await this.findConversation(conversationId);
    if (role === 'admin') conv.unreadForAdmin = 0;
    else conv.unreadForUser = 0;
    await this.convRepo.save(conv);
    return this.summary(conv);
  }

  /** Admin encerra a conversa: marca fechada. Será apagada pelo cron ~1min depois. */
  async closeConversation(conversationId: number) {
    const conv = await this.findConversation(conversationId);
    conv.status = 'fechado';
    conv.closedAt = new Date();
    conv.unreadForAdmin = 0;
    await this.convRepo.save(conv);
    return this.summary(conv);
  }

  /**
   * Conversa ATIVA do usuário. Se a atual está fechada, apaga (mensagens em cascata)
   * e cria uma nova — assim o usuário recomeça um chat zerado ao mandar mensagem.
   */
  async getActiveConversationForUser(userId: number): Promise<ChatConversation> {
    const conv = await this.convRepo.findOne({ where: { userId } });
    if (!conv) return this.convRepo.save(this.convRepo.create({ userId }));
    if (conv.status === 'fechado') {
      await this.msgRepo.delete({ conversationId: conv.id });
      await this.convRepo.delete({ id: conv.id });
      return this.convRepo.save(this.convRepo.create({ userId }));
    }
    return conv;
  }

  /** Apaga conversas fechadas há mais de `seconds`. Retorna os ids apagados (p/ o gateway avisar o usuário). */
  async purgeClosed(seconds: number): Promise<number[]> {
    const threshold = new Date(Date.now() - seconds * 1000);
    const closed = await this.convRepo.find({ where: { status: 'fechado' } });
    const toPurge = closed.filter((c) => c.closedAt && c.closedAt <= threshold);
    const ids = toPurge.map((c) => c.id);
    for (const id of ids) {
      await this.msgRepo.delete({ conversationId: id });
      await this.convRepo.delete({ id });
    }
    return ids;
  }
}
