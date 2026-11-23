import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** Celular com o app instalado que recebe notificação push (token do Firebase Cloud Messaging). */
@Entity('push_devices')
export class PushDevice {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'int' })
  userId: number;

  // Um token pertence a um único celular; se outra conta logar nele, o dono muda.
  @Column({ type: 'varchar', length: 255, unique: true })
  token: string;

  @Column({ type: 'varchar', length: 20, default: 'android' })
  platform: string;

  // Qual app está no celular: vivamais (titular), kids ou teens.
  @Index()
  @Column({ type: 'varchar', length: 20, default: 'vivamais' })
  app: string;

  @CreateDateColumn()
  createdAt: Date;

  // Atualizado a cada registro do app (login/abertura).
  @UpdateDateColumn()
  updatedAt: Date;
}
