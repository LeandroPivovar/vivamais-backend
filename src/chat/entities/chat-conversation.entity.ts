import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { ChatMessage } from './chat-message.entity';

/** Uma conversa de chat ao vivo por usuário (com o suporte). */
@Entity('chat_conversations')
export class ChatConversation {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', unique: true })
  userId: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User | null;

  /** Mensagens não lidas para cada lado (bolinha azul). */
  @Column({ type: 'int', default: 0 })
  unreadForAdmin: number;

  @Column({ type: 'int', default: 0 })
  unreadForUser: number;

  // Status da conversa: 'aberto' | 'fechado'. Fechada pelo admin; apagada 1min depois.
  @Column({ type: 'varchar', length: 20, default: 'aberto' })
  status: string;

  @Column({ type: 'datetime', nullable: true })
  closedAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  lastMessageAt: Date | null;

  @OneToMany(() => ChatMessage, (m) => m.conversation)
  messages: ChatMessage[];

  @CreateDateColumn()
  createdAt: Date;
}
