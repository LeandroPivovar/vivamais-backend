import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from '../admin/entities/config.entity';
import { PaymentService } from './payment.service';
import { WooviService } from './woovi.service';
import { PagarmeService } from './pagarme.service';

@Module({
  imports: [TypeOrmModule.forFeature([AppConfig])],
  providers: [PaymentService, WooviService, PagarmeService],
  exports: [PaymentService, WooviService, PagarmeService],
})
export class PaymentModule {}
