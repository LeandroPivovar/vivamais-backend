import { IsIn, IsOptional, IsString } from 'class-validator';

/** Pagamento avulso da assinatura do usuário logado (renovação manual pelo painel). */
export class PayDto {
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

  /** Token do cartão (Pagar.me public key, gerado no frontend). */
  @IsOptional()
  @IsString()
  cardToken?: string;
}
