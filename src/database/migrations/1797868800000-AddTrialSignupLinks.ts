import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTrialSignupLinks1797868800000 implements MigrationInterface {
  name = 'AddTrialSignupLinks1797868800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`trial_signup_links\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`token\` varchar(80) NOT NULL,
        \`plan\` varchar(40) NOT NULL,
        \`createdById\` int NULL,
        \`usedById\` int NULL,
        \`usedAt\` datetime NULL,
        \`status\` varchar(20) NOT NULL DEFAULT 'active',
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`UQ_trial_signup_links_token\` (\`token\`),
        KEY \`IDX_trial_signup_links_status\` (\`status\`)
      ) ENGINE=InnoDB;
    `);
    await queryRunner.query(`ALTER TABLE \`users\` ADD \`trialEndsAt\` datetime NULL;`);
    await queryRunner.query(`ALTER TABLE \`users\` ADD \`trialReminder7At\` datetime NULL;`);
    await queryRunner.query(`ALTER TABLE \`users\` ADD \`trialReminder3At\` datetime NULL;`);
    await queryRunner.query(`ALTER TABLE \`users\` ADD \`trialReminder1At\` datetime NULL;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`trialReminder1At\`;`);
    await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`trialReminder3At\`;`);
    await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`trialReminder7At\`;`);
    await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`trialEndsAt\`;`);
    await queryRunner.query(`DROP TABLE \`trial_signup_links\`;`);
  }
}
