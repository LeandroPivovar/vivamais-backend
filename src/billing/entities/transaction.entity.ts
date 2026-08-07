import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { DecimalTransformer } from '../../common/decimal.transformer';

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  userId: number;

  @ManyToOne(() => User, (user) => user.transactions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', length: 40 })
  plan: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, transformer: DecimalTransformer })
  value: number;

  @Column({ type: 'varchar', length: 30 })
  status: string;

  @Column({ type: 'varchar', length: 40, default: 'Cartão de Crédito' })
  paymentMethod: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0, transformer: DecimalTransformer })
  commissionMmn: number;

  // --- Rastreio no gateway ---
  // Qual gateway processou este lançamento: 'veenca' | 'woovi'.
  @Column({ type: 'varchar', length: 20, default: 'veenca' })
  gatewayProvider: string;

  // identifier/correlationID idempotente que enviamos ao gateway (casamos o webhook por ele).
  @Column({ type: 'varchar', length: 128, nullable: true })
  gatewayIdentifier: string | null;

  // transactionId/chargeId retornado pelo gateway.
  @Column({ type: 'varchar', length: 128, nullable: true })
  gatewayTransactionId: string | null;

  // subscriptionId/globalID da assinatura no gateway.
  @Column({ type: 'varchar', length: 128, nullable: true })
  gatewaySubscriptionId: string | null;

  // PIX copia-e-cola (só p/ exibir; não é dado sensível de cartão).
  @Column({ type: 'text', nullable: true })
  pixCode: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
