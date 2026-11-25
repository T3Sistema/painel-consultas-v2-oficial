import { isValidCPF, isValidPhone, normalizePhone, onlyDigits } from '../lib/format';
import { isPlainObject } from './personPayload';
import { neutralErrorFromBody, readNeutralErrorMessage } from './proxyError';

/** Uma pessoa vinculada ao telefone pesquisado. */
export interface PhoneMatch {
  cpf: string;
  nome?: string;
  nascimento?: string;
}

/**
 * Busca as pessoas vinculadas a um telefone pela rota interna
 * `/api/consulta-telefone`. O dossiê de cada pessoa é aberto depois pelo
 * fluxo normal de CPF. Erros já chegam neutralizados pelo servidor e só são
 * lidos via `readNeutralErrorMessage`.
 */
export async function findPeopleByPhone(telefone: string): Promise<PhoneMatch[]> {
  if (!isValidPhone(telefone)) {
    throw new Error('Telefone inválido: informe DDD + número (10 ou 11 dígitos).');
  }

  const res = await fetch('/api/consulta-telefone', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telefone: normalizePhone(telefone) }),
  });

  if (res.status === 404) return [];
  if (!res.ok) throw new Error(await readNeutralErrorMessage(res));

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error('Não foi possível processar a resposta da consulta.');
  }
  const envelope = neutralErrorFromBody(data);
  if (envelope) {
    if (envelope.code === 'not_found') return [];
    throw new Error(envelope.message);
  }
  if (!isPlainObject(data) || !Array.isArray(data.pessoas)) return [];

  const out: PhoneMatch[] = [];
  for (const item of data.pessoas) {
    if (!isPlainObject(item)) continue;
    const cpf = onlyDigits(String(item.cpf ?? ''));
    if (!isValidCPF(cpf)) continue;
    out.push({
      cpf,
      nome: typeof item.nome === 'string' ? item.nome : undefined,
      nascimento: typeof item.nascimento === 'string' ? item.nascimento : undefined,
    });
  }
  return out;
}
