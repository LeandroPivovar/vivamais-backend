import { MigrationInterface, QueryRunner } from 'typeorm';

/** Push nos apps Kids/Teens: qual app está em cada celular + histórico de envios do admin. */
export class AddPushAppsAndBroadcasts1798280000000 implements MigrationInterface {
  name = 'AddPushAppsAndBroadcasts1798280000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`push_devices\` ADD \`app\` varchar(20) NOT NULL DEFAULT 'vivamais'`);
    await queryRunner.query(`CREATE INDEX \`IDX_push_devices_app\` ON \`push_devices\` (\`app\`)`);
    await queryRunner.query(`
      CREATE TABLE \`push_broadcasts\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`app\` varchar(20) NOT NULL,
        \`title\` varchar(80) NOT NULL,
        \`body\` varchar(300) NOT NULL,
        \`total\` int NOT NULL DEFAULT 0,
        \`sent\` int NOT NULL DEFAULT 0,
        \`createdById\` int NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`push_broadcasts\``);
    await queryRunner.query(`DROP INDEX \`IDX_push_devices_app\` ON \`push_devices\``);
    await queryRunner.query(`ALTER TABLE \`push_devices\` DROP COLUMN \`app\``);
  }
}
