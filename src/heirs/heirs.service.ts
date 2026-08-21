import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MailService } from '../mail/mail.service';
import { User } from '../users/entities/user.entity';
import { UpsertHeirDto } from './dto/upsert-heir.dto';
import { Heir } from './entities/heir.entity';

function onlyDigits(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '');
}

function normalizeText(v: string | null | undefined): string {
  return (v ?? '').trim();
}

function normalizeEmail(v: string | null | undefined): string {
  return normalizeText(v).toLowerCase();
}

@Injectable()
export class HeirsService {
  constructor(
    @InjectRepository(Heir) private heirsRepo: Repository<Heir>,
    @InjectRepository(User) private usersRepo: Repository<User>,
    private mailService: MailService,
  ) {}

  private toResponse(heir: Heir | null, emailsSent = false) {
    return {
      heir: heir
        ? {
            id: heir.id,
            name: heir.name,
            cpf: heir.cpf,
            phone: heir.phone,
            email: heir.email,
            createdAt: heir.createdAt,
            updatedAt: heir.updatedAt,
          }
        : null,
      emailsSent,
    };
  }

  async getMine(userId: number) {
    const heir = await this.heirsRepo.findOne({ where: { userId } });
    return this.toResponse(heir);
  }

  async upsertMine(userId: number, dto: UpsertHeirDto) {
    const owner = await this.usersRepo.findOne({ where: { id: userId } });
    if (!owner) throw new NotFoundException('Usuário não encontrado.');
    if (owner.holderId) throw new ForbiddenException('Dependentes não podem cadastrar herdeiro.');

    const name = normalizeText(dto.name);
    const cpf = onlyDigits(dto.cpf);
    const phone = onlyDigits(dto.phone);
    const email = normalizeEmail(dto.email);

    if (!name || !cpf || !phone || !email) {
      throw new BadRequestException('Preencha nome, CPF, telefone e e-mail do herdeiro.');
    }
    if (cpf.length !== 11) throw new BadRequestException('CPF do herdeiro deve conter 11 dígitos.');

    let heir = await this.heirsRepo.findOne({ where: { userId } });
    const changed =
      !heir ||
      heir.name !== name ||
      heir.cpf !== cpf ||
      heir.phone !== phone ||
      heir.email !== email;

    heir = this.heirsRepo.create({
      ...(heir ?? {}),
      userId,
      name,
      cpf,
      phone,
      email,
    });
    const saved = await this.heirsRepo.save(heir);

    if (changed) {
      await this.mailService.sendHeirSelectedToHeir(saved.email, saved.name, owner.name);
      await this.mailService.sendHeirSelectedToOwner(owner.email, owner.name, saved.name);
    }

    return this.toResponse(saved, changed);
  }
}
