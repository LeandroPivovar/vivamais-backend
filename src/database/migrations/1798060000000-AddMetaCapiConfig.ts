import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Credenciais da Conversions API da Meta no painel do admin, em vez de .env.
 * O token é longo (~200 chars), por isso `text` e não `varchar`.
 */
export class AddMetaCapiConfig1798060000000 implements MigrationInterface {
  name = 'AddMetaCapiConfig1798060000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`app_config\` ADD \`metaCapiEnabled\` tinyint NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE \`app_config\` ADD \`metaPixelId\` varchar(64) NULL`);
    await queryRunner.query(`ALTER TABLE \`app_config\` ADD \`metaCapiToken\` text NULL`);
    await queryRunner.query(`ALTER TABLE \`app_config\` ADD \`metaTestEventCode\` varchar(40) NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`app_config\` DROP COLUMN \`metaTestEventCode\``);
    await queryRunner.query(`ALTER TABLE \`app_config\` DROP COLUMN \`metaCapiToken\``);
    await queryRunner.query(`ALTER TABLE \`app_config\` DROP COLUMN \`metaPixelId\``);
    await queryRunner.query(`ALTER TABLE \`app_config\` DROP COLUMN \`metaCapiEnabled\``);
  }
}
