import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddChat1700000000011 implements MigrationInterface {
  name = 'AddChat1700000000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`chat_conversations\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`userId\` int NOT NULL,
        \`unreadForAdmin\` int NOT NULL DEFAULT 0,
        \`unreadForUser\` int NOT NULL DEFAULT 0,
        \`lastMessageAt\` datetime NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`UQ_chat_conversations_userId\` (\`userId\`),
        CONSTRAINT \`FK_chat_conversations_user\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
    await queryRunner.query(`
      CREATE TABLE \`chat_messages\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`conversationId\` int NOT NULL,
        \`senderRole\` varchar(10) NOT NULL,
        \`body\` text NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`IDX_chat_messages_conversationId\` (\`conversationId\`),
        CONSTRAINT \`FK_chat_messages_conversation\` FOREIGN KEY (\`conversationId\`) REFERENCES \`chat_conversations\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`chat_messages\`;`);
    await queryRunner.query(`DROP TABLE \`chat_conversations\`;`);
  }
}
