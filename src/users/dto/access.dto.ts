import { IsBoolean } from 'class-validator';

export class AccessDto {
  @IsBoolean()
  health: boolean;

  @IsBoolean()
  clube: boolean;

  @IsBoolean()
  pet: boolean;

  @IsBoolean()
  funeral: boolean;
}
