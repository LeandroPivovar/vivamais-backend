import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../users/entities/user.entity';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { MailService } from '../mail/mail.service';

const RESET_CODE_TTL_MIN = 15;

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private usersRepo: Repository<User>,
    private jwtService: JwtService,
    private mailService: MailService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.usersRepo.findOne({
      where: [{ email: dto.username }, { cpf: dto.username }],
    });
    if (!user) throw new UnauthorizedException('Credenciais inválidas.');

    const passwordOk = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordOk) throw new UnauthorizedException('Credenciais inválidas.');

    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        plan: user.plan,
        active: user.status === 'ativo',
        role: user.role,
        isDependent: user.holderId != null,
      },
    };
  }

  /**
   * Gera e envia um código de 6 dígitos por e-mail. Resposta é sempre genérica —
   * não revela se o e-mail existe (evita enumeração de contas).
   */
  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.usersRepo.findOne({ where: { email: dto.email } });
    if (user) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expires = new Date();
      expires.setMinutes(expires.getMinutes() + RESET_CODE_TTL_MIN);
      user.passwordResetCode = code;
      user.passwordResetExpires = expires;
      await this.usersRepo.save(user);
      await this.mailService.sendPasswordResetCode(user.email, user.name, code);
    }
    return {
      success: true,
      message: 'Se o e-mail estiver cadastrado, enviaremos um código de recuperação.',
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const user = await this.usersRepo.findOne({ where: { email: dto.email } });
    if (
      !user ||
      !user.passwordResetCode ||
      !user.passwordResetExpires ||
      user.passwordResetCode !== dto.code ||
      user.passwordResetExpires.getTime() < Date.now()
    ) {
      throw new BadRequestException('Código inválido ou expirado.');
    }

    user.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    user.passwordResetCode = null;
    user.passwordResetExpires = null;
    await this.usersRepo.save(user);
    return { success: true, message: 'Senha redefinida com sucesso.' };
  }
}
