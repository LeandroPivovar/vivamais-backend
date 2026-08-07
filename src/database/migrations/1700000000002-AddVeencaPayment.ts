import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVeencaPayment1700000000002 implements MigrationInterface {
  name = 'AddVeencaPayment1700000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`app_config\`
      ADD \`veencaPayEnabled\` tinyint NOT NULL DEFAULT 0,
      ADD \`veencaPublicKey\` varchar(255) NULL,
      ADD \`veencaSecretKey\` varchar(255) NULL,
      ADD \`veencaPeriodicityType\` varchar(20) NOT NULL DEFAULT 'MONTHLY';
    `);
    await queryRunner.query(`
      ALTER TABLE \`transactions\`
      ADD \`gatewayIdentifier\` varchar(64) NULL,
      ADD \`gatewayTransactionId\` varchar(64) NULL,
      ADD \`gatewaySubscriptionId\` varchar(64) NULL,
      ADD \`pixCode\` text NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`transactions\`
      DROP COLUMN \`gatewayIdentifier\`,
      DROP COLUMN \`gatewayTransactionId\`,
      DROP COLUMN \`gatewaySubscriptionId\`,
      DROP COLUMN \`pixCode\`;
    `);
    await queryRunner.query(`
      ALTER TABLE \`app_config\`
      DROP COLUMN \`veencaPayEnabled\`,
      DROP COLUMN \`veencaPublicKey\`,
      DROP COLUMN \`veencaSecretKey\`,
      DROP COLUMN \`veencaPeriodicityType\`;
    `);
  }
}
