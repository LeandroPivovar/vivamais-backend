const DEFAULT_PRIMARY_ORIGIN = 'https://conta.vivamaisclub.net';
const DEFAULT_COMPAT_ORIGINS = ['https://conta.vivamaisclub.com'];

function normalizeOrigin(value: string | undefined | null): string | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return `${url.protocol}//${url.host}`.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function listFromEnv(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((part) => normalizeOrigin(part))
    .filter((part): part is string => !!part);
}

export function publicBaseOrigin(): string {
  return (
    normalizeOrigin(process.env.PUBLIC_URL) ??
    normalizeOrigin(process.env.PRIMARY_PUBLIC_URL) ??
    DEFAULT_PRIMARY_ORIGIN
  );
}

export function publicCompatOrigins(): string[] {
  return [
    publicBaseOrigin(),
    ...DEFAULT_COMPAT_ORIGINS,
    ...listFromEnv('PUBLIC_URLS'),
    ...listFromEnv('PUBLIC_COMPAT_ORIGINS'),
  ].filter((origin, index, arr) => arr.indexOf(origin) === index);
}

export function corsAllowedOrigins(): string[] {
  return [
    ...publicCompatOrigins(),
    ...listFromEnv('CORS_ORIGIN'),
  ].filter((origin, index, arr) => arr.indexOf(origin) === index);
}

export function publicUrl(path = ''): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${publicBaseOrigin()}${suffix}`;
}

export function withPublicOrigin(url: string, origin = publicBaseOrigin()): string {
  try {
    const parsed = new URL(url);
    return `${origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return publicUrl(url);
  }
}
