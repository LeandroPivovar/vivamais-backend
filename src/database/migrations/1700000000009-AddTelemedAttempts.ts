import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTelemedAttempts1700000000009 implements MigrationInterface {
  name = 'AddTelemedAttempts1700000000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`users\` ADD \`telemedAttempts\` int NOT NULL DEFAULT 0;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`telemedAttempts\`;`);
  }
}
