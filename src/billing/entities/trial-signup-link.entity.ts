import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('trial_signup_links')
export class TrialSignupLink {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 80, unique: true })
  token: string;

  @Column({ type: 'varchar', length: 40 })
  plan: 'Individual' | 'Família';

  @Column({ type: 'int', nullable: true })
  createdById: number | null;

  @Column({ type: 'int', nullable: true })
  usedById: number | null;

  @Column({ type: 'datetime', nullable: true })
  usedAt: Date | null;

  @Column({ type: 'varchar', length: 20, default: 'active' })
  status: 'active' | 'used' | 'cancelled';

  @CreateDateColumn()
  createdAt: Date;
}
