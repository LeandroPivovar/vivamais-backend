import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';
import { ChatConversation } from './chat-conversation.entity';

@Entity('chat_messages')
export class ChatMessage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  conversationId: number;

  @ManyToOne(() => ChatConversation, (c) => c.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversationId' })
  conversation: ChatConversation;

  @Column({ type: 'varchar', length: 10 })
  senderRole: 'user' | 'admin';

  @Column({ type: 'text' })
  body: string;

  @CreateDateColumn()
  createdAt: Date;
}
