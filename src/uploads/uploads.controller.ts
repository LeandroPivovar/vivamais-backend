import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { extname } from 'path';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UPLOADS_DIR, UPLOADS_PUBLIC_PREFIX } from '../common/uploads.constant';

// multer não expõe tipos por padrão aqui — importa via require p/ não exigir @types/multer.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { diskStorage } = require('multer');

const ALLOWED = /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$|^application\/pdf$/;

/**
 * Upload de anexos (prints de ticket, etc.). Grava o arquivo em disco (UPLOADS_DIR)
 * e devolve o caminho público — só o caminho é guardado no banco, nunca o base64.
 */
@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOADS_DIR,
        filename: (_req: any, file: any, cb: any) => {
          const ext = (extname(file.originalname || '') || '').toLowerCase().replace(/[^a-z0-9.]/g, '');
          cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
        },
      }),
      limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
      fileFilter: (_req: any, file: any, cb: any) => {
        if (ALLOWED.test(file.mimetype)) return cb(null, true);
        cb(new BadRequestException('Tipo de arquivo não permitido (só imagem ou PDF).'), false);
      },
    }),
  )
  upload(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException('Nenhum arquivo enviado.');
    return { url: `${UPLOADS_PUBLIC_PREFIX}${file.filename}`, name: file.originalname, mime: file.mimetype };
  }
}
