import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ContentService } from './content.service';

@Controller('content')
export class ContentController {
  constructor(private contentService: ContentService) {}

  @Get('slides')
  @UseGuards(JwtAuthGuard)
  slides() {
    return this.contentService.getSlides();
  }

  /** Público: preços dos planos são usados no checkout do visitante (via link de indicação). */
  @Get('pricing')
  pricing() {
    return this.contentService.getPlanPrices();
  }

  /** Público: busca de endereço por CEP (usado nos formulários com campo de CEP). */
  @Get('cep/:cep')
  cep(@Param('cep') cep: string) {
    return this.contentService.lookupCep(cep);
  }

  @Get('discounts')
  @UseGuards(JwtAuthGuard)
  discounts() {
    return {
      categories: this.contentService.getDiscountCategories(),
      highlights: this.contentService.getDiscountHighlights(),
    };
  }

  @Get('faqs-veterinario')
  @UseGuards(JwtAuthGuard)
  faqsVeterinario() {
    return this.contentService.getVeterinarioFaqs();
  }
}
