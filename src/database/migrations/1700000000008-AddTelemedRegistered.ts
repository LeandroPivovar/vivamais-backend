import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTelemedRegistered1700000000008 implements MigrationInterface {
  name = 'AddTelemedRegistered1700000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`users\` ADD \`telemedRegistered\` tinyint NOT NULL DEFAULT 0;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`telemedRegistered\`;`);
  }
}
