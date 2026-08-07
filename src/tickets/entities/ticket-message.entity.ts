import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';
import { Ticket } from './ticket.entity';

@Entity('ticket_messages')
export class TicketMessage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  ticketId: number;

  @ManyToOne(() => Ticket, (t) => t.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticketId' })
  ticket: Ticket;

  /** Quem enviou: 'user' (autor do ticket) ou 'admin' (suporte). */
  @Column({ type: 'varchar', length: 10 })
  senderRole: 'user' | 'admin';

  @Column({ type: 'text' })
  body: string;

  /** Print/anexo em data URL (base64). Nulo quando não há imagem. */
  @Column({ type: 'longtext', nullable: true })
  image: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
