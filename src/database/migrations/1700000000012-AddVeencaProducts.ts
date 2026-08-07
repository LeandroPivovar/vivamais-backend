import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVeencaProducts1700000000012 implements MigrationInterface {
  name = 'AddVeencaProducts1700000000012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`app_config\`
      ADD \`veencaProductIndividual\` varchar(64) NULL,
      ADD \`veencaProductFamily\` varchar(64) NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`app_config\`
      DROP COLUMN \`veencaProductIndividual\`,
      DROP COLUMN \`veencaProductFamily\`;
    `);
  }
}
