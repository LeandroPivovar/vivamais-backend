import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';
import { ReferralLink } from '../../referrals/entities/referral-link.entity';
import { Transaction } from '../../billing/entities/transaction.entity';
import { Activity } from '../../activities/entities/activity.entity';

export type UserRole = 'user' | 'admin';
export type UserStatus = 'ativo' | 'pendente' | 'inativo';
export type UserPlan = 'Bronze' | 'Individual' | 'Família' | 'Viva Mais Premium';
export type UserLevel =
  | 'Sem Nível (Diretor)'
  | '1º Nível'
  | '2º Nível'
  | '3º Nível'
  | '4º Nível'
  | '5º Nível';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'varchar', length: 150, unique: true })
  email: string;

  @Column({ type: 'varchar', length: 20, unique: true })
  cpf: string;

  @Column({ type: 'varchar', length: 100 })
  passwordHash: string;

  /** Código de recuperação de senha (6 dígitos) e sua expiração. Nulos fora do fluxo. */
  @Column({ type: 'varchar', length: 6, nullable: true })
  passwordResetCode: string | null;

  @Column({ type: 'datetime', nullable: true })
  passwordResetExpires: Date | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  phone: string | null;

  /** DD/MM/AAAA — mesmo formato que a Vencca exige, evita conversão nas duas pontas. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  birthDate: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  gender: 'MASCULINO' | 'FEMININO' | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  neighborhood: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  complement: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city: string | null;

  @Column({ type: 'varchar', length: 2, nullable: true })
  state: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  zipCode: string | null;

  @Column({ type: 'varchar', length: 40, default: 'Individual' })
  plan: UserPlan;

  @Column({ type: 'varchar', length: 40, default: 'Sem Nível (Diretor)' })
  level: UserLevel;

  @Column({ type: 'int', nullable: true })
  referredById: number | null;

  @ManyToOne(() => User, (user) => user.referrals, { nullable: true })
  @JoinColumn({ name: 'referredById' })
  referredBy: User | null;

  @OneToMany(() => User, (user) => user.referredBy)
  referrals: User[];

  /** Titular deste dependente. Null = conta titular própria; preenchido = é dependente. */
  @Column({ type: 'int', nullable: true })
  holderId: number | null;

  @ManyToOne(() => User, (user) => user.dependents, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'holderId' })
  holder: User | null;

  @OneToMany(() => User, (user) => user.holder)
  dependents: User[];

  @Column({ type: 'varchar', length: 10, default: 'user' })
  role: UserRole;

  @Column({ type: 'varchar', length: 10, default: 'ativo' })
  status: UserStatus;

  @Column({ type: 'boolean', default: false })
  accessHealth: boolean;

  @Column({ type: 'boolean', default: false })
  accessClube: boolean;

  @Column({ type: 'boolean', default: false })
  accessPet: boolean;

  @Column({ type: 'boolean', default: false })
  accessFuneral: boolean;

  /** Já cadastrado com sucesso na telemedicina (Vencca)? Usado pelo retry do cron. */
  @Column({ type: 'boolean', default: false })
  telemedRegistered: boolean;

  /** Tentativas de cadastro na telemedicina — o cron para após atingir o teto. */
  @Column({ type: 'int', default: 0 })
  telemedAttempts: number;

  @OneToMany(() => ReferralLink, (link) => link.user)
  links: ReferralLink[];

  @OneToMany(() => Transaction, (tx) => tx.user)
  transactions: Transaction[];

  @OneToMany(() => Activity, (activity) => activity.user)
  activities: Activity[];

  @CreateDateColumn()
  createdAt: Date;
}
