import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1700000000000 implements MigrationInterface {
  name = 'InitSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`users\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`name\` varchar(150) NOT NULL,
        \`email\` varchar(150) NOT NULL,
        \`cpf\` varchar(20) NOT NULL,
        \`passwordHash\` varchar(100) NOT NULL,
        \`phone\` varchar(30) NULL,
        \`plan\` varchar(40) NOT NULL DEFAULT 'Individual',
        \`level\` varchar(40) NOT NULL DEFAULT 'Sem Nível (Diretor)',
        \`referredById\` int NULL,
        \`role\` varchar(10) NOT NULL DEFAULT 'user',
        \`status\` varchar(10) NOT NULL DEFAULT 'ativo',
        \`accessHealth\` tinyint NOT NULL DEFAULT 0,
        \`accessClube\` tinyint NOT NULL DEFAULT 0,
        \`accessPet\` tinyint NOT NULL DEFAULT 0,
        \`accessFuneral\` tinyint NOT NULL DEFAULT 0,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        UNIQUE INDEX \`IDX_users_email\` (\`email\`),
        UNIQUE INDEX \`IDX_users_cpf\` (\`cpf\`),
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB;
    `);

    await queryRunner.query(`
      ALTER TABLE \`users\`
      ADD CONSTRAINT \`FK_users_referredById\` FOREIGN KEY (\`referredById\`) REFERENCES \`users\`(\`id\`)
      ON DELETE SET NULL ON UPDATE CASCADE;
    `);

    await queryRunner.query(`
      CREATE TABLE \`referral_links\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`userId\` int NOT NULL,
        \`name\` varchar(150) NOT NULL,
        \`planType\` varchar(30) NOT NULL,
        \`desc\` varchar(200) NOT NULL,
        \`price\` varchar(30) NOT NULL,
        \`payment\` varchar(40) NOT NULL,
        \`url\` varchar(300) NOT NULL,
        \`cliques\` int NOT NULL DEFAULT 0,
        \`conversoes\` int NOT NULL DEFAULT 0,
        \`comissao\` decimal(10,2) NOT NULL DEFAULT '0.00',
        \`status\` varchar(10) NOT NULL DEFAULT 'Ativo',
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`FK_links_userId\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    await queryRunner.query(`
      CREATE TABLE \`transactions\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`userId\` int NOT NULL,
        \`plan\` varchar(40) NOT NULL,
        \`value\` decimal(10,2) NOT NULL,
        \`status\` varchar(30) NOT NULL,
        \`paymentMethod\` varchar(40) NOT NULL DEFAULT 'Cartão de Crédito',
        \`commissionMmn\` decimal(10,2) NOT NULL DEFAULT '0.00',
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`FK_transactions_userId\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    await queryRunner.query(`
      CREATE TABLE \`activities\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`userId\` int NOT NULL,
        \`desc\` varchar(200) NOT NULL,
        \`type\` varchar(20) NOT NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        CONSTRAINT \`FK_activities_userId\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);

    await queryRunner.query(`
      CREATE TABLE \`app_config\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`planIndividualPrice\` decimal(10,2) NOT NULL DEFAULT '79.90',
        \`planIndividualMmn\` decimal(10,2) NOT NULL DEFAULT '20.00',
        \`planFamilyPrice\` decimal(10,2) NOT NULL DEFAULT '129.90',
        \`planFamilyMmn\` decimal(10,2) NOT NULL DEFAULT '50.00',
        \`percentages\` json NOT NULL,
        \`modules\` json NOT NULL,
        PRIMARY KEY (\`id\`)
      ) ENGINE=InnoDB;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`app_config\`;`);
    await queryRunner.query(`DROP TABLE \`activities\`;`);
    await queryRunner.query(`DROP TABLE \`transactions\`;`);
    await queryRunner.query(`DROP TABLE \`referral_links\`;`);
    await queryRunner.query(`ALTER TABLE \`users\` DROP FOREIGN KEY \`FK_users_referredById\`;`);
    await queryRunner.query(`DROP TABLE \`users\`;`);
  }
}
