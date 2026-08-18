import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfig } from '../admin/entities/config.entity';
import { basePriceForPlan } from '../common/pricing';

@Injectable()
export class ContentService {
  constructor(@InjectRepository(AppConfig) private configRepo: Repository<AppConfig>) {}

  async getPlanPrices() {
    const config = await this.configRepo.findOne({ where: {} });
    if (!config) throw new NotFoundException('Configuração do sistema não encontrada.');
    const format = (value: number) => `R$ ${value.toFixed(2).replace('.', ',')}/mês`;
    return {
      Individual: format(basePriceForPlan('Individual', config)),
      Família: format(basePriceForPlan('Família', config)),
      'Viva Mais Premium': format(basePriceForPlan('Viva Mais Premium', config)),
    };
  }

  /**
   * Busca endereço pelo CEP (proxy do ViaCEP — evita CORS/CSP no browser).
   * Retorna null se o CEP for inválido ou não encontrado.
   */
  async lookupCep(rawCep: string): Promise<{
    zipCode: string;
    street: string;
    neighborhood: string;
    city: string;
    state: string;
  } | null> {
    const cep = (rawCep ?? '').replace(/\D/g, '');
    if (cep.length !== 8) return null;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      if (!res.ok) return null;
      const data: any = await res.json().catch(() => null);
      if (!data || data.erro) return null;
      return {
        zipCode: cep,
        street: data.logradouro ?? '',
        neighborhood: data.bairro ?? '',
        city: data.localidade ?? '',
        state: data.uf ?? '',
      };
    } catch {
      return null;
    }
  }

  getSlides() {
    return [
      {
        tag: 'SAÚDE',
        title: 'Consultas de Telemedicina 24h',
        description: 'Fale com um médico a qualquer hora, sem sair de casa.',
        image: '/telemedicina-banner.png',
        benefit: 'Telemedicina',
      },
      {
        tag: 'PET',
        title: 'Consultas Veterinárias 24h',
        description: 'Fale com um veterinário a qualquer hora, sem sair de casa.',
        image: '/pet-banner.png',
        benefit: 'Veterinário 24h',
      },
      {
        tag: 'ECONOMIA',
        title: 'Clube de Descontos Exclusivo',
        description: 'Economize até 50% em farmácias, compras, lazer e parceiros.',
        image: '/clube_banner.png',
        benefit: 'Clube de Descontos',
      },
      {
        tag: 'CONSULTAS & EXAMES',
        title: 'Consultas e Exames',
        description: 'Agende consultas e exames pelo app Nipomed no seu celular.',
        image: '/saude_banner.png',
        benefit: 'Consultas e exames',
      },
    ];
  }

  getDiscountCategories() {
    return [
      { name: 'Farmácias', icon: 'ph-pill', count: '12.000+ filiais' },
      { name: 'Exames & Clínicas', icon: 'ph-stethoscope', count: '1.500+ parceiros' },
      { name: 'Educação', icon: 'ph-student', count: '200+ faculdades' },
      { name: 'Lazer & Viagens', icon: 'ph-airplane-takeoff', count: '80+ hotéis e parques' },
    ];
  }

  getDiscountHighlights() {
    return [
      {
        brand: 'Droga Raia & Drogasil',
        discount: 'Até 50% de desconto em medicamentos',
        logoBg: '#eef7eb',
        color: '#16a34a',
      },
      {
        brand: 'Sabim Medicina Diagnóstica',
        discount: 'Até 25% de desconto em exames de sangue',
        logoBg: '#eff6ff',
        color: '#2563eb',
      },
      { brand: 'Smart Fit', discount: 'Matrícula grátis + 10% na mensalidade', logoBg: '#fffbeb', color: '#d97706' },
    ];
  }

  getVeterinarioFaqs() {
    return [
      {
        question: 'Quais animais estão cobertos pelo benefício?',
        answer: 'Cães e gatos domésticos sem limite de raça ou idade.',
      },
      {
        question: 'Existe limite de consultas por mês?',
        answer: 'Não há limite de consultas de teleorientação veterinária 24h.',
      },
      {
        question: 'Como localizo uma clínica credenciada?',
        answer: 'A lista de clínicas parceiras fica disponível após o SSO no portal do parceiro.',
      },
    ];
  }
}
