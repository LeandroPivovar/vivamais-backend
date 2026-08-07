import { IsIn, IsString } from 'class-validator';

export class UpdateLinkDto {
  @IsString()
  name: string;

  @IsIn(['Bronze', 'Individual', 'Família'])
  planType: string;

  @IsString()
  refCode: string;

  @IsIn(['Ativo', 'Inativo'])
  status: string;
}
