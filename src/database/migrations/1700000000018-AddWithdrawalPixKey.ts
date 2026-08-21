import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Chave PIX informada pelo usuário no pedido de saque — é para onde o financeiro
 * envia o dinheiro. Nullable porque os pedidos criados antes desta regra não têm.
 */
export class AddWithdrawalPixKey1700000000018 implements MigrationInterface {
  name = 'AddWithdrawalPixKey1700000000018';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`withdrawals\`
       ADD \`pixKeyType\` varchar(20) NULL,
       ADD \`pixKey\` varchar(140) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`withdrawals\` DROP COLUMN \`pixKey\`, DROP COLUMN \`pixKeyType\``,
    );
  }
}
