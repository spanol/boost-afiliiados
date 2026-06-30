// Texto da notificação "novos resultados" enviada ao afiliado quando o admin sobe
// resultados de uma casa (cruzados pelo e-mail de login Boost). PURO/testável — o
// servidor agrega as métricas do afiliado no upload, escolhe a variante e injeta aqui.
//
// Duas variantes PRONTAS (decisão do produto): 'counts' fica ATIVA por padrão (só
// contagens, nada de R$); 'money' já está pronta mas só liga quando a equipe pedir
// (flag no servidor), pra facilitar a migração sem reescrever nada.
import { num } from './commission';
import { formatBrl } from './currency';

export type ResultsNotificationVariant = 'counts' | 'money';

export interface ResultsNotificationMetrics {
  registrations?: number;   // cadastros (contagem)
  first_deposits?: number;  // FTD (contagem)
  qualified_cpa?: number;   // CPA qualificado (contagem)
  total_commission?: number; // comissão da casa (R$) — só usada na variante 'money'
}

// Junta ["a","b","c"] → "a, b e c" (pt-BR).
function joinPt(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
}

// Partes de CONTAGEM não-zero, já pluralizadas em pt-BR.
function countParts(m: ResultsNotificationMetrics): string[] {
  const parts: string[] = [];
  const cad = num(m.registrations);
  const ftd = num(m.first_deposits);
  const cpa = num(m.qualified_cpa);
  if (cad > 0) parts.push(`${cad} ${cad === 1 ? 'novo cadastro' : 'novos cadastros'}`);
  if (ftd > 0) parts.push(`${ftd} ${ftd === 1 ? 'FTD' : 'FTDs'}`);
  if (cpa > 0) parts.push(`${cpa} ${cpa === 1 ? 'CPA' : 'CPAs'}`);
  return parts;
}

export function buildResultsNotification(
  houseName: string,
  m: ResultsNotificationMetrics,
  variant: ResultsNotificationVariant = 'counts',
): { title: string; body: string } {
  const house = (houseName || '').trim() || 'sua casa';
  const title = `🎉 Novos resultados na ${house}!`;
  const parts = countParts(m);
  const commission = num(m.total_commission);

  // Variante 'money' (off por padrão): inclui o R$ de comissão quando houver.
  if (variant === 'money' && commission > 0) {
    const ganho = `gerou ${formatBrl(commission)} em comissão`;
    const body = parts.length
      ? `Você teve ${joinPt(parts)} e ${ganho} na ${house}. Confira no seu painel! 🚀`
      : `Você ${ganho} na ${house}. Confira no seu painel! 🚀`;
    return { title, body };
  }

  // Variante 'counts' (ativa): só contagens. Sem contagem nova → texto genérico.
  const body = parts.length
    ? `Você teve ${joinPt(parts)} na ${house}. Confira no seu painel! 🚀`
    : `Seus resultados na ${house} foram atualizados. Confira no seu painel!`;
  return { title, body };
}
