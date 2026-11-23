import { MigrationInterface, QueryRunner } from 'typeorm';

/** Celulares com o app instalado (token do Firebase) para notificações push. */
export class AddPushDevices1798270000000 implements MigrationInterface {
  name = 'AddPushDevices1798270000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`push_devices\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`userId\` int NOT NULL,
        \`token\` varchar(255) NOT NULL,
        \`platform\` varchar(20) NOT NULL DEFAULT 'android',
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`IDX_push_devices_token\` (\`token\`),
        INDEX \`IDX_push_devices_userId\` (\`userId\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`push_devices\``);
  }
}
