import { IsEmail, IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class CheckoutDto {
  @IsString()
  refCode: string;

  @IsIn(['Individual', 'Família'])
  planType: string;

  @IsString()
  name: string;

  @IsEmail()
  email: string;

  // Normaliza para 11 dígitos (tira pontos/traço/espaços) e valida — evita CPF
  // formatado/inválido chegar no banco e nas integrações (Woovi/Vencca).
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\D/g, '') : value))
  @Matches(/^\d{11}$/, { message: 'CPF inválido: informe os 11 dígitos.' })
  cpf: string;

  @IsString()
  phone: string;

  /** DD/MM/AAAA — exigido pela Vencca pro cadastro de associado. */
  @IsString()
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
