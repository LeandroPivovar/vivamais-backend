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

/** pendente = aguardando o admin dar baixa | pago = saque efetuado. */
export type WithdrawalStatus = 'pendente' | 'pago';

/** Tipos de chave PIX aceitos no pedido de saque. */
export type PixKeyType = 'cpf' | 'email' | 'telefone' | 'aleatoria';

@Entity('withdrawals')
export class Withdrawal {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  userId: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User | null;

  /** Valor congelado no momento do pedido (o saldo pode render mais depois). */
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0, transformer: DecimalTransformer })
  amount: number;

  @Column({ type: 'varchar', length: 20, default: 'pendente' })
  status: WithdrawalStatus;

  /** Chave PIX de destino — nula nos pedidos anteriores à criação do campo. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  pixKeyType: PixKeyType | null;

  @Column({ type: 'varchar', length: 140, nullable: true })
  pixKey: string | null;

  @Column({ type: 'datetime', nullable: true })
  paidAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
