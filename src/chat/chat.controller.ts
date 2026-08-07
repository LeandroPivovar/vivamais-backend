import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ChatService } from './chat.service';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private chat: ChatService) {}

  /** Conversa do usuário logado + histórico (carga inicial; o tempo real vem via WS). */
  @Get()
  async mine(@CurrentUser() u: { id: number }) {
    const conv = await this.chat.getOrCreateForUser(u.id);
    return {
      conversation: await this.chat.summary(conv),
      messages: await this.chat.messages(conv.id),
    };
  }

  @Post('read')
  async read(@CurrentUser() u: { id: number }) {
    const conv = await this.chat.getOrCreateForUser(u.id);
    return this.chat.markRead(conv.id, 'user');
  }
}
