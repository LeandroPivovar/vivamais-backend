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

  /** Bônus de R$30 do primeiro mês de indicação nova (0 se não veio de indicação ou é renovação). */
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0, transformer: DecimalTransformer })
  referralBonus: number;

  /** Quando o lembrete de pagamento pendente foi enviado — nulo = ainda não enviamos. */
  @Column({ type: 'datetime', nullable: true })
  pendingReminderAt: Date | null;

  /** Quando o webhook de carrinho abandonado (MassFlow) foi disparado — nulo = não disparado. */
  @Column({ type: 'datetime', nullable: true })
  cartWebhookAt: Date | null;

  /** TikTok custom AbandonedCart: delivery marker independent of MassFlow. */
  @Column({ type: 'datetime', nullable: true })
  tiktokCartEventAt: Date | null;

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

  // --- Oferta de 1º mês (link de oferta) ---
  // Valor das mensalidades SEGUINTES quando `value` é o preço promocional do 1º mês.
  // Nulo = assinatura normal (todas as cobranças valem `value`). Renovações usam este valor.
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true, transformer: DecimalTransformer })
  recurringValue: number | null;

  // Link de oferta que originou a venda (conta o uso quando o pagamento confirma).
  @Column({ type: 'int', nullable: true })
  promoLinkId: number | null;

  // Quando a assinatura Woovi passou para o preço cheio depois do 1º pagamento.
  // Nulo com recurringValue preenchido e pagamento confirmado = troca pendente (cron tenta de novo).
  @Column({ type: 'datetime', nullable: true })
  recurringValueSyncedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
