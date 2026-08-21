import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../users/entities/user.entity';
import { LoginDto } from './dto/login.dto';
import { CpfLoginDto } from './dto/cpf-login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { MailService } from '../mail/mail.service';
import { ageGroup } from '../common/age';

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
   * Login exclusivo do Kids/Teen: apenas CPF, sem senha. Emite um token de escopo
   * restrito (scope 'kids-teen') que só abre rotas marcadas com @AllowKidsTeen() —
   * não dá acesso a financeiro, dependentes, admin ou qualquer outra área da conta.
   */
  async loginKidsTeen(dto: CpfLoginDto) {
    const user = await this.usersRepo.findOne({ where: { cpf: dto.cpf }, relations: ['holder'] });
    if (!user) throw new UnauthorizedException('CPF não encontrado.');

    // Só dependente entra no Kids/Teen -- titular não usa o próprio CPF aqui.
    if (user.holderId == null) {
      throw new UnauthorizedException('Esse CPF é de titular. O login do Kids/Teen é só para dependentes.');
    }

    const activeStatus = user.holder?.status;
    if (activeStatus !== 'ativo') {
      throw new UnauthorizedException('Assinatura inativa. Fale com o titular da conta.');
    }

    // Idade do dependente precisa bater com a área (kids até 10, teen 11-17).
    const group = ageGroup(user.birthDate);
    if (group !== dto.module) {
      throw new UnauthorizedException('Idade do dependente não é compatível com esta área.');
    }

    const token = this.jwtService.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      scope: 'kids-teen',
    });

    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        isDependent: user.holderId != null,
        ageGroup: group,
        module: group,
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
    // Aviso de segurança: se não foi o dono, ele precisa saber. Best-effort.
    try {
      await this.mailService.sendPasswordChanged(user.email);
    } catch {
      // a senha já foi trocada; o aviso não pode reverter isso
    }
    return { success: true, message: 'Senha redefinida com sucesso.' };
  }
}
