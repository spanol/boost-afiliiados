import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BrandBreakdown from './BrandBreakdown';
import type { AffiliateConfig } from '../lib/commission';

// Detalhamento por casa: cada casa usa a taxa POR CASA do afiliado (override de
// byBrand, com fallback no topo) e a métrica é coagida por num() antes de
// multiplicar — os MESMOS invariantes de dinheiro dos dashboards. Estes testes
// travam: empty-state, config null sem quebrar, override por casa e num() sem NaN.
describe('BrandBreakdown', () => {
  it('mostra "Sem dados por casa" quando data está vazio', () => {
    render(<BrandBreakdown data={[]} config={null} />);
    // Renderiza o card de REV e o de CPA, ambos no empty-state.
    expect(screen.getAllByText('Sem dados por casa').length).toBeGreaterThan(0);
  });

  it('não quebra com config null (render ok)', () => {
    const data = [{ id: 'sb', rvs: 10, qualified_cpa: 1, label: 'SportingBet' }];
    // Sem config, as taxas resolvem para 0 → valores zerados, mas sem throw.
    expect(() => render(<BrandBreakdown data={data} config={null} />)).not.toThrow();
    // O nome da casa aparece nos dois cards (REV e CPA), provando que renderizou.
    expect(screen.getAllByText('SportingBet').length).toBeGreaterThan(0);
  });

  it('usa a taxa POR CASA (byBrand) e não a de topo no CPA da casa', () => {
    const config: AffiliateConfig = {
      affiliateId: 'a1',
      cpaValue: 100, // taxa de topo
      revPercentage: 0,
      byBrand: { sb: { cpaValue: 200, revPercentage: 0 } }, // override da casa 'sb'
    };
    const data = [{ id: 'sb', qualified_cpa: 2, rvs: 0 }];
    render(<BrandBreakdown data={data} config={config} />);
    // 2 × 200 (override) = R$ 400,00 — NÃO 2 × 100 (topo) = R$ 200,00.
    expect(screen.getByText('R$ 400,00')).toBeInTheDocument();
    expect(screen.queryByText('R$ 200,00')).not.toBeInTheDocument();
  });

  it('coage a métrica com num() sem zerar silenciosamente (REV real, não R$ 0,00)', () => {
    const config: AffiliateConfig = {
      affiliateId: 'a1',
      cpaValue: 0,
      revPercentage: 100, // 100% do rvs vira a comissão REV
    };
    // A API externa manda número (às vezes como string numérica '2.5'); num() o
    // preserva em vez de virar 0 via `Number(x) || 0`. 2.5 × 100% = R$ 2,50.
    const data = [{ id: 'sb', rvs: 2.5, qualified_cpa: 0 }];
    render(<BrandBreakdown data={data} config={config} />);
    expect(screen.getByText('R$ 2,50')).toBeInTheDocument();
  });
});
