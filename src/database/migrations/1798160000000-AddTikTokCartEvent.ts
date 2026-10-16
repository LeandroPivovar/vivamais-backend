import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddTikTokCartEvent1798160000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query("ALTER TABLE transactions ADD tiktokCartEventAt datetime NULL");
    // Do not backfill old transactions into an advertising audience on deployment.
    await q.query("UPDATE transactions SET tiktokCartEventAt = NOW()");
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query("ALTER TABLE transactions DROP COLUMN tiktokCartEventAt");
  }
}
