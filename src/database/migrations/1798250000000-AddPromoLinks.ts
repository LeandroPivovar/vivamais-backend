import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Links de oferta (1º mês promocional) + campos na transação para cobrar o preço cheio
 * nas mensalidades seguintes.
 */
export class AddPromoLinks1798250000000 implements MigrationInterface {
  name = 'AddPromoLinks1798250000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`promo_links\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`slug\` varchar(60) NOT NULL,
        \`plan\` varchar(40) NOT NULL,
        \`firstMonthPrice\` decimal(10,2) NOT NULL,
        \`maxUses\` int NULL,
        \`usesCount\` int NOT NULL DEFAULT 0,
        \`expiresAt\` datetime NULL,
        \`active\` tinyint NOT NULL DEFAULT 1,
        \`createdById\` int NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`IDX_promo_links_slug\` (\`slug\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB
    `);
    await queryRunner.query(`ALTER TABLE \`transactions\` ADD \`recurringValue\` decimal(10,2) NULL`);
    await queryRunner.query(`ALTER TABLE \`transactions\` ADD \`promoLinkId\` int NULL`);
    await queryRunner.query(`ALTER TABLE \`transactions\` ADD \`recurringValueSyncedAt\` datetime NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`transactions\` DROP COLUMN \`recurringValueSyncedAt\``);
    await queryRunner.query(`ALTER TABLE \`transactions\` DROP COLUMN \`promoLinkId\``);
    await queryRunner.query(`ALTER TABLE \`transactions\` DROP COLUMN \`recurringValue\``);
    await queryRunner.query(`DROP INDEX \`IDX_promo_links_slug\` ON \`promo_links\``);
    await queryRunner.query(`DROP TABLE \`promo_links\``);
  }
}
