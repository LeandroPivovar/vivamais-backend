import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { DecimalTransformer } from '../../common/decimal.transformer';

/**
 * Link de oferta criado no admin: página de compra com valor promocional no 1º mês
 * (/oferta/<slug>). Do 2º mês em diante cobra o preço cheio do plano.
 * Limites opcionais: data de validade e/ou número máximo de usos (pagamentos confirmados).
 */
@Entity('promo_links')
export class PromoLink {
  @PrimaryGeneratedColumn()
  id: number;

  // Fim da URL escolhido pelo admin: só a-z, 0-9 e hífen.
  @Column({ type: 'varchar', length: 60, unique: true })
  slug: string;

  @Column({ type: 'varchar', length: 40 })
  plan: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, transformer: DecimalTransformer })
  firstMonthPrice: number;

  // Nulo = sem limite de usos.
  @Column({ type: 'int', nullable: true })
  maxUses: number | null;

  // Vendas confirmadas por este link.
  @Column({ type: 'int', default: 0 })
  usesCount: number;

  // Nulo = não expira.
  @Column({ type: 'datetime', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  // Pixels da campanha carregados só na página deste link (nulo = só os pixels do site).
  @Column({ type: 'varchar', length: 40, nullable: true })
  metaPixelId: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  tiktokPixelId: string | null;

  @Column({ type: 'int', nullable: true })
  createdById: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
