// Máscaras e validações de documentos/contato (pt-BR).
// Usado no cadastro de afiliados (src/pages/Register.tsx).

/** Mantém apenas dígitos. */
function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Aplica a máscara de CPF: 000.000.000-00.
 * Trunca em 11 dígitos e formata progressivamente conforme o usuário digita.
 */
export function maskCPF(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

/**
 * Aplica a máscara de telefone brasileiro: (00) 00000-0000 (celular)
 * ou (00) 0000-0000 (fixo). Trunca em 11 dígitos.
 */
export function maskPhone(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 2) return d.replace(/(\d{0,2})/, '($1');
  if (d.length <= 6) return d.replace(/(\d{2})(\d{0,4})/, '($1) $2');
  if (d.length <= 10) return d.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
  return d.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
}

/**
 * Valida um CPF pelos dígitos verificadores (algoritmo oficial da Receita).
 * Aceita o valor com ou sem máscara.
 */
export function isValidCPF(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11) return false;
  // Rejeita sequências repetidas (000..., 111..., etc.) que passam no cálculo.
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const calcCheckDigit = (length: number): number => {
    let sum = 0;
    for (let i = 0; i < length; i++) {
      sum += parseInt(cpf[i], 10) * (length + 1 - i);
    }
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return (
    calcCheckDigit(9) === parseInt(cpf[9], 10) &&
    calcCheckDigit(10) === parseInt(cpf[10], 10)
  );
}

/**
 * Valida um telefone brasileiro: DDD (2 dígitos) + número de 8 (fixo) ou
 * 9 (celular) dígitos. Aceita o valor com ou sem máscara.
 */
export function isValidPhone(value: string): boolean {
  const d = onlyDigits(value);
  return d.length === 10 || d.length === 11;
}
