import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddTikTokEventsConfig1798061000000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query("ALTER TABLE app_config ADD tiktokEventsEnabled tinyint NOT NULL DEFAULT 0, ADD tiktokPixelId varchar(64) NULL, ADD tiktokEventsToken text NULL, ADD tiktokTestEventCode varchar(40) NULL");
  }
  public async down(q: QueryRunner): Promise<void> {
    await q.query("ALTER TABLE app_config DROP COLUMN tiktokEventsEnabled, DROP COLUMN tiktokPixelId, DROP COLUMN tiktokEventsToken, DROP COLUMN tiktokTestEventCode");
  }
}
