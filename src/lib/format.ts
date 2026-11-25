export function onlyDigits(v: string): string {
  return v.replace(/\D+/g, '');
}

export function formatCNPJ(cnpj: string): string {
  const d = onlyDigits(cnpj).padStart(14, '0');
  if (d.length !== 14) return cnpj;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function formatCPF(cpf: string): string {
  const d = onlyDigits(cpf);
  if (d.length !== 11) return cpf; // pode vir mascarado da Receita
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** Máscara progressiva para digitação de CNPJ (não preenche zeros) */
export function maskCNPJ(value: string): string {
  const d = onlyDigits(value).slice(0, 14);
  let out = d;
  if (d.length > 2) out = `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length > 5) out = `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length > 8) out = `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  if (d.length > 12) out = `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return out;
}

/** Máscara progressiva para digitação de CPF (não preenche zeros) */
export function maskCPF(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  let out = d;
  if (d.length > 3) out = `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length > 6) out = `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  if (d.length > 9) out = `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return out;
}

/**
 * Normaliza um telefone brasileiro para só DDD + número (10 ou 11 dígitos):
 * remove pontuação e um eventual prefixo de país "55" (ex.: "+55 11 9…").
 */
export function normalizePhone(value: string): string {
  const d = onlyDigits(value);
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d.slice(2);
  return d;
}

/**
 * Telefone brasileiro com DDD: fixo (10 dígitos, começando com 2–8 depois do
 * DDD) ou celular (11 dígitos, começando com 9). DDD válido = dois dígitos de 1 a 9.
 */
export function isValidPhone(value: string): boolean {
  const d = normalizePhone(value);
  if (d.length !== 10 && d.length !== 11) return false;
  if (!/^[1-9]{2}/.test(d)) return false;
  if (d.length === 11 && d[2] !== '9') return false;
  // Fixo começa com 2–8; 10 dígitos começando com 9 é um celular incompleto.
  if (d.length === 10 && !/[2-8]/.test(d[2])) return false;
  if (/^(\d)\1+$/.test(d)) return false;
  return true;
}

/** Máscara progressiva para digitação de telefone: (11) 98765-4321 ou (11) 3456-7890. */
export function maskPhone(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length === 0) return '';
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  if (rest.length <= 4) return `(${ddd}) ${rest}`;
  const split = d.length === 11 ? 5 : 4;
  return `(${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`;
}

export function formatPhone(value: string): string {
  const d = normalizePhone(value);
  if (d.length !== 10 && d.length !== 11) return value;
  return maskPhone(d);
}

/**
 * Posição do cursor, dentro de uma string já mascarada (CNPJ/CPF), logo após
 * o N-ésimo dígito — usada para devolver o cursor ao lugar certo depois de
 * reformatar em `onChange` (senão o React reposiciona pro fim do valor a
 * cada tecla, e apagar/editar no meio do texto fica impossível). `0` dígitos
 * antes do cursor → cursor no início.
 */
export function caretPositionForDigitCount(masked: string, digitCount: number): number {
  if (digitCount <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < masked.length; i++) {
    if (/\d/.test(masked[i])) {
      seen++;
      if (seen === digitCount) return i + 1;
    }
  }
  return masked.length;
}

export function isValidCNPJ(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + w * Number(d[i]), 0);
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

export function isValidCPF(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

export function formatCurrency(value?: number): string {
  if (value == null) return '—';
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

/** Moeda compacta no estilo do mockup: R$ 48,7 mi */
export function formatCompactCurrency(value?: number): string {
  if (value == null) return '—';
  if (value >= 1e9) return `R$ ${(value / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} bi`;
  if (value >= 1e6) return `R$ ${(value / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (value >= 1e3) return `R$ ${(value / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`;
  return formatCurrency(value);
}

export function formatDate(iso?: string): string {
  if (!iso) return '—';
  const dt = new Date(iso + (iso.length === 10 ? 'T12:00:00' : ''));
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleDateString('pt-BR');
}

export function normalizeText(v: string): string {
  return v
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}
