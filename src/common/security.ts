const DEFAULT_JWT_SECRET = 'change-me-in-production';

export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret && secret !== DEFAULT_JWT_SECRET) return secret;

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET obrigatório em produção.');
  }

  return DEFAULT_JWT_SECRET;
}
