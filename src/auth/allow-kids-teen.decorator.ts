import { SetMetadata } from '@nestjs/common';

export const ALLOW_KIDS_TEEN_KEY = 'allowKidsTeen';

/** Libera uma rota para tokens de escopo restrito (login CPF-only do Kids/Teen). */
export const AllowKidsTeen = () => SetMetadata(ALLOW_KIDS_TEEN_KEY, true);
