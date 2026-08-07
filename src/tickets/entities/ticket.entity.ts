import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { TicketMessage } from './ticket-message.entity';

/** enviado = aguardando o suporte | respondido = admin respondeu | fechado = encerrado. */
export type TicketStatus = 'enviado' | 'respondido' | 'fechado';

@Entity('tickets')
export class Ticket {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  userId: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User | null;

  @Column({ type: 'varchar', length: 150 })
  title: string;

  @Column({ type: 'varchar', length: 20, default: 'enviado' })
  status: TicketStatus;

  @OneToMany(() => TicketMessage, (m) => m.ticket)
  messages: TicketMessage[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
