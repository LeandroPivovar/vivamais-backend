import { IsEmail, IsIn, IsOptional, IsString } from 'class-validator';

export class CheckoutDto {
  @IsString()
  refCode: string;

  @IsIn(['Individual', 'Família'])
  planType: string;

  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
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
