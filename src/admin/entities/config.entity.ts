import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { DecimalTransformer } from '../../common/decimal.transformer';

export interface ModuleConfig {
  label: string;
  price: number;
  icon: string;
}

@Entity('app_config')
export class AppConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 39.9, transformer: DecimalTransformer })
  planBronzePrice: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 10.0, transformer: DecimalTransformer })
  planBronzeMmn: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 79.9, transformer: DecimalTransformer })
  planIndividualPrice: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 20.0, transformer: DecimalTransformer })
  planIndividualMmn: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 129.9, transformer: DecimalTransformer })
  planFamilyPrice: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 50.0, transformer: DecimalTransformer })
  planFamilyMmn: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 199.9, transformer: DecimalTransformer })
  planPremiumPrice: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 60.0, transformer: DecimalTransformer })
  planPremiumMmn: number;

  // Quantos dependentes cada plano permite (configurado pelo Admin).
  @Column({ type: 'int', default: 0 })
  planBronzeDependents: number;

  @Column({ type: 'int', default: 0 })
  planIndividualDependents: number;

  @Column({ type: 'int', default: 0 })
  planFamilyDependents: number;

  @Column({ type: 'int', default: 0 })
  planPremiumDependents: number;

  @Column({ type: 'json' })
  percentages: number[];

  @Column({ type: 'json' })
  modules: {
    health: ModuleConfig;
    clube: ModuleConfig;
    pet: ModuleConfig;
    funeral: ModuleConfig;
  };

  // --- Gateway de pagamento Veenca (configurado pelo Admin) ---
  @Column({ type: 'boolean', default: false })
  veencaPayEnabled: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  veencaPublicKey: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  veencaSecretKey: string | null;

  // periodicityType da assinatura Veenca. Enum aceito: DAYS | WEEKS | MONTHS | YEARS.
  @Column({ type: 'varchar', length: 20, default: 'MONTHS' })
  veencaPeriodicityType: string;

  // IDs de produto na Veenca (assinatura PIX recorrente), por plano.
  @Column({ type: 'varchar', length: 64, nullable: true })
  veencaProductIndividual: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  veencaProductFamily: string | null;

  // --- Woovi/OpenPix — Pix Automático (débito automático) ---
  // Qual gateway processa as cobranças: 'veenca' (padrão) ou 'woovi'.
  @Column({ type: 'varchar', length: 20, default: 'veenca' })
  activeGateway: string;

  @Column({ type: 'boolean', default: false })
  wooviEnabled: boolean;

  // AppID da Woovi (base64 clientId:clientSecret) — enviado cru no header Authorization.
  @Column({ type: 'varchar', length: 255, nullable: true })
  wooviAppId: string | null;

  // Usa o ambiente sandbox da Woovi (api.woovi-sandbox.com) quando true.
  @Column({ type: 'boolean', default: false })
  wooviSandbox: boolean;

  // --- Pagar.me — cartão de crédito (recorrente) em todos os checkouts ---
  @Column({ type: 'boolean', default: false })
  pagarmeEnabled: boolean;

  // Secret key (sk_...) — Basic auth. Nunca sai do servidor (mascarada na API do admin).
  @Column({ type: 'varchar', length: 255, nullable: true })
  pagarmeSecretKey: string | null;

  // Public key (pk_...) — usada no frontend p/ tokenizar o cartão (não é segredo).
  @Column({ type: 'varchar', length: 255, nullable: true })
  pagarmePublicKey: string | null;

  // --- Clube de Descontos (Clube Certo) — configurado pelo Admin ---
  @Column({ type: 'boolean', default: false })
  clubeCertoEnabled: boolean;

  @Column({ type: 'varchar', length: 20, nullable: true })
  clubeCertoCnpj: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  clubeCertoPassword: string | null;

  // companyId do Clube Certo (usado na carteira de cashback via webapp).
  @Column({ type: 'varchar', length: 40, nullable: true })
  clubeCertoCompanyId: string | null;
}
