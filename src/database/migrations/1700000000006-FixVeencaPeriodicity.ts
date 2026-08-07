import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `MONTHLY` não existe no enum da Veenca (aceitos: DAYS | WEEKS | MONTHS | YEARS),
 * então qualquer assinatura criada com esse valor seria rejeitada. Corrige o default
 * da coluna e as linhas já gravadas.
 *
 * Renumerada de 0003 para 0006 para evitar colisão de timestamp com AddPasswordReset.
 */
export class FixVeencaPeriodicity1700000000006 implements MigrationInterface {
  name = 'FixVeencaPeriodicity1700000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`app_config\` MODIFY \`veencaPeriodicityType\` varchar(20) NOT NULL DEFAULT 'MONTHS'`,
    );
    await queryRunner.query(
      `UPDATE \`app_config\` SET \`veencaPeriodicityType\` = 'MONTHS' WHERE \`veencaPeriodicityType\` = 'MONTHLY'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE \`app_config\` SET \`veencaPeriodicityType\` = 'MONTHLY' WHERE \`veencaPeriodicityType\` = 'MONTHS'`,
    );
    await queryRunner.query(
      `ALTER TABLE \`app_config\` MODIFY \`veencaPeriodicityType\` varchar(20) NOT NULL DEFAULT 'MONTHLY'`,
    );
  }
}
