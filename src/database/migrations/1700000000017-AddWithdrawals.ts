import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Solicitações de saque das comissões/bônus de indicação. Nasce 'pendente' e o
 * admin dá baixa ('pago'). O valor fica congelado no pedido — o saldo disponível
 * do usuário desconta todo saque pendente ou pago.
 */
export class AddWithdrawals1700000000017 implements MigrationInterface {
  name = 'AddWithdrawals1700000000017';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`withdrawals\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`userId\` int NOT NULL,
        \`amount\` decimal(10,2) NOT NULL DEFAULT 0,
        \`status\` varchar(20) NOT NULL DEFAULT 'pendente',
        \`paidAt\` datetime NULL,
        \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (\`id\`),
        KEY \`IDX_withdrawals_user\` (\`userId\`),
        CONSTRAINT \`FK_withdrawals_user\` FOREIGN KEY (\`userId\`)
          REFERENCES \`users\`(\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`withdrawals\``);
  }
}
