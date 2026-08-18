import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bônus de R$30 no primeiro mês de uma indicação nova (além da comissão de 10%
 * de sempre). Vale só a partir de agora -- sem retroatividade, por isso é só uma
 * coluna nova com default 0, sem backfill.
 */
export class AddReferralBonus1700000000016 implements MigrationInterface {
  name = 'AddReferralBonus1700000000016';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`referral_links\` ADD \`bonusTotal\` decimal(10,2) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE \`transactions\` ADD \`referralBonus\` decimal(10,2) NOT NULL DEFAULT 0`,
    );
    // Marca no próprio indicado que a indicação dele rendeu o bônus de R$30 pro
    // indicador -- usado pra exibir o selo "indicação nova" no relatório.
    await queryRunner.query(
      `ALTER TABLE \`users\` ADD \`referralBonusPaid\` tinyint NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`referralBonusPaid\``);
    await queryRunner.query(`ALTER TABLE \`transactions\` DROP COLUMN \`referralBonus\``);
    await queryRunner.query(`ALTER TABLE \`referral_links\` DROP COLUMN \`bonusTotal\``);
  }
}
