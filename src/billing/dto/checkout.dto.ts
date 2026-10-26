import { IsEmail, IsIn, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { IsCpf } from '../../common/cpf';
import { IsBirthDate, normalizeBirthDate } from '../../common/birth-date';
import { Transform } from 'class-transformer';

export class CheckoutDto {
  @IsOptional()
  @IsString()
  refCode?: string;

  @IsIn(['Individual', 'Família'])
  planType: string;

  @IsOptional()
  @IsString()
  offer?: string;

  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  @MinLength(6, { message: "A senha deve ter no m?nimo 6 caracteres." })
  password?: string;

  // Normaliza para 11 dígitos (tira pontos/traço/espaços) e valida — evita CPF
  // formatado/inválido chegar no banco e nas integrações (Woovi/Vencca).
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\D/g, '') : value))
  @IsCpf()
  cpf: string;

  @IsString()
  phone: string;

  /** DD/MM/AAAA — exigido pela Vencca pro cadastro de associado. */
  @Transform(({ value }) => normalizeBirthDate(value) ?? value)
  @IsBirthDate()
  birthDate: string;

  @IsIn(['MASCULINO', 'FEMININO'])
  gender: string;

  @IsString()
  address: string;

  @IsString()
  neighborhood: string;

  @IsOptional()
  @IsString()
  complement?: string;

  @IsString()
  city: string;

  @IsString()
  state: string;

  @IsString()
  zipCode: string;

  @IsIn(['card', 'pix'])
  paymentMethod: string;

  @IsOptional()
  @IsString()
  cardNumber?: string;

  @IsOptional()
  @IsString()
  cardName?: string;

  @IsOptional()
  @IsString()
  cardExpiry?: string;

  @IsOptional()
  @IsString()
  cardCvv?: string;

  /** Token do cartão gerado no frontend (Pagar.me public key). Cartão nunca vem cru. */
  @IsOptional()
  @IsString()
  cardToken?: string;
}
