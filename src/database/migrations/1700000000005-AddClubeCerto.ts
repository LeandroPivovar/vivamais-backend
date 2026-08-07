import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClubeCerto1700000000005 implements MigrationInterface {
  name = 'AddClubeCerto1700000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`app_config\`
      ADD \`clubeCertoEnabled\` tinyint NOT NULL DEFAULT 0,
      ADD \`clubeCertoCnpj\` varchar(20) NULL,
      ADD \`clubeCertoPassword\` varchar(255) NULL,
      ADD \`clubeCertoCompanyId\` varchar(40) NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`app_config\`
      DROP COLUMN \`clubeCertoEnabled\`,
      DROP COLUMN \`clubeCertoCnpj\`,
      DROP COLUMN \`clubeCertoPassword\`,
      DROP COLUMN \`clubeCertoCompanyId\`;
    `);
  }
}
