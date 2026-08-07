import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPasswordReset1700000000003 implements MigrationInterface {
  name = 'AddPasswordReset1700000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`users\`
      ADD \`passwordResetCode\` varchar(6) NULL,
      ADD \`passwordResetExpires\` datetime NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`users\`
      DROP COLUMN \`passwordResetCode\`,
      DROP COLUMN \`passwordResetExpires\`;
    `);
  }
}
