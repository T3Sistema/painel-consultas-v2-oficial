import { isValidCNPJ, isValidCPF, onlyDigits } from '../lib/format';
import { isPlainObject, normalizePersonSections } from './personPayload';
import { readNeutralErrorMessage } from './proxyError';

/**
 * Perfil completo devolvido pela rota interna de consulta de pessoa, sempre
 * no formato consolidado (mapa plano de seções). `SERVICE_RESPONSE` é
 * preservado integralmente — a origem pode adicionar novas seções no futuro
 * e nenhuma chave é descartada aqui.
 */
export interface ApiFullProfile {
  SERVICE_RESPONSE: Record<string, unknown>;
}

/** Um item de `SERVICE_RESPONSE.sociedades[]` — única parte da resposta que pode alterar o grafo. */
export interface ApiFullSociedade {
  cnpj: string;
  razaoSocial?: string;
  situacaoCadastral?: string;
  qualificacaoSocioDescricao?: string;
  dtEntrada?: string;
  nomeSocio?: string;
  documentoSocio: string;
}

export class PersonNotFoundError extends Error {
  constructor(cpf: string) {
    super(`CPF ${cpf} não encontrado.`);
    this.name = 'PersonNotFoundError';
  }
}

/**
 * Lê o corpo de uma resposta bem-sucedida e devolve sempre o mapa plano de
 * seções, ou `null` quando o corpo não é reconhecível.
 *
 * Duas formas são aceitas — a consolidada (`dados.SERVICE_RESPONSE`) e a por
 * seções (`dados.pessoa`, convertida por `normalizePersonSections`). Só o
 * conteúdo pesquisado atravessa: nenhuma chave irmã fora dessas duas é lida,
 * então carimbos de origem e demais metadados técnicos do corpo nunca chegam
 * ao painel, aos exports ou ao que é salvo.
 */
function readServiceResponse(data: unknown): Record<string, unknown> | null {
  if (!isPlainObject(data)) return null;
  if (data.status !== 'sucesso') return null;
  if (!isPlainObject(data.dados)) return null;

  const { SERVICE_RESPONSE: consolidado, pessoa } = data.dados;
  if (isPlainObject(consolidado)) return consolidado;
  if (isPlainObject(pessoa)) return normalizePersonSections(pessoa);
  return null;
}

/**
 * Consulta o perfil completo de uma pessoa através da rota interna
 * `/api/consulta-pessoa` — nenhuma credencial ou detalhe de origem chega ao
 * cliente. Erros do servidor já vêm neutralizados (ver
 * `api/_lib/upstreamError.ts`); `readNeutralErrorMessage` nunca repassa texto
 * cru mesmo que o formato mude inesperadamente. Sem cache aqui: o
 * cache/dedup mora em `personProfileStore`, compartilhado entre o clique no
 * painel e a expansão de camada.
 */
export async function getApiFullProfile(cpf: string): Promise<ApiFullProfile> {
  const digits = onlyDigits(cpf);
  if (!isValidCPF(digits)) {
    throw new Error('CPF inválido: informe um CPF com 11 dígitos e dígitos verificadores válidos.');
  }

  const res = await fetch('/api/consulta-pessoa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cpf: digits }),
  });

  if (res.status === 404) throw new PersonNotFoundError(digits);
  if (!res.ok) {
    throw new Error(await readNeutralErrorMessage(res));
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error('Não foi possível processar a resposta da consulta.');
  }

  const serviceResponse = readServiceResponse(data);
  if (!serviceResponse) {
    throw new Error('Consulta sem sucesso ou em formato inesperado.');
  }

  return { SERVICE_RESPONSE: serviceResponse };
}

/**
 * `true` quando a resposta traz a seção de sociedades — mesmo vazia. Serve
 * para o grafo distinguir "esta pessoa não tem sociedades" de "esta consulta
 * não traz participação societária", que dão o mesmo `extractSociedades()`
 * vazio mas significam coisas diferentes para quem está investigando.
 */
export function hasSociedadesSection(profile: ApiFullProfile): boolean {
  return Array.isArray(profile.SERVICE_RESPONSE.sociedades);
}

/** Nome da pessoa consultada, quando a resposta o traz — usado como rótulo do nó raiz. */
export function extractPersonName(profile: ApiFullProfile): string | undefined {
  const cadastral = profile.SERVICE_RESPONSE.cadastral;
  if (!isPlainObject(cadastral)) return undefined;
  const nome = cadastral.nome;
  return typeof nome === 'string' && nome.trim() !== '' ? nome.trim() : undefined;
}

/**
 * Extrai e valida `SERVICE_RESPONSE.sociedades[]` — só CPF (11 dígitos,
 * checksum válido) e CNPJ (14 dígitos, checksum válido) são aceitos; itens
 * malformados são descartados silenciosamente (dado desconhecido/ruído, não
 * um erro de consulta).
 */
export function extractSociedades(profile: ApiFullProfile): ApiFullSociedade[] {
  const raw = profile.SERVICE_RESPONSE.sociedades;
  if (!Array.isArray(raw)) return [];

  const result: ApiFullSociedade[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const it = item as Record<string, unknown>;
    const cnpj = onlyDigits(String(it.cnpj ?? ''));
    const documentoSocio = onlyDigits(String(it.documento_socio ?? ''));
    if (!isValidCNPJ(cnpj) || !isValidCPF(documentoSocio)) continue;
    result.push({
      cnpj,
      razaoSocial: typeof it.razao_social === 'string' ? it.razao_social : undefined,
      situacaoCadastral: typeof it.situacao_cadastral === 'string' ? it.situacao_cadastral : undefined,
      qualificacaoSocioDescricao:
        typeof it.qualificacao_socio_descricao === 'string' ? it.qualificacao_socio_descricao : undefined,
      dtEntrada: typeof it.dt_entrada === 'string' ? it.dt_entrada : undefined,
      nomeSocio: typeof it.nome_socio === 'string' ? it.nome_socio : undefined,
      documentoSocio,
    });
  }
  return result;
}
