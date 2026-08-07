import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWoovi1700000000013 implements MigrationInterface {
  name = 'AddWoovi1700000000013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Config: seletor de gateway + credenciais Woovi (Pix Automático).
    await queryRunner.query(`
      ALTER TABLE \`app_config\`
      ADD \`activeGateway\` varchar(20) NOT NULL DEFAULT 'veenca',
      ADD \`wooviEnabled\` tinyint NOT NULL DEFAULT 0,
      ADD \`wooviAppId\` varchar(255) NULL,
      ADD \`wooviSandbox\` tinyint NOT NULL DEFAULT 0;
    `);

    // Transactions: qual gateway processou + alargar colunas de id (globalID Woovi é maior).
    await queryRunner.query(`
      ALTER TABLE \`transactions\`
      ADD \`gatewayProvider\` varchar(20) NOT NULL DEFAULT 'veenca',
      MODIFY \`gatewayIdentifier\` varchar(128) NULL,
      MODIFY \`gatewayTransactionId\` varchar(128) NULL,
      MODIFY \`gatewaySubscriptionId\` varchar(128) NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`transactions\`
      DROP COLUMN \`gatewayProvider\`,
      MODIFY \`gatewayIdentifier\` varchar(64) NULL,
      MODIFY \`gatewayTransactionId\` varchar(64) NULL,
      MODIFY \`gatewaySubscriptionId\` varchar(64) NULL;
    `);
    await queryRunner.query(`
      ALTER TABLE \`app_config\`
      DROP COLUMN \`activeGateway\`,
      DROP COLUMN \`wooviEnabled\`,
      DROP COLUMN \`wooviAppId\`,
      DROP COLUMN \`wooviSandbox\`;
    `);
  }
}
