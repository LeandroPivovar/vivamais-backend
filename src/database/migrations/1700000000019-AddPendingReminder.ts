import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Marca quando o lembrete de "pagamento pendente" foi enviado para um lançamento.
 * Sem isso o cron reenviaria o mesmo aviso a cada rodada — um lembrete por
 * lançamento é o suficiente.
 */
export class AddPendingReminder1700000000019 implements MigrationInterface {
  name = 'AddPendingReminder1700000000019';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`transactions\` ADD \`pendingReminderAt\` datetime NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`transactions\` DROP COLUMN \`pendingReminderAt\``);
  }
}
