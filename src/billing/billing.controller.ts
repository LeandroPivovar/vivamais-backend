import { Body, Controller, Get, HttpCode, Ip, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { BillingService } from './billing.service';
import { CheckoutDto } from './dto/checkout.dto';
import { TrialSignupDto } from './dto/trial-signup.dto';
import { PayDto } from './dto/pay.dto';

@Controller('billing')
export class BillingController {
  constructor(private billingService: BillingService) {}

  @Get('invoices')
  @UseGuards(JwtAuthGuard)
  invoices(@CurrentUser() authUser: { id: number }) {
    return this.billingService.listInvoices(authUser.id);
  }

  @Get('summary')
  @UseGuards(JwtAuthGuard)
  summary(@CurrentUser() authUser: { id: number }) {
    return this.billingService.getSummary(authUser.id);
  }

  @Post('checkout')
  checkout(@Body() dto: CheckoutDto, @Ip() ip: string) {
    return this.billingService.checkout(dto, ip);
  }

  @Get('trial-link/:token')
  trialLink(@Param('token') token: string) {
    return this.billingService.getTrialSignupLink(token);
  }

  @Post('trial-signup')
  trialSignup(@Body() dto: TrialSignupDto) {
    return this.billingService.trialSignup(dto);
  }

  /** Público: registra clique no link de indicação quando o checkout público abre. */
  @Post('referral-click')
  @HttpCode(200)
  referralClick(@Body() body: { ref?: string; planType?: string }) {
    return this.billingService.registerReferralClick(body?.ref ?? '', body?.planType);
  }

  /** Pagamento avulso da assinatura do usuário logado (renovação manual via PIX/cartão). */
  @Post('pay')
  @UseGuards(JwtAuthGuard)
  pay(@CurrentUser() authUser: { id: number }, @Body() dto: PayDto, @Ip() ip: string) {
    return this.billingService.payCurrentSubscription(authUser.id, dto, ip);
  }

  /** Status de um lançamento — alvo do polling do PIX no front (reconsulta a Veenca). */
  @Get('transaction/:id/status')
  @UseGuards(JwtAuthGuard)
  transactionStatus(@Param('id', ParseIntPipe) id: number) {
    return this.billingService.getTransactionStatus(id);
  }

  /** Webhook público da Veenca (TRANSACTION_PAID etc). Sempre 200 pra não gerar reenvio em loop. */
  @Post('webhook/veenca')
  @HttpCode(200)
  async webhook(@Body() body: any) {
    await this.billingService.handleVeencaWebhook(body);
    return { received: true };
  }

  /** Webhook público da Woovi (Pix Automático — PIX_AUTOMATIC_*). Sempre 200. */
  @Post('webhook/woovi')
  @HttpCode(200)
  async wooviWebhook(@Body() body: any) {
    await this.billingService.handleWooviWebhook(body);
    return { received: true };
  }

  /** Webhook público da Pagar.me (charge.paid / subscription.charged etc). Sempre 200. */
  @Post('webhook/pagarme')
  @HttpCode(200)
  async pagarmeWebhook(@Body() body: any) {
    await this.billingService.handlePagarmeWebhook(body);
    return { received: true };
  }

  /** Público: config de cartão pro checkout (public key da Pagar.me + se está ligado). */
  @Get('card-config')
  cardConfig() {
    return this.billingService.getCardConfig();
  }
}
