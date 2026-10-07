import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * URLs dos webhooks do MassFlow no painel do admin, em vez de só no .env.
 * Levam o token no path, por isso `text` (e mascaradas na API do admin).
 */
export class AddMassflowConfig1798150000000 implements MigrationInterface {
  name = 'AddMassflowConfig1798150000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`app_config\` ADD \`massflowWebhookUrl\` text NULL`);
    await queryRunner.query(`ALTER TABLE \`app_config\` ADD \`massflowCartWebhookUrl\` text NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`app_config\` DROP COLUMN \`massflowCartWebhookUrl\``);
    await queryRunner.query(`ALTER TABLE \`app_config\` DROP COLUMN \`massflowWebhookUrl\``);
  }
}
