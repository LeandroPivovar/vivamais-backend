import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ticket } from './entities/ticket.entity';
import { TicketMessage } from './entities/ticket-message.entity';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { AddMessageDto } from './dto/add-message.dto';
import { NotificationsService } from '../notifications/notifications.service';

const STATUS_LABELS: Record<string, string> = {
  enviado: 'Enviado',
  respondido: 'Respondido',
  fechado: 'Fechado',
};

@Injectable()
export class TicketsService {
  constructor(
    @InjectRepository(Ticket) private ticketsRepo: Repository<Ticket>,
    @InjectRepository(TicketMessage) private messagesRepo: Repository<TicketMessage>,
    private notifications: NotificationsService,
  ) {}

  private summary(t: Ticket, extra?: { userName?: string; lastMessageAt?: Date }) {
    return {
      id: t.id,
      title: t.title,
      status: t.status,
      statusLabel: STATUS_LABELS[t.status] ?? t.status,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      user: extra?.userName ?? t.user?.name ?? null,
    };
  }

  private messageResponse(m: TicketMessage) {
    return {
      id: m.id,
      senderRole: m.senderRole,
      body: m.body,
      image: m.image ?? null,
      createdAt: m.createdAt,
    };
  }

  // ---- Usuário ----

  async create(userId: number, dto: CreateTicketDto) {
    const ticket = await this.ticketsRepo.save(
      this.ticketsRepo.create({ userId, title: dto.title, status: 'enviado' }),
    );
    await this.messagesRepo.save(
      this.messagesRepo.create({
        ticketId: ticket.id,
        senderRole: 'user',
        body: dto.description,
        image: dto.image ?? null,
      }),
    );
    const withUser = await this.ticketsRepo.findOne({ where: { id: ticket.id }, relations: ['user'] });
    void this.notifications.notifyTicketOpened({
      id: ticket.id,
      title: ticket.title,
      user: withUser?.user?.name ?? null,
      status: ticket.status,
    });
    return this.summary(ticket);
  }

  async listForUser(userId: number) {
    const tickets = await this.ticketsRepo.find({ where: { userId }, order: { updatedAt: 'DESC' } });
    return tickets.map((t) => this.summary(t));
  }

  async getForUser(userId: number, id: number) {
    const ticket = await this.ticketsRepo.findOne({ where: { id }, relations: ['user'] });
    if (!ticket) throw new NotFoundException('Ticket não encontrado.');
    if (ticket.userId !== userId) throw new ForbiddenException('Esse ticket não é seu.');
    return this.detail(ticket);
  }

  async addUserMessage(userId: number, id: number, dto: AddMessageDto) {
    const ticket = await this.ticketsRepo.findOne({ where: { id }, relations: ['user'] });
    if (!ticket) throw new NotFoundException('Ticket não encontrado.');
    if (ticket.userId !== userId) throw new ForbiddenException('Esse ticket não é seu.');
    if (ticket.status === 'fechado') throw new ForbiddenException('Ticket fechado. Abra um novo para continuar.');
    const res = await this.addMessage(ticket, 'user', dto, 'enviado');
    void this.notifications.notifyTicketUpdated({
      id: ticket.id,
      title: ticket.title,
      user: ticket.user?.name ?? null,
      status: 'enviado',
      action: 'Nova mensagem do cliente',
    });
    return res;
  }

  // ---- Admin ----

  async listAll() {
    const tickets = await this.ticketsRepo.find({ relations: ['user'], order: { updatedAt: 'DESC' } });
    return tickets.map((t) => this.summary(t));
  }

  async getAny(id: number) {
    const ticket = await this.ticketsRepo.findOne({ where: { id }, relations: ['user'] });
    if (!ticket) throw new NotFoundException('Ticket não encontrado.');
    return this.detail(ticket);
  }

  async addAdminMessage(id: number, dto: AddMessageDto) {
    const ticket = await this.ticketsRepo.findOne({ where: { id }, relations: ['user'] });
    if (!ticket) throw new NotFoundException('Ticket não encontrado.');
    return this.addMessage(ticket, 'admin', dto, 'respondido');
  }

  async setStatus(id: number, status: 'enviado' | 'respondido' | 'fechado') {
    const ticket = await this.ticketsRepo.findOne({ where: { id }, relations: ['user'] });
    if (!ticket) throw new NotFoundException('Ticket não encontrado.');
    ticket.status = status;
    await this.ticketsRepo.save(ticket);
    void this.notifications.notifyTicketUpdated({
      id: ticket.id,
      title: ticket.title,
      user: ticket.user?.name ?? null,
      status,
      action: `Status alterado para ${STATUS_LABELS[status] ?? status}`,
    });
    return this.detail(ticket);
  }

  // ---- Interno ----

  private async addMessage(
    ticket: Ticket,
    senderRole: 'user' | 'admin',
    dto: AddMessageDto,
    newStatus: 'enviado' | 'respondido',
  ) {
    await this.messagesRepo.save(
      this.messagesRepo.create({
        ticketId: ticket.id,
        senderRole,
        body: dto.body,
        image: dto.image ?? null,
      }),
    );
    ticket.status = newStatus;
    await this.ticketsRepo.save(ticket); // atualiza updatedAt + status
    return this.detail(ticket);
  }

  private async detail(ticket: Ticket) {
    const messages = await this.messagesRepo.find({
      where: { ticketId: ticket.id },
      order: { createdAt: 'ASC' },
    });
    return {
      ...this.summary(ticket),
      messages: messages.map((m) => this.messageResponse(m)),
    };
  }
}
