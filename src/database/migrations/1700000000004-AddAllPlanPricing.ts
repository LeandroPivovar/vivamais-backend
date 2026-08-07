import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAllPlanPricing1700000000004 implements MigrationInterface {
  name = 'AddAllPlanPricing1700000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`app_config\`
      ADD \`planBronzePrice\` decimal(10,2) NOT NULL DEFAULT '39.90',
      ADD \`planBronzeMmn\` decimal(10,2) NOT NULL DEFAULT '10.00',
      ADD \`planPremiumPrice\` decimal(10,2) NOT NULL DEFAULT '199.90',
      ADD \`planPremiumMmn\` decimal(10,2) NOT NULL DEFAULT '60.00';
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`app_config\`
      DROP COLUMN \`planBronzePrice\`,
      DROP COLUMN \`planBronzeMmn\`,
      DROP COLUMN \`planPremiumPrice\`,
      DROP COLUMN \`planPremiumMmn\`;
    `);
  }
}
