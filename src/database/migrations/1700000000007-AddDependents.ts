import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Dependentes: cada titular pode ter N dependentes (limite por plano, configurado
 * pelo Admin). O dependente é um usuário com `holderId` apontando para o titular.
 */
export class AddDependents1700000000007 implements MigrationInterface {
  name = 'AddDependents1700000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE \`users\` ADD \`holderId\` int NULL`);
    await queryRunner.query(
      `ALTER TABLE \`users\` ADD CONSTRAINT \`FK_users_holder\` ` +
        `FOREIGN KEY (\`holderId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE \`app_config\`
       ADD \`planBronzeDependents\` int NOT NULL DEFAULT 0,
       ADD \`planIndividualDependents\` int NOT NULL DEFAULT 0,
       ADD \`planFamilyDependents\` int NOT NULL DEFAULT 0,
       ADD \`planPremiumDependents\` int NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`app_config\`
       DROP COLUMN \`planBronzeDependents\`,
       DROP COLUMN \`planIndividualDependents\`,
       DROP COLUMN \`planFamilyDependents\`,
       DROP COLUMN \`planPremiumDependents\``,
    );
    await queryRunner.query(`ALTER TABLE \`users\` DROP FOREIGN KEY \`FK_users_holder\``);
    await queryRunner.query(`ALTER TABLE \`users\` DROP COLUMN \`holderId\``);
  }
}
