import { MigrationInterface, QueryRunner } from 'typeorm';

/** Herdeiro indicado pelo titular para recebimentos futuros em caso de falecimento. */
export class AddHeirs1700000000020 implements MigrationInterface {
  name = 'AddHeirs1700000000020';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`heirs\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`userId\` int NOT NULL,
        \`name\` varchar(150) NOT NULL,
        \`cpf\` varchar(20) NOT NULL,
        \`phone\` varchar(30) NOT NULL,
        \`email\` varchar(150) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`IDX_heirs_user\` (\`userId\`),
        CONSTRAINT \`FK_heirs_user\` FOREIGN KEY (\`userId\`)
          REFERENCES \`users\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`heirs\``);
  }
}
