import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRegistrationFields1700000000001 implements MigrationInterface {
  name = 'AddRegistrationFields1700000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`users\`
      ADD \`birthDate\` varchar(10) NULL,
      ADD \`gender\` varchar(10) NULL,
      ADD \`address\` varchar(200) NULL,
      ADD \`neighborhood\` varchar(100) NULL,
      ADD \`complement\` varchar(100) NULL,
      ADD \`city\` varchar(100) NULL,
      ADD \`state\` varchar(2) NULL,
      ADD \`zipCode\` varchar(10) NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`users\`
      DROP COLUMN \`birthDate\`,
      DROP COLUMN \`gender\`,
      DROP COLUMN \`address\`,
      DROP COLUMN \`neighborhood\`,
      DROP COLUMN \`complement\`,
      DROP COLUMN \`city\`,
      DROP COLUMN \`state\`,
      DROP COLUMN \`zipCode\`;
    `);
  }
}
