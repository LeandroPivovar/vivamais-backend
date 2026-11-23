import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Histórico das notificações que o admin mandou para todos os celulares de um app. */
@Entity('push_broadcasts')
export class PushBroadcast {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 20 })
  app: string;

  @Column({ type: 'varchar', length: 80 })
  title: string;

  @Column({ type: 'varchar', length: 300 })
  body: string;

  // Celulares cadastrados no envio e quantos o Firebase aceitou.
  @Column({ type: 'int', default: 0 })
  total: number;

  @Column({ type: 'int', default: 0 })
  sent: number;

  @Column({ type: 'int', nullable: true })
  createdById: number | null;

  @CreateDateColumn()
  createdAt: Date;
}
