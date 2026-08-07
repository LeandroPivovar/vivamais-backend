import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChatStatus1700000000014 implements MigrationInterface {
  name = 'AddChatStatus1700000000014';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`chat_conversations\`
      ADD \`status\` varchar(20) NOT NULL DEFAULT 'aberto',
      ADD \`closedAt\` datetime NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`chat_conversations\`
      DROP COLUMN \`status\`,
      DROP COLUMN \`closedAt\`;
    `);
  }
}
