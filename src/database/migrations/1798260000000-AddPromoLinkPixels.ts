import { MigrationInterface, QueryRunner } from 'typeorm';

/** Pixels da Meta e do TikTok por link de oferta (carregados só na página do link). */
export class AddPromoLinkPixels1798260000000 implements MigrationInterface {
  name = 'AddPromoLinkPixels1798260000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`promo_links\` ADD \`metaPixelId\` varchar(40) NULL`);
    await queryRunner.query(`ALTER TABLE \`promo_links\` ADD \`tiktokPixelId\` varchar(40) NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`promo_links\` DROP COLUMN \`tiktokPixelId\``);
    await queryRunner.query(`ALTER TABLE \`promo_links\` DROP COLUMN \`metaPixelId\``);
  }
}
