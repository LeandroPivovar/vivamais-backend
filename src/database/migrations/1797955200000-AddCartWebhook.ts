import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Marca quando o webhook de carrinho abandonado (MassFlow) foi disparado para
 * um lançamento. Sem isso o cron reenviaria o mesmo lead a cada minuto enquanto
 * a cobrança seguisse pendente.
 */
export class AddCartWebhook1797955200000 implements MigrationInterface {
  name = 'AddCartWebhook1797955200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`transactions\` ADD \`cartWebhookAt\` datetime NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`transactions\` DROP COLUMN \`cartWebhookAt\``);
  }
}
