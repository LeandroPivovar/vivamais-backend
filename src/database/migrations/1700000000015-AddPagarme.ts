import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPagarme1700000000015 implements MigrationInterface {
  name = 'AddPagarme1700000000015';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`app_config\`
      ADD \`pagarmeEnabled\` tinyint NOT NULL DEFAULT 0,
      ADD \`pagarmeSecretKey\` varchar(255) NULL,
      ADD \`pagarmePublicKey\` varchar(255) NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`app_config\`
      DROP COLUMN \`pagarmeEnabled\`,
      DROP COLUMN \`pagarmeSecretKey\`,
      DROP COLUMN \`pagarmePublicKey\`;
    `);
  }
}
