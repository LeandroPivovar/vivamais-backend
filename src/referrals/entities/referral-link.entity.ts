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

@Entity('referral_links')
export class ReferralLink {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  userId: number;

  @ManyToOne(() => User, (user) => user.links, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 30 })
  planType: string;

  @Column({ type: 'varchar', length: 200 })
  desc: string;

  @Column({ type: 'varchar', length: 30 })
  price: string;

  @Column({ type: 'varchar', length: 40 })
  payment: string;

  @Column({ type: 'varchar', length: 300 })
  url: string;

  @Column({ type: 'int', default: 0 })
  cliques: number;

  @Column({ type: 'int', default: 0 })
  conversoes: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0, transformer: DecimalTransformer })
  comissao: number;

  /** Bônus de R$30 do primeiro mês de indicações novas (a partir da introdução da regra). */
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0, transformer: DecimalTransformer })
  bonusTotal: number;

  @Column({ type: 'varchar', length: 10, default: 'Ativo' })
  status: string;

  @CreateDateColumn()
  createdAt: Date;
}
