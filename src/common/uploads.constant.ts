import { join } from 'path';

/**
 * Pasta onde os anexos (prints de ticket etc.) são gravados em disco.
 * Fica FORA da pasta do backend (irmã), então sobrevive aos redeploys (tar) do
 * backend e do frontend. Em produção: /var/www/acesso-saude/uploads.
 * Servida estaticamente em /api/uploads/ (ver main.ts).
 */
export const UPLOADS_DIR = process.env.UPLOADS_DIR ?? join(process.cwd(), '..', 'uploads');

/** Prefixo público (mesma origem, passa pelo proxy /api/ do nginx). */
export const UPLOADS_PUBLIC_PREFIX = '/api/uploads/';
