/**
 * Lista central de termos proibidos no frontend/bundle deste produto —
 * nunca fornecedor, API, saldo, créditos, chave, endpoint, modelo ou
 * infraestrutura externa devem chegar ao navegador (ver README.md e
 * CLAUDE.md, seção "Neutralidade do frontend").
 *
 * Fonte única de verdade usada por `check-ui-policy.ts` (código-fonte) e
 * `check-ui-policy-bundle.ts` (bundle compilado em `dist/`). Cada termo tem
 * um `id` estável (usado por allowlists pontuais, se algum dia forem
 * necessárias) e uma `reason` explicando por que é proibido — sem
 * allowlist ampla por diretório: qualquer exceção deve justificar aqui.
 *
 * IMPORTANTE: este arquivo, por definição, CONTÉM os termos proibidos (é o
 * dicionário deles) — é a categoria "arquivo central de termos proibidos"
 * explicitamente permitida pela política. Nunca importado pelo bundle do
 * app (só por scripts Node/tsx e pelos próprios testes da política).
 */

export interface ForbiddenTerm {
  id: string;
  pattern: RegExp;
  reason: string;
  /**
   * 'both' (padrão): checado no código-fonte (spans extraídos) E no bundle
   * compilado. 'source-only': só no código-fonte — reservado para termos
   * curtos/genéricos (ex.: a palavra solta "API") que, no bundle final,
   * colidem com jargão interno de bibliotecas de terceiros (ex.: o
   * namespace público `.API` do jsPDF) sem relação nenhuma com os nossos
   * fornecedores. O que interessa (o fornecedor, o domínio, "saldo",
   * "chave de API", "provedor" etc.) continua coberto nos dois níveis.
   */
  scope?: 'both' | 'source-only';
}

export const FORBIDDEN_TERMS: ForbiddenTerm[] = [
  // ─── Nome/domínio dos fornecedores de dados usados no backend ───────────
  { id: 'vendor-name-fontedata', pattern: /fontedata/i, reason: 'Nome do fornecedor de dados cadastrais de CNPJ' },
  { id: 'vendor-name-apifull', pattern: /apifull/i, reason: 'Nome do fornecedor de perfil completo de CPF' },
  { id: 'vendor-name-dabradata', pattern: /dabradata/i, reason: 'Nome do fornecedor atual de dados cadastrais de CNPJ' },
  {
    id: 'vendor-domain',
    pattern: /\bapp\.fontedata\.com\b|\bfontedata\.com\b|\bapp\.dabradata\.com\b|\bdabradata\.com\b|\bapi\.apifull\.com\.br\b|\bapifull\.com\.br\b/i,
    reason: 'Domínio de fornecedor externo',
  },

  // ─── Termos genéricos que revelam a arquitetura de integração ───────────
  { id: 'word-provedor', pattern: /\bprovedor(?:es)?\b/i, reason: 'Termo genérico que revela arquitetura de fornecedor' },
  { id: 'word-fornecedor', pattern: /\bfornecedor(?:es)?\b/i, reason: 'Termo genérico que revela arquitetura de fornecedor' },
  { id: 'word-vendor', pattern: /\bvendor\b/i, reason: 'Termo genérico (inglês) que revela arquitetura de fornecedor' },
  { id: 'integracao-configurada', pattern: /integra[cç][aã]o\s+configurada/i, reason: 'Expressão que revela existência de integração externa' },
  { id: 'servico-terceiro', pattern: /servi[cç]o\s+terceiro/i, reason: 'Expressão que revela arquitetura de terceiros' },
  { id: 'motor-externo', pattern: /motor\s+externo/i, reason: 'Expressão que revela arquitetura externa' },
  { id: 'identificador-integracao', pattern: /identificador\s+d[aeo]\s+integra[cç][aã]o/i, reason: 'Identificador de integração exposto' },

  // ─── "API" / "endpoint" / "SDK" como jargão técnico exposto ao usuário ──
  // scope: source-only — no bundle final colide com jargão interno de
  // dependências (ex.: o namespace público `.API` do jsPDF), sem relação
  // com os nossos fornecedores. Ver comentário de `scope` acima.
  { id: 'word-api', pattern: /\bAPIs?\b/, reason: 'Palavra "API" em texto técnico exposto ao usuário', scope: 'source-only' },
  { id: 'word-endpoint', pattern: /\bendpoints?\b/i, reason: 'Termo técnico "endpoint"', scope: 'source-only' },
  { id: 'word-sdk', pattern: /\bSDKs?\b/, reason: 'Termo técnico "SDK"', scope: 'source-only' },
  { id: 'chave-de-api', pattern: /chave\s+de\s+api/i, reason: 'Menção a "chave de API"' },
  { id: 'chave-invalida-tecnica', pattern: /chave\s+(inv[aá]lida|ausente|expirada)/i, reason: 'Menção técnica a chave de acesso' },

  // ─── Saldo/créditos da conta do fornecedor (nunca o "score de crédito" da pessoa pesquisada) ──
  { id: 'saldo-conta', pattern: /saldo\s+(insuficiente|dispon[ií]vel|restante|da\s+conta|zerado)/i, reason: 'Saldo da conta do fornecedor' },
  { id: 'creditos-conta', pattern: /cr[ée]ditos?\s+(pagos?|restantes?|esgotados?|insuficientes?|da\s+conta)/i, reason: 'Créditos/consumo da conta do fornecedor' },
  { id: 'consumo-da-conta', pattern: /consumo\s+da\s+conta/i, reason: 'Consumo da conta do fornecedor' },
  { id: 'limite-do-fornecedor', pattern: /limite\s+do\s+fornecedor/i, reason: 'Limite de uso do fornecedor' },
  { id: 'custo-por-consulta', pattern: /custo\s+por\s+consulta/i, reason: 'Custo por consulta (modelo de cobrança do fornecedor)' },
  { id: 'status-conta-fornecedor', pattern: /status\s+da\s+conta\s+(no|do)\s+fornecedor/i, reason: 'Status da conta no fornecedor' },

  // ─── Headers/segredos/payload técnico ────────────────────────────────────
  { id: 'bearer-token', pattern: /\bBearer\s+[A-Za-z0-9._-]{6,}/, reason: 'Token de autorização exposto' },
  { id: 'authorization-header-value', pattern: /Authorization["']?\s*:\s*["'`][^"'`]/i, reason: 'Header de autenticação com valor exposto' },
  { id: 'stack-trace', pattern: /\bat\s+[\w.$]+\s+\(.+:\d+:\d+\)/, reason: 'Stack trace técnico exposto' },
];

/**
 * Allowlist explícita e mínima: cada entrada perdoa UM `termId` em UM
 * arquivo específico, com justificativa. Nunca por diretório inteiro.
 */
export interface AllowlistEntry {
  file: string; // caminho relativo à raiz do repo, com '/' mesmo no Windows
  termId: string;
  justification: string;
}

export const ALLOWLIST: AllowlistEntry[] = [];

/** Subconjunto aplicado ao bundle compilado — exclui termos 'source-only' (ver `ForbiddenTerm.scope`). */
export const BUNDLE_FORBIDDEN_TERMS: ForbiddenTerm[] = FORBIDDEN_TERMS.filter((t) => t.scope !== 'source-only');
