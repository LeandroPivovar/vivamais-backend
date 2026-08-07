import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTicketDto {
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  title: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  description: string;

  /** Print opcional em data URL (base64). Limite ~5MB de string. */
  @IsOptional()
  @IsString()
  @MaxLength(7_000_000)
  image?: string;
}
