import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTickets1700000000010 implements MigrationInterface {
  name = 'AddTickets1700000000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`tickets\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`userId\` int NOT NULL,
        \`title\` varchar(150) NOT NULL,
        \`status\` varchar(20) NOT NULL DEFAULT 'enviado',
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`IDX_tickets_userId\` (\`userId\`),
        CONSTRAINT \`FK_tickets_user\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
    await queryRunner.query(`
      CREATE TABLE \`ticket_messages\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`ticketId\` int NOT NULL,
        \`senderRole\` varchar(10) NOT NULL,
        \`body\` text NOT NULL,
        \`image\` longtext NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`IDX_ticket_messages_ticketId\` (\`ticketId\`),
        CONSTRAINT \`FK_ticket_messages_ticket\` FOREIGN KEY (\`ticketId\`) REFERENCES \`tickets\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`ticket_messages\`;`);
    await queryRunner.query(`DROP TABLE \`tickets\`;`);
  }
}
