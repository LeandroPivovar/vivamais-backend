import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, Matches, MaxLength, Min } from 'class-validator';

/** Link de oferta (/oferta/<slug>): 1º mês promocional, depois o preço cheio do plano. */
export class CreatePromoLinkDto {
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'O fim da URL aceita só letras minúsculas, números e hífen (ex.: black-friday).',
  })
  @MaxLength(60, { message: 'O fim da URL pode ter no máximo 60 caracteres.' })
  slug: string;

  @IsIn(['Individual', 'Família'], { message: 'Plano inválido.' })
  plan: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor do 1º mês inválido.' })
  @Min(1, { message: 'O valor do 1º mês precisa ser de pelo menos R$ 1,00.' })
  firstMonthPrice: number;

  /** Vazio = sem limite de vendas. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'O limite de usos precisa ser um número inteiro.' })
  @Min(1, { message: 'O limite de usos precisa ser pelo menos 1.' })
  maxUses?: number | null;

  /** Vazio = não expira. ISO 8601. */
  @IsOptional()
  @IsDateString({}, { message: 'Data de validade inválida.' })
  expiresAt?: string | null;
}
