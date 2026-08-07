import {
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';

/**
 * Chat em tempo real (socket.io). Autentica pelo JWT no handshake (auth.token).
 * Rooms: `conv:{id}` (participantes de uma conversa) e `admins` (todos os admins,
 * recebem atualização de lista + contador de não-lidas / bolinha azul).
 */
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class ChatGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;

  constructor(
    private readonly chat: ChatService,
    private readonly jwt: JwtService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth as any)?.token || (client.handshake.query as any)?.token;
      const payload: any = this.jwt.verify(token);
      client.data.userId = payload.sub;
      client.data.role = payload.role;
      if (payload.role === 'admin') {
        client.join('admins');
      } else {
        const conv = await this.chat.getOrCreateForUser(payload.sub);
        client.data.convId = conv.id;
        client.join(`conv:${conv.id}`);
      }
    } catch {
      client.disconnect(true);
    }
  }

  @SubscribeMessage('chat:send')
  async onSend(client: Socket, payload: { body: string; conversationId?: number }) {
    const body = (payload?.body ?? '').toString().trim();
    if (!body) return;

    let convId: number | undefined;
    let senderRole: 'user' | 'admin';
    if (client.data.role === 'admin') {
      convId = payload?.conversationId;
      senderRole = 'admin';
      if (!convId) return;
      client.join(`conv:${convId}`);
    } else {
      // Se a conversa atual foi encerrada, o service apaga e cria uma nova — chat zerado.
      const active = await this.chat.getActiveConversationForUser(client.data.userId);
      if (active.id !== client.data.convId) {
        if (client.data.convId) client.leave(`conv:${client.data.convId}`);
        client.join(`conv:${active.id}`);
        client.data.convId = active.id;
        client.emit('chat:reset', { conversationId: active.id });
      }
      convId = active.id;
      senderRole = 'user';
    }
    if (!convId) return;

    const { message, conversation } = await this.chat.addMessage(convId, senderRole, body);
    this.server.to(`conv:${convId}`).emit('chat:message', { conversationId: convId, message });
    this.server.to('admins').emit('chat:conversation', conversation);
    return message;
  }

  /** Admin encerra a conversa: avisa o usuário e atualiza a lista dos admins. */
  @SubscribeMessage('chat:close')
  async onClose(client: Socket, payload: { conversationId: number }) {
    if (client.data.role !== 'admin' || !payload?.conversationId) return;
    const conv = await this.chat.closeConversation(payload.conversationId);
    this.server.to(`conv:${payload.conversationId}`).emit('chat:closed', { conversationId: payload.conversationId });
    this.server.to('admins').emit('chat:conversation', conv);
    return conv;
  }

  /** A cada minuto apaga as conversas encerradas há +1min e avisa o usuário (chat zera). */
  @Cron(CronExpression.EVERY_MINUTE)
  async purgeClosedChats() {
    const ids = await this.chat.purgeClosed(60);
    for (const id of ids) {
      this.server.to(`conv:${id}`).emit('chat:purged', { conversationId: id });
    }
  }

  /** Admin abre uma conversa: entra na sala e zera as não-lidas do admin. */
  @SubscribeMessage('chat:join')
  async onJoin(client: Socket, payload: { conversationId: number }) {
    if (client.data.role !== 'admin' || !payload?.conversationId) return;
    client.join(`conv:${payload.conversationId}`);
    const conv = await this.chat.markRead(payload.conversationId, 'admin');
    this.server.to('admins').emit('chat:conversation', conv);
    return conv;
  }

  @SubscribeMessage('chat:read')
  async onRead(client: Socket, payload: { conversationId?: number }) {
    const role: 'user' | 'admin' = client.data.role === 'admin' ? 'admin' : 'user';
    const convId = role === 'admin' ? payload?.conversationId : client.data.convId;
    if (!convId) return;
    const conv = await this.chat.markRead(convId, role);
    if (role === 'admin') this.server.to('admins').emit('chat:conversation', conv);
    return conv;
  }
}
