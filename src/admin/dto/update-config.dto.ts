import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

class ModuleConfigDto {
  @IsString()
  label: string;

  @IsNumber()
  price: number;

  @IsString()
  icon: string;
}

class ModulesDto {
  @ValidateNested()
  @Type(() => ModuleConfigDto)
  health: ModuleConfigDto;

  @ValidateNested()
  @Type(() => ModuleConfigDto)
  clube: ModuleConfigDto;

  @ValidateNested()
  @Type(() => ModuleConfigDto)
  pet: ModuleConfigDto;

  @ValidateNested()
  @Type(() => ModuleConfigDto)
  funeral: ModuleConfigDto;
}

export class UpdateConfigDto {
  @IsNumber()
  planBronzePrice: number;

  @IsNumber()
  planBronzeMmn: number;

  @IsNumber()
  planIndividualPrice: number;

  @IsNumber()
  planIndividualMmn: number;

  @IsNumber()
  planFamilyPrice: number;

  @IsNumber()
  planFamilyMmn: number;

  @IsNumber()
  planPremiumPrice: number;

  @IsNumber()
  planPremiumMmn: number;

  // Limite de dependentes por plano (opcionais — default 0 se omitidos).
  @IsOptional()
  @IsNumber()
  planBronzeDependents?: number;

  @IsOptional()
  @IsNumber()
  planIndividualDependents?: number;

  @IsOptional()
  @IsNumber()
  planFamilyDependents?: number;

  @IsOptional()
  @IsNumber()
  planPremiumDependents?: number;

  @IsArray()
  percentages: number[];

  @ValidateNested()
  @Type(() => ModulesDto)
  modules: ModulesDto;

  // --- Gateway de pagamento Veenca ---
  // Opcionais: o form de planos/módulos salva sem tocar no gateway.
  @IsOptional()
  @IsBoolean()
  veencaPayEnabled?: boolean;

  @IsOptional()
  @IsString()
  veencaPublicKey?: string;

  /** Vazio ou mascarado (••••) = manter a chave já gravada. Ver AdminService.updateConfig. */
  @IsOptional()
  @IsString()
  veencaSecretKey?: string;

  @IsOptional()
  @IsString()
  veencaPeriodicityType?: string;

  @IsOptional()
  @IsString()
  veencaProductIndividual?: string;

  @IsOptional()
  @IsString()
  veencaProductFamily?: string;

  // --- Woovi/OpenPix — Pix Automático ---
  @IsOptional()
  @IsString()
  activeGateway?: string;

  @IsOptional()
  @IsBoolean()
  wooviEnabled?: boolean;

  /** Vazio ou mascarado (••••) = manter o AppID já gravado. Ver AdminService.updateConfig. */
  @IsOptional()
  @IsString()
  wooviAppId?: string;

  @IsOptional()
  @IsBoolean()
  wooviSandbox?: boolean;

  // --- Pagar.me (cartão de crédito) ---
  @IsOptional()
  @IsBoolean()
  pagarmeEnabled?: boolean;

  /** Vazio ou mascarado (••••) = manter a secret key gravada. */
  @IsOptional()
  @IsString()
  pagarmeSecretKey?: string;

  @IsOptional()
  @IsString()
  pagarmePublicKey?: string;

  // --- Clube de Descontos (Clube Certo) ---
  @IsOptional()
  @IsBoolean()
  clubeCertoEnabled?: boolean;

  @IsOptional()
  @IsString()
  clubeCertoCnpj?: string;

  /** Vazio = manter a senha já gravada. Ver AdminService.updateConfig. */
  @IsOptional()
  @IsString()
  clubeCertoPassword?: string;

  @IsOptional()
  @IsString()
  clubeCertoCompanyId?: string;
}
