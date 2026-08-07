import { IsIn, IsString } from 'class-validator';

export class CreateLinkDto {
  @IsIn(['Bronze', 'Individual', 'Família'])
  planType: string;

  @IsString()
  refCode: string;

  @IsIn(['ambos', 'cartao', 'pix'])
  paymentMethod: string;
}
