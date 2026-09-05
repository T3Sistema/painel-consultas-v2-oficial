// @vitest-environment jsdom
// graphStore.ts lê `document`/`localStorage` no topo do módulo (tema) — precisa de DOM.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphLink, GraphNode } from '../types/graph';
import { addOrMergeLink, companyId, personId, useGraphStore } from './graphStore';
import { usePersonProfileStore } from './personProfileStore';
import { FonteDataProvider } from '../services/fontedata';

// Fixtures sintéticas conhecidas (não são documentos/empresas reais).
const PERSON_CPF = '11144477735';
const OUTRO_SOCIO_CPF = '52998224725';
const NEW_CNPJ = '11222333000181';
const FAILING_CNPJ = '44556677000186';
const CNPJ_2 = '10000002118569';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function apiFullSuccess(sociedades: Record<string, unknown>[]) {
  return jsonResponse({ status: 'sucesso', dados: { SERVICE_RESPONSE: { sociedades } } });
}

function fonteDataCompany(cnpj: string, socios: Record<string, unknown>[]) {
  return jsonResponse({
    cnpj,
    razaoSocial: `EMPRESA ${cnpj} LTDA`,
    situacaoCadastral: 'ATIVA',
    socios,
  });
}

function resetStores() {
  useGraphStore.setState({
    // instância nova a cada teste — o cache interno do FonteDataProvider não
    // pode vazar entre testes que reusam os mesmos CNPJs de fixture.
    providers: { cadastral: new FonteDataProvider() },
    nodes: [],
    links: [],
    nodeIndex: new Map(),
    timeline: [],
    rootId: null,
    selectedNodeId: null,
    breadcrumb: [],
    expandingIds: new Set(),
    loading: false,
    error: null,
    notice: null,
    currentLayer: 1,
    layerLoading: false,
    graphEpoch: 0,
    maxDepth: 5,
    searchPhase: 'idle',
    searchProfilesTotal: 0,
    searchProfilesDone: 0,
    searchProfilesFailed: 0,
    searchFailedCpfs: [],
    searchPendingRootId: null,
  });
  usePersonProfileStore.setState({
    profilesByCpf: new Map(),
    requestsByCpf: new Map(),
    errorsByCpf: new Map(),
    sociedadesStatusByCpf: new Map(),
    queue: [],
    processing: false,
    queueTotal: 0,
    queueDone: 0,
    queueFailed: 0,
  });
}

function putPersonNode(depth: number): GraphNode {
  const node: GraphNode = {
    id: personId(PERSON_CPF),
    kind: 'person',
    label: 'FULANO DE TAL',
    depth,
    expanded: false,
    person: { cpf: PERSON_CPF, nome: 'FULANO DE TAL' },
  };
  useGraphStore.setState((s) => {
    const idx = new Map(s.nodeIndex);
    idx.set(node.id, node);
    return { nodeIndex: idx, nodes: [...idx.values()] };
  });
  return node;
}

describe('expandNode em nó pessoa (pipeline APIFull → FonteData)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetStores();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('empresa descoberta via sociedades[] e todos os seus sócios entram na MESMA camada (não uma camada acima)', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/consulta-pessoa')) {
        return apiFullSuccess([
          {
            cnpj: NEW_CNPJ,
            razao_social: 'EMPRESA NOVA LTDA',
            situacao_cadastral: 'ATIVA',
            qualificacao_socio_descricao: 'Sócio',
            dt_entrada: '10/05/2024',
            nome_socio: 'FULANO DE TAL',
            documento_socio: PERSON_CPF,
          },
        ]);
      }
      if (url.includes(`CNPJ=${NEW_CNPJ}`)) {
        return fonteDataCompany(NEW_CNPJ, [
          { nome: 'FULANO DE TAL', cargo: 'Sócio', documento: PERSON_CPF },
          { nome: 'OUTRO SOCIO', cargo: 'Sócio', documento: OUTRO_SOCIO_CPF },
        ]);
      }
      return jsonResponse({ message: 'unexpected' }, 404);
    });

    const person = putPersonNode(1); // pessoa na camada 2 (depth 1)
    await useGraphStore.getState().expandNode(person.id, { force: true });

    const state = useGraphStore.getState();
    const newCompany = state.nodeIndex.get(companyId(NEW_CNPJ));
    const otherSocio = state.nodeIndex.get(personId(OUTRO_SOCIO_CPF));
    expect(newCompany?.depth).toBe(2); // pessoa.depth (1) + 1
    expect(otherSocio?.depth).toBe(2); // mesma camada da empresa — não 3
    expect(person.expanded).toBe(true);
  });

  it('relação Empresa→Pessoa da APIFull sobrevive mesmo se a FonteData falhar (não some, sem duplicar depois)', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/consulta-pessoa')) {
        return apiFullSuccess([
          {
            cnpj: NEW_CNPJ,
            razao_social: 'EMPRESA NOVA LTDA',
            qualificacao_socio_descricao: 'Sócio Administrador',
            documento_socio: PERSON_CPF,
            nome_socio: 'FULANO DE TAL',
          },
        ]);
      }
      if (url.includes(`CNPJ=${NEW_CNPJ}`)) {
        return jsonResponse({ code: 'invalid_parameters', message: 'erro simulado' }, 400);
      }
      return jsonResponse({ message: 'unexpected' }, 404);
    });

    const person = putPersonNode(0);
    await useGraphStore.getState().expandNode(person.id, { force: true });

    const state = useGraphStore.getState();
    const link = state.links.find((l) => {
      const s = typeof l.source === 'string' ? l.source : l.source.id;
      return s === person.id;
    });
    expect(link).toBeDefined();
    expect(link?.meta.origem).toBe('Consulta por CPF');
    expect(link?.type).toBe('ADMINISTRADOR');
    // falha parcial: pessoa continua não-expandida (permite tentar de novo)
    expect(person.expanded).toBe(false);
    expect(state.notice).toMatch(/parcial/i);
  });

  it('não duplica a aresta quando a FonteData confirma a mesma pessoa depois (dedup por par, não por tipo)', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/consulta-pessoa')) {
        return apiFullSuccess([
          {
            cnpj: NEW_CNPJ,
            qualificacao_socio_descricao: 'Sócio', // mapeia pra SOCIO
            documento_socio: PERSON_CPF,
            nome_socio: 'FULANO DE TAL',
          },
        ]);
      }
      if (url.includes(`CNPJ=${NEW_CNPJ}`)) {
        // FonteData descreve a mesma pessoa com qualificação diferente (mapeia pra ADMINISTRADOR)
        return fonteDataCompany(NEW_CNPJ, [{ nome: 'FULANO DE TAL', cargo: 'Sócio Administrador', documento: PERSON_CPF }]);
      }
      return jsonResponse({ message: 'unexpected' }, 404);
    });

    const person = putPersonNode(0);
    await useGraphStore.getState().expandNode(person.id, { force: true });

    const pair = useGraphStore.getState().links.filter((l) => {
      const s = typeof l.source === 'string' ? l.source : l.source.id;
      const t = typeof l.target === 'string' ? l.target : l.target.id;
      return s === person.id && t === companyId(NEW_CNPJ);
    });
    expect(pair).toHaveLength(1);
  });

  it('falha parcial: uma empresa com sucesso não é perdida quando outra falha; retry só reprocessa a que falhou', async () => {
    let fonteDataCallsForFailingCnpj = 0;
    let fonteDataCallsForNewCnpj = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/consulta-pessoa')) {
        return apiFullSuccess([
          { cnpj: NEW_CNPJ, qualificacao_socio_descricao: 'Sócio', documento_socio: PERSON_CPF, nome_socio: 'FULANO' },
          { cnpj: FAILING_CNPJ, qualificacao_socio_descricao: 'Sócio', documento_socio: PERSON_CPF, nome_socio: 'FULANO' },
        ]);
      }
      if (url.includes(`CNPJ=${NEW_CNPJ}`)) {
        fonteDataCallsForNewCnpj += 1;
        return fonteDataCompany(NEW_CNPJ, [{ nome: 'FULANO', cargo: 'Sócio', documento: PERSON_CPF }]);
      }
      if (url.includes(`CNPJ=${FAILING_CNPJ}`)) {
        fonteDataCallsForFailingCnpj += 1;
        if (fonteDataCallsForFailingCnpj === 1) return jsonResponse({ message: 'erro simulado' }, 500);
        return fonteDataCompany(FAILING_CNPJ, [{ nome: 'FULANO', cargo: 'Sócio', documento: PERSON_CPF }]);
      }
      return jsonResponse({ message: 'unexpected' }, 404);
    });

    const person = putPersonNode(0);
    await useGraphStore.getState().expandNode(person.id, { force: true });

    let state = useGraphStore.getState();
    expect(state.nodeIndex.get(companyId(NEW_CNPJ))?.expanded).toBe(true);
    expect(state.nodeIndex.get(companyId(FAILING_CNPJ))?.expanded).toBe(false);
    expect(person.expanded).toBe(false); // falha parcial — permite retry

    // retry: novo expandNode no mesmo nó (perfil já em cache, não rechama a APIFull)
    await useGraphStore.getState().expandNode(person.id, { force: true });

    state = useGraphStore.getState();
    expect(state.nodeIndex.get(companyId(FAILING_CNPJ))?.expanded).toBe(true);
    expect(person.expanded).toBe(true);
    // sucesso anterior não foi reconsultado; APIFull não foi chamada de novo (cache)
    expect(fonteDataCallsForNewCnpj).toBe(1);
    expect(fonteDataCallsForFailingCnpj).toBe(2);
    const apiFullCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/api/consulta-pessoa')).length;
    expect(apiFullCalls).toBe(1);
  });
});

describe('addOrMergeLink — acumula qualificações de fontes diferentes sem perder nenhuma', () => {
  const EMPRESA = companyId(NEW_CNPJ);
  const PESSOA = personId(PERSON_CPF);

  const apiFullMeta = { funcao: 'Sócio', origem: 'APIFull / sociedades', dataEntrada: '2024-01-01', situacao: 'ATIVO' };
  const fonteDataMeta = {
    funcao: 'Sócio-Administrador',
    origem: 'FonteData',
    dataEntrada: '2024-06-01',
    situacao: 'ATIVA',
  };

  it('1. mesma empresa, pessoa e qualificação: não duplica', () => {
    const links: GraphLink[] = [];
    addOrMergeLink(links, PESSOA, EMPRESA, 'SOCIO', apiFullMeta);
    addOrMergeLink(links, PESSOA, EMPRESA, 'SOCIO', apiFullMeta);

    expect(links).toHaveLength(1); // uma única conexão visual
    expect(links[0].meta.relations).toEqual(['SOCIO']);
    expect(links[0].meta.qualificacoes).toEqual(['Sócio']);
    expect(links[0].meta.origens).toEqual(['APIFull / sociedades']);
  });

  it('2. mesma empresa e pessoa, qualificações diferentes: mescla sem perder nenhuma', () => {
    const links: GraphLink[] = [];
    addOrMergeLink(links, PESSOA, EMPRESA, 'SOCIO', apiFullMeta);
    addOrMergeLink(links, PESSOA, EMPRESA, 'ADMINISTRADOR', fonteDataMeta);

    expect(links).toHaveLength(1); // não cria duas linhas sobrepostas no mapa
    expect(links[0].meta.relations).toEqual(['SOCIO', 'ADMINISTRADOR']);
    expect(links[0].meta.qualificacoes).toEqual(['Sócio', 'Sócio-Administrador']);
  });

  it('3. APIFull respondendo antes da FonteData', () => {
    const links: GraphLink[] = [];
    addOrMergeLink(links, PESSOA, EMPRESA, 'SOCIO', apiFullMeta);
    addOrMergeLink(links, PESSOA, EMPRESA, 'ADMINISTRADOR', fonteDataMeta);

    expect(links).toHaveLength(1);
    expect(links[0].meta.relations).toEqual(['SOCIO', 'ADMINISTRADOR']);
    expect(links[0].meta.qualificacoes).toEqual(['Sócio', 'Sócio-Administrador']);
    expect(links[0].meta.origens).toEqual(['APIFull / sociedades', 'FonteData']);
  });

  it('4. FonteData respondendo antes da APIFull — mesmo resultado final (ordem não importa)', () => {
    const links: GraphLink[] = [];
    addOrMergeLink(links, PESSOA, EMPRESA, 'ADMINISTRADOR', fonteDataMeta);
    addOrMergeLink(links, PESSOA, EMPRESA, 'SOCIO', apiFullMeta);

    expect(links).toHaveLength(1);
    expect(links[0].meta.relations).toEqual(['SOCIO', 'ADMINISTRADOR']);
    expect(links[0].meta.qualificacoes).toEqual(['Sócio', 'Sócio-Administrador']);
    expect(links[0].meta.origens).toEqual(['APIFull / sociedades', 'FonteData']);
  });

  it('5. preserva metadados das duas fontes (origens e datas distintas); campos principais vêm da evidência primária (prioridade fixa, não a que chegou primeiro)', () => {
    const links: GraphLink[] = [];
    addOrMergeLink(links, PESSOA, EMPRESA, 'SOCIO', apiFullMeta);
    addOrMergeLink(links, PESSOA, EMPRESA, 'ADMINISTRADOR', fonteDataMeta);

    const meta = links[0].meta;
    expect(meta.origens).toEqual(['APIFull / sociedades', 'FonteData']);
    expect(meta.datasEntrada).toEqual(['2024-01-01', '2024-06-01']);
    // campos "principais" (compatibilidade) vêm da evidência de maior prioridade (ADMINISTRADOR),
    // não da que chegou primeiro (que foi SOCIO/APIFull) — prioridade fixa, não ordem de chegada.
    expect(meta.origem).toBe('FonteData');
    expect(meta.dataEntrada).toBe('2024-06-01');
    expect(meta.funcao).toBe('Sócio-Administrador');
  });

  it('1. evidências preservam a associação completa entre relação, qualificação, origem e data de cada fonte', () => {
    const links: GraphLink[] = [];
    addOrMergeLink(links, PESSOA, EMPRESA, 'SOCIO', apiFullMeta);
    addOrMergeLink(links, PESSOA, EMPRESA, 'ADMINISTRADOR', fonteDataMeta);

    expect(links[0].meta.evidencias).toEqual([
      expect.objectContaining({
        relation: 'ADMINISTRADOR',
        qualificacao: 'Sócio-Administrador',
        origem: 'FonteData',
        dataEntrada: '2024-06-01',
      }),
      expect.objectContaining({
        relation: 'SOCIO',
        qualificacao: 'Sócio',
        origem: 'APIFull / sociedades',
        dataEntrada: '2024-01-01',
      }),
    ]);
  });

  it('1b. mesma empresa/pessoa/qualificação: não duplica evidência (dedup pela combinação completa)', () => {
    const links: GraphLink[] = [];
    addOrMergeLink(links, PESSOA, EMPRESA, 'SOCIO', apiFullMeta);
    addOrMergeLink(links, PESSOA, EMPRESA, 'SOCIO', apiFullMeta);
    expect(links[0].meta.evidencias).toHaveLength(1);
  });

  it('2. resultado completo (evidencias + todos os campos derivados) não depende da ordem de chegada das APIs', () => {
    const linksA: GraphLink[] = [];
    addOrMergeLink(linksA, PESSOA, EMPRESA, 'SOCIO', apiFullMeta);
    addOrMergeLink(linksA, PESSOA, EMPRESA, 'ADMINISTRADOR', fonteDataMeta);

    const linksB: GraphLink[] = [];
    addOrMergeLink(linksB, PESSOA, EMPRESA, 'ADMINISTRADOR', fonteDataMeta);
    addOrMergeLink(linksB, PESSOA, EMPRESA, 'SOCIO', apiFullMeta);

    expect(linksA[0].meta).toEqual(linksB[0].meta);
  });
});

describe('prefetch automático de perfis via APIFull (fila de segundo plano)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let apiFullCallCount = 0;

  beforeEach(() => {
    resetStores();
    apiFullCallCount = 0;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function drainProfileQueue() {
    await vi.waitFor(() => {
      const s = usePersonProfileStore.getState();
      if (s.processing || s.queue.length > 0) throw new Error('fila de perfis ainda processando');
    });
  }

  it('4. startSearch dispara prefetch automático dos sócios pessoa física em segundo plano', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/consulta-pessoa')) {
        apiFullCallCount += 1;
        return apiFullSuccess([]);
      }
      if (url.includes(`CNPJ=${NEW_CNPJ}`)) {
        return fonteDataCompany(NEW_CNPJ, [
          { nome: 'FULANO DE TAL', cargo: 'Sócio', documento: PERSON_CPF },
          { nome: 'OUTRO SOCIO', cargo: 'Sócio', documento: OUTRO_SOCIO_CPF },
        ]);
      }
      return jsonResponse({ message: 'unexpected' }, 404);
    });

    await useGraphStore.getState().startSearch(NEW_CNPJ);
    await drainProfileQueue();

    expect(usePersonProfileStore.getState().profilesByCpf.has(PERSON_CPF)).toBe(true);
    expect(usePersonProfileStore.getState().profilesByCpf.has(OUTRO_SOCIO_CPF)).toBe(true);
    expect(apiFullCallCount).toBe(2);
  });

  it('10. prefetch nunca altera o grafo — só popula o cache de perfis, nunca adiciona nós/camadas', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/consulta-pessoa')) {
        // o perfil pré-carregado já revela uma NOVA empresa em sociedades[] — isso
        // não pode aparecer no grafo antes do usuário clicar '+'.
        return apiFullSuccess([
          {
            cnpj: CNPJ_2,
            razao_social: 'EMPRESA DESCOBERTA SO NO PERFIL',
            qualificacao_socio_descricao: 'Sócio',
            documento_socio: PERSON_CPF,
            nome_socio: 'FULANO DE TAL',
          },
        ]);
      }
      if (url.includes(`CNPJ=${NEW_CNPJ}`)) {
        return fonteDataCompany(NEW_CNPJ, [{ nome: 'FULANO DE TAL', cargo: 'Sócio', documento: PERSON_CPF }]);
      }
      return jsonResponse({ message: 'unexpected' }, 404);
    });

    await useGraphStore.getState().startSearch(NEW_CNPJ);
    const nodesRightAfterSearch = useGraphStore.getState().nodeIndex.size;
    await drainProfileQueue();

    expect(usePersonProfileStore.getState().profilesByCpf.has(PERSON_CPF)).toBe(true);
    // nó da empresa só apareceu no perfil pré-carregado — não pode ter entrado no grafo
    expect(useGraphStore.getState().nodeIndex.has(companyId(CNPJ_2))).toBe(false);
    expect(useGraphStore.getState().nodeIndex.size).toBe(nodesRightAfterSearch);
  });

  it('11. próxima camada reaproveita o perfil já pré-carregado — não rechama a APIFull pro mesmo CPF', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/consulta-pessoa')) {
        apiFullCallCount += 1;
        return apiFullSuccess([]); // sem sociedades novas — só testa reaproveitamento do perfil
      }
      if (url.includes(`CNPJ=${NEW_CNPJ}`)) {
        return fonteDataCompany(NEW_CNPJ, [{ nome: 'FULANO DE TAL', cargo: 'Sócio', documento: PERSON_CPF }]);
      }
      return jsonResponse({ message: 'unexpected' }, 404);
    });

    await useGraphStore.getState().startSearch(NEW_CNPJ);
    await drainProfileQueue();
    expect(apiFullCallCount).toBe(1); // prefetch já consultou o único sócio pessoa física

    await useGraphStore.getState().nextLayer(); // avança e expande a pessoa (fronteira)
    expect(apiFullCallCount).toBe(1); // reaproveitou o cache — nenhuma chamada nova
  });

  it('12. sócios de uma empresa recém-mesclada na camada seguinte já são enfileirados automaticamente', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/consulta-pessoa')) {
        apiFullCallCount += 1;
        if (apiFullCallCount === 1) {
          // 1ª chamada: perfil do sócio original, que revela uma nova empresa (CNPJ_2)
          return apiFullSuccess([
            {
              cnpj: CNPJ_2,
              razao_social: 'EMPRESA CAMADA 3',
              qualificacao_socio_descricao: 'Sócio',
              documento_socio: PERSON_CPF,
              nome_socio: 'FULANO DE TAL',
            },
          ]);
        }
        return apiFullSuccess([]); // sócio novo da CNPJ_2, sem mais sociedades
      }
      if (url.includes(`CNPJ=${NEW_CNPJ}`)) {
        return fonteDataCompany(NEW_CNPJ, [{ nome: 'FULANO DE TAL', cargo: 'Sócio', documento: PERSON_CPF }]);
      }
      if (url.includes(`CNPJ=${CNPJ_2}`)) {
        return fonteDataCompany(CNPJ_2, [
          { nome: 'FULANO DE TAL', cargo: 'Sócio', documento: PERSON_CPF },
          { nome: 'SOCIO NOVO DA CAMADA 3', cargo: 'Sócio', documento: OUTRO_SOCIO_CPF },
        ]);
      }
      return jsonResponse({ message: 'unexpected' }, 404);
    });

    await useGraphStore.getState().startSearch(NEW_CNPJ);
    await drainProfileQueue(); // prefetch inicial (só PERSON_CPF) esvazia a fila

    await useGraphStore.getState().nextLayer(); // expande a pessoa: descobre CNPJ_2 e mescla seus sócios
    await drainProfileQueue(); // aguarda o prefetch (fire-and-forget) disparado após o merge da nova empresa

    // o novo sócio (OUTRO_SOCIO_CPF) descoberto na empresa CNPJ_2 já deve estar
    // pré-carregado, sem qualquer ação extra do usuário.
    expect(usePersonProfileStore.getState().profilesByCpf.has(OUTRO_SOCIO_CPF)).toBe(true);
  });
});

describe('startSearch — mapa só abre após o lote da APIFull; sem race condition', () => {
  const CNPJ_RACE_A = '10000004000191';
  const CNPJ_RACE_B = '10000005000172';

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetStores();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('1. resposta de uma pesquisa antiga nunca abre nem substitui o mapa da pesquisa atual', async () => {
    let resolveCompanyA: (() => void) | undefined;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes(`CNPJ=${CNPJ_RACE_A}`)) {
        return new Promise((resolve) => {
          resolveCompanyA = () => resolve(fonteDataCompany(CNPJ_RACE_A, []));
        });
      }
      if (url.includes(`CNPJ=${CNPJ_RACE_B}`)) {
        return fonteDataCompany(CNPJ_RACE_B, []);
      }
      if (url.includes('/api/consulta-pessoa')) return apiFullSuccess([]);
      return jsonResponse({ message: 'unexpected' }, 404);
    });

    const searchA = useGraphStore.getState().startSearch(CNPJ_RACE_A);
    await Promise.resolve(); // A começa (fetch da FonteData pendente)

    await useGraphStore.getState().startSearch(CNPJ_RACE_B); // B conclui por completo primeiro
    expect(useGraphStore.getState().rootId).toBe(companyId(CNPJ_RACE_B));

    resolveCompanyA?.(); // A finalmente responde, tarde demais
    await searchA;

    // A não pode ter reaberto nem substituído o mapa de B
    expect(useGraphStore.getState().rootId).toBe(companyId(CNPJ_RACE_B));
  });

  it('2. mapa (rootId) permanece oculto enquanto o lote de perfis da APIFull não termina', async () => {
    let resolveProfile: (() => void) | undefined;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/consulta-pessoa')) {
        return new Promise((resolve) => {
          resolveProfile = () => resolve(apiFullSuccess([]));
        });
      }
      if (url.includes(`CNPJ=${NEW_CNPJ}`)) {
        return fonteDataCompany(NEW_CNPJ, [{ nome: 'FULANO DE TAL', cargo: 'Sócio', documento: PERSON_CPF }]);
      }
      return jsonResponse({ message: 'unexpected' }, 404);
    });

    const promise = useGraphStore.getState().startSearch(NEW_CNPJ);
    await vi.waitFor(() => {
      if (useGraphStore.getState().searchPhase !== 'profiles') throw new Error('ainda não chegou em profiles');
    });
    expect(useGraphStore.getState().rootId).toBeNull();
    expect(useGraphStore.getState().loading).toBe(true);

    resolveProfile?.();
    await promise;
    expect(useGraphStore.getState().rootId).toBe(companyId(NEW_CNPJ));
    expect(useGraphStore.getState().searchPhase).toBe('done');
  });

  it('3. falha em CPF do lote inicial não abre o mapa — fica em awaiting-decision, mas não interrompe os demais', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/consulta-pessoa')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { cpf?: string };
        if (body.cpf === PERSON_CPF) return jsonResponse({ message: 'erro' }, 500);
        return apiFullSuccess([]);
      }
      if (url.includes(`CNPJ=${NEW_CNPJ}`)) {
        return fonteDataCompany(NEW_CNPJ, [
          { nome: 'FULANO DE TAL', cargo: 'Sócio', documento: PERSON_CPF },
          { nome: 'OUTRO SOCIO', cargo: 'Sócio', documento: OUTRO_SOCIO_CPF },
        ]);
      }
      return jsonResponse({ message: 'unexpected' }, 404);
    });

    await useGraphStore.getState().startSearch(NEW_CNPJ);

    expect(useGraphStore.getState().rootId).toBeNull();
    expect(useGraphStore.getState().searchPhase).toBe('awaiting-decision');
    expect(useGraphStore.getState().searchFailedCpfs).toEqual([PERSON_CPF]);
    // o sócio que não falhou já foi carregado normalmente (falha de 1 não trava os demais)
    expect(usePersonProfileStore.getState().profilesByCpf.has(OUTRO_SOCIO_CPF)).toBe(true);
  });

  it('4. continueWithAvailableData libera o mapa mesmo com falhas pendentes', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/consulta-pessoa')) return jsonResponse({ message: 'erro' }, 500);
      if (url.includes(`CNPJ=${NEW_CNPJ}`)) {
        return fonteDataCompany(NEW_CNPJ, [{ nome: 'FULANO DE TAL', cargo: 'Sócio', documento: PERSON_CPF }]);
      }
      return jsonResponse({ message: 'unexpected' }, 404);
    });

    await useGraphStore.getState().startSearch(NEW_CNPJ);
    expect(useGraphStore.getState().rootId).toBeNull();

    useGraphStore.getState().continueWithAvailableData();
    expect(useGraphStore.getState().rootId).toBe(companyId(NEW_CNPJ));
    expect(useGraphStore.getState().searchPhase).toBe('done');
  });

  it('5. retryFailedSearchProfiles reprocessa só os CPFs que falharam e libera o mapa quando todos passam', async () => {
    let apifullCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/consulta-pessoa')) {
        apifullCalls += 1;
        if (apifullCalls === 1) return jsonResponse({ message: 'erro' }, 500);
        return apiFullSuccess([]);
      }
      if (url.includes(`CNPJ=${NEW_CNPJ}`)) {
        return fonteDataCompany(NEW_CNPJ, [{ nome: 'FULANO DE TAL', cargo: 'Sócio', documento: PERSON_CPF }]);
      }
      return jsonResponse({ message: 'unexpected' }, 404);
    });

    await useGraphStore.getState().startSearch(NEW_CNPJ);
    expect(useGraphStore.getState().searchPhase).toBe('awaiting-decision');

    await useGraphStore.getState().retryFailedSearchProfiles();
    expect(useGraphStore.getState().rootId).toBe(companyId(NEW_CNPJ));
    expect(useGraphStore.getState().searchPhase).toBe('done');
    expect(useGraphStore.getState().searchFailedCpfs).toEqual([]);
    expect(apifullCalls).toBe(2); // 1ª falhou, 2ª (retry) passou — nunca reconsultou o que já tinha dado certo
  });
});

describe('startPersonSearch — Consulta Avançada (busca por CPF)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetStores();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('1. CPF sem sociedades abre o mapa só com o nó pessoa (label = CPF formatado)', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/consulta-pessoa')) return apiFullSuccess([]);
      return jsonResponse({ message: 'unexpected' }, 404);
    });

    await useGraphStore.getState().startPersonSearch(PERSON_CPF);

    const state = useGraphStore.getState();
    expect(state.rootId).toBe(personId(PERSON_CPF));
    expect(state.searchPhase).toBe('done');
    expect(state.loading).toBe(false);
    expect(state.nodes).toHaveLength(1);
    expect(state.nodeIndex.get(personId(PERSON_CPF))?.label).toBe('111.444.777-35');
    expect(state.nodeIndex.get(personId(PERSON_CPF))?.expanded).toBe(true);
  });

  it('2. CPF com sociedades cria os nós placeholder, enriquece via FonteData e abre o mapa', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/consulta-pessoa')) {
        return apiFullSuccess([
          {
            cnpj: NEW_CNPJ,
            razao_social: 'EMPRESA NOVA LTDA',
            situacao_cadastral: 'ATIVA',
            qualificacao_socio_descricao: 'Sócio',
            dt_entrada: '10/05/2024',
            nome_socio: 'FULANO DE TAL',
            documento_socio: PERSON_CPF,
          },
        ]);
      }
      if (url.includes(`CNPJ=${NEW_CNPJ}`)) {
        return fonteDataCompany(NEW_CNPJ, [{ nome: 'FULANO DE TAL', cargo: 'Sócio', documento: PERSON_CPF }]);
      }
      return jsonResponse({ message: 'unexpected' }, 404);
    });

    await useGraphStore.getState().startPersonSearch(PERSON_CPF);

    const state = useGraphStore.getState();
    const rootId = personId(PERSON_CPF);
    expect(state.rootId).toBe(rootId);
    expect(state.nodeIndex.get(rootId)?.label).toBe('FULANO DE TAL');
    expect(state.nodeIndex.get(rootId)?.expanded).toBe(true);
    const company = state.nodeIndex.get(companyId(NEW_CNPJ));
    expect(company?.depth).toBe(1);
    expect(company?.company?.razaoSocial).toBe(`EMPRESA ${NEW_CNPJ} LTDA`);
    expect(state.searchPhase).toBe('done');
  });

  it('3. falha ao buscar o perfil do CPF raiz não abre o mapa', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/consulta-pessoa')) return jsonResponse({ message: 'erro' }, 500);
      return jsonResponse({ message: 'unexpected' }, 404);
    });

    await useGraphStore.getState().startPersonSearch(PERSON_CPF);

    const state = useGraphStore.getState();
    expect(state.rootId).toBeNull();
    expect(state.searchPhase).toBe('error');
    expect(state.error).toBeTruthy();
  });

  it('4. falha parcial no enriquecimento de uma sociedade ainda assim abre o mapa, com a pessoa não-expandida', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/consulta-pessoa')) {
        return apiFullSuccess([
          {
            cnpj: NEW_CNPJ,
            qualificacao_socio_descricao: 'Sócio',
            documento_socio: PERSON_CPF,
            nome_socio: 'FULANO DE TAL',
          },
          {
            cnpj: FAILING_CNPJ,
            qualificacao_socio_descricao: 'Sócio',
            documento_socio: PERSON_CPF,
            nome_socio: 'FULANO DE TAL',
          },
        ]);
      }
      if (url.includes(`CNPJ=${NEW_CNPJ}`)) {
        return fonteDataCompany(NEW_CNPJ, [{ nome: 'FULANO DE TAL', cargo: 'Sócio', documento: PERSON_CPF }]);
      }
      if (url.includes(`CNPJ=${FAILING_CNPJ}`)) {
        return jsonResponse({ code: 'invalid_parameters', message: 'erro simulado' }, 400);
      }
      return jsonResponse({ message: 'unexpected' }, 404);
    });

    await useGraphStore.getState().startPersonSearch(PERSON_CPF);

    const state = useGraphStore.getState();
    const rootId = personId(PERSON_CPF);
    expect(state.rootId).toBe(rootId); // falha parcial não bloqueia a abertura do mapa
    expect(state.nodeIndex.get(rootId)?.expanded).toBe(false); // permite tentar de novo
    expect(state.notice).toMatch(/parcial/i);
  });

  it('5. busca por CPF antiga nunca abre nem substitui o mapa da busca atual', async () => {
    // A tem uma sociedade cujo enriquecimento na FonteData fica pendente (controlável);
    // B é uma busca completamente nova, sem sociedades, que conclui primeiro. O próprio
    // perfil da APIFull (que passa pela fila serial única do personProfileStore) resolve
    // na hora para as duas — a "corrida" real acontece no enriquecimento via FonteData,
    // que não passa por essa fila (mesmo padrão do teste equivalente de startSearch).
    let resolveCompanyA: (() => void) | undefined;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/consulta-pessoa')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { cpf?: string };
        if (body.cpf === PERSON_CPF) {
          return apiFullSuccess([
            { cnpj: NEW_CNPJ, qualificacao_socio_descricao: 'Sócio', documento_socio: PERSON_CPF, nome_socio: 'FULANO DE TAL' },
          ]);
        }
        return apiFullSuccess([]);
      }
      if (url.includes(`CNPJ=${NEW_CNPJ}`)) {
        return new Promise((resolve) => {
          resolveCompanyA = () => resolve(fonteDataCompany(NEW_CNPJ, [{ nome: 'FULANO DE TAL', cargo: 'Sócio', documento: PERSON_CPF }]));
        });
      }
      return jsonResponse({ message: 'unexpected' }, 404);
    });

    const searchA = useGraphStore.getState().startPersonSearch(PERSON_CPF);
    await vi.waitFor(() => {
      if (!resolveCompanyA) throw new Error('ainda não chegou no enriquecimento via FonteData');
    });

    await useGraphStore.getState().startPersonSearch(OUTRO_SOCIO_CPF); // B conclui primeiro
    expect(useGraphStore.getState().rootId).toBe(personId(OUTRO_SOCIO_CPF));

    resolveCompanyA?.(); // A finalmente responde, tarde demais
    await searchA;

    expect(useGraphStore.getState().rootId).toBe(personId(OUTRO_SOCIO_CPF));
  });
});

describe('resposta sem a seção de sociedades (conteúdo agrupado em seções)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  // Fixture sintética — mesma forma do envelope por seções, sem sociedades.
  const sectionedPerson = (nome: string) =>
    jsonResponse({
      status: 'sucesso',
      dados: {
        pessoa: {
          identificacao: { cpf: PERSON_CPF, nome },
          contatos: { telefones: ['(11) 4002-8922'] },
        },
      },
    });

  beforeEach(() => {
    resetStores();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('1. o nó raiz é rotulado com o nome da pessoa, não com o CPF', async () => {
    fetchMock.mockResolvedValue(sectionedPerson('FULANO DE TAL'));

    await useGraphStore.getState().startPersonSearch(PERSON_CPF);

    const state = useGraphStore.getState();
    expect(state.nodeIndex.get(personId(PERSON_CPF))?.label).toBe('FULANO DE TAL');
    expect(state.searchPhase).toBe('done');
    expect(state.nodes).toHaveLength(1);
  });

  it('2. avisa que não há participação societária, em vez de deixar o mapa vazio sem explicação', async () => {
    fetchMock.mockResolvedValue(sectionedPerson('FULANO DE TAL'));

    await useGraphStore.getState().startPersonSearch(PERSON_CPF);

    expect(useGraphStore.getState().notice).toContain('participação societária');
  });

  it('3. expandir um nó nessas condições também avisa, e não fica em silêncio', async () => {
    fetchMock.mockResolvedValue(sectionedPerson('FULANO DE TAL'));
    const node = putPersonNode(1);

    await useGraphStore.getState().expandNode(node.id);

    expect(node.expanded).toBe(true);
    expect(useGraphStore.getState().notice).toContain('participação societária');
  });

  it('4. com a seção presente e vazia, segue em silêncio (zero sociedades é resposta, não lacuna)', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/consulta-pessoa')) return apiFullSuccess([]);
      return jsonResponse({ message: 'unexpected' }, 404);
    });

    await useGraphStore.getState().startPersonSearch(PERSON_CPF);

    expect(useGraphStore.getState().notice).toBeNull();
  });
});

describe('foto da pessoa — atualiza o nó automaticamente quando o perfil resolve', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetStores();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('1. perfil resolvido durante a expansão da pessoa atualiza photoUrl do nó', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/consulta-pessoa')) {
        return jsonResponse({
          status: 'sucesso',
          dados: { SERVICE_RESPONSE: { cadastral: { foto: 'https://cdn.example.com/foto.jpg' }, sociedades: [] } },
        });
      }
      return jsonResponse({ message: 'unexpected' }, 404);
    });

    const person = putPersonNode(0);
    await useGraphStore.getState().expandNode(person.id, { force: true });

    expect(useGraphStore.getState().nodeIndex.get(person.id)?.person?.photoUrl).toBe('https://cdn.example.com/foto.jpg');
  });

  it('2. perfil resolvido tardiamente (ex.: usuário abre o painel depois do mapa montado) também atualiza o nó', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/consulta-pessoa')) {
        return jsonResponse({
          status: 'sucesso',
          dados: { SERVICE_RESPONSE: { fotos: ['https://cdn.example.com/tardia.jpg'] } },
        });
      }
      return jsonResponse({ message: 'unexpected' }, 404);
    });

    const person = putPersonNode(0);
    expect(useGraphStore.getState().nodeIndex.get(person.id)?.person?.photoUrl).toBeUndefined();

    // simula o clique no painel de perfil, independente de qualquer expansão de camada
    await usePersonProfileStore.getState().loadProfile(person.person!.cpf);

    expect(useGraphStore.getState().nodeIndex.get(person.id)?.person?.photoUrl).toBe('https://cdn.example.com/tardia.jpg');
  });

  it('3. updatePersonPhoto não faz nada sem URL ou sem nó correspondente no grafo', () => {
    useGraphStore.getState().updatePersonPhoto(PERSON_CPF, undefined);
    expect(useGraphStore.getState().nodeIndex.has(personId(PERSON_CPF))).toBe(false);
    useGraphStore.getState().updatePersonPhoto('00000000000', 'https://cdn.example.com/x.jpg');
    expect(useGraphStore.getState().nodeIndex.has(personId('00000000000'))).toBe(false);
  });
});

describe('buildSnapshot / hydrateFromSnapshot — salvar e reabrir consulta sem chamar as APIs', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetStores();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('1. buildSnapshot retorna null sem pesquisa aberta (sem rootId)', () => {
    expect(useGraphStore.getState().buildSnapshot()).toBeNull();
  });

  it('2. buildSnapshot inclui grafo + perfis sanitizados, mas nunca photoUrl cru nem campos hard', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/api/consulta-pessoa')) {
        return jsonResponse({
          status: 'sucesso',
          dados: {
            SERVICE_RESPONSE: {
              cadastral: { foto: 'https://cdn.example.com/foto.jpg' },
              credenciaisVazadas: [{ senha: 'segredo123' }],
            },
          },
        });
      }
      if (url.includes(`CNPJ=${NEW_CNPJ}`)) {
        return fonteDataCompany(NEW_CNPJ, [{ nome: 'FULANO DE TAL', cargo: 'Sócio', documento: PERSON_CPF }]);
      }
      return jsonResponse({ message: 'unexpected' }, 404);
    });

    await useGraphStore.getState().startSearch(NEW_CNPJ);
    const snapshot = useGraphStore.getState().buildSnapshot();

    expect(snapshot).not.toBeNull();
    expect(snapshot!.rootId).toBe(companyId(NEW_CNPJ));
    expect(snapshot!.nodes.length).toBeGreaterThan(0);
    const personNode = snapshot!.nodes.find((n) => n.id === personId(PERSON_CPF));
    expect(personNode?.person?.photoUrl).toBeUndefined(); // nunca persiste photoUrl cru
    expect(snapshot!.profiles[PERSON_CPF]).toBeDefined();
    expect(JSON.stringify(snapshot!.profiles[PERSON_CPF])).not.toContain('segredo123'); // campo hard removido
  });

  it('3. hydrateFromSnapshot restaura o grafo e os perfis sem chamar FonteData/APIFull', () => {
    const snapshot = {
      rootId: companyId(NEW_CNPJ),
      nodes: [
        { id: companyId(NEW_CNPJ), kind: 'company' as const, label: 'EMPRESA X', depth: 0, expanded: true, company: { cnpj: NEW_CNPJ, razaoSocial: 'EMPRESA X', situacao: 'ATIVA' as const } },
        { id: personId(PERSON_CPF), kind: 'person' as const, label: 'FULANO', depth: 1, expanded: false, person: { cpf: PERSON_CPF, nome: 'FULANO' } },
      ],
      links: [],
      currentLayer: 1,
      maxDepth: 5,
      filters: useGraphStore.getState().filters,
      profiles: { [PERSON_CPF]: { SERVICE_RESPONSE: { cadastral: { nome: 'FULANO' } } } },
    };

    useGraphStore.getState().hydrateFromSnapshot(snapshot, { [personId(PERSON_CPF)]: 'https://supabase.example.com/signed/foto.jpg' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useGraphStore.getState().rootId).toBe(companyId(NEW_CNPJ));
    expect(useGraphStore.getState().nodeIndex.get(personId(PERSON_CPF))?.person?.photoUrl).toBe(
      'https://supabase.example.com/signed/foto.jpg',
    );
    expect(usePersonProfileStore.getState().profilesByCpf.get(PERSON_CPF)).toEqual(snapshot.profiles[PERSON_CPF]);
  });
});

describe('nextLayer — aguarda só o lote de CPFs da própria camada (não a fila inteira)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetStores();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('1. layerLoading permanece true até o sócio de uma empresa descoberta em cascata terminar (não só a fronteira original)', async () => {
    let resolveCascadeProfile: (() => void) | undefined;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/consulta-pessoa')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { cpf?: string };
        if (body.cpf === PERSON_CPF) {
          return apiFullSuccess([
            { cnpj: NEW_CNPJ, qualificacao_socio_descricao: 'Sócio', documento_socio: PERSON_CPF, nome_socio: 'FULANO' },
          ]);
        }
        if (body.cpf === OUTRO_SOCIO_CPF) {
          return new Promise((resolve) => {
            resolveCascadeProfile = () => resolve(apiFullSuccess([]));
          });
        }
        return apiFullSuccess([]);
      }
      if (url.includes(`CNPJ=${NEW_CNPJ}`)) {
        return fonteDataCompany(NEW_CNPJ, [
          { nome: 'FULANO', cargo: 'Sócio', documento: PERSON_CPF },
          { nome: 'OUTRO', cargo: 'Sócio', documento: OUTRO_SOCIO_CPF },
        ]);
      }
      return jsonResponse({ message: 'unexpected' }, 404);
    });

    useGraphStore.setState({ rootId: 'fake-root', currentLayer: 1 });
    putPersonNode(0);

    const promise = useGraphStore.getState().nextLayer();
    expect(useGraphStore.getState().layerLoading).toBe(true);

    await vi.waitFor(() => {
      if (!resolveCascadeProfile) throw new Error('perfil do sócio em cascata ainda não começou');
    });
    // a empresa nova (e o link pessoa→empresa) já está no grafo, mas o perfil do
    // sócio descoberto nela ainda está pendente — layerLoading não pode ter caído.
    expect(useGraphStore.getState().layerLoading).toBe(true);
    expect(useGraphStore.getState().nodeIndex.has(companyId(NEW_CNPJ))).toBe(true);

    resolveCascadeProfile?.();
    await promise;
    expect(useGraphStore.getState().layerLoading).toBe(false);
    expect(usePersonProfileStore.getState().profilesByCpf.has(OUTRO_SOCIO_CPF)).toBe(true);
  });

  it('2. nextLayer resolve assim que o lote da própria camada termina, sem esperar itens alheios travados na fila global', async () => {
    const UNRELATED_CPF = '39053344705';
    let resolveCascadeProfile: (() => void) | undefined;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/consulta-pessoa')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { cpf?: string };
        if (body.cpf === PERSON_CPF) {
          return apiFullSuccess([
            { cnpj: NEW_CNPJ, qualificacao_socio_descricao: 'Sócio', documento_socio: PERSON_CPF, nome_socio: 'FULANO' },
          ]);
        }
        if (body.cpf === OUTRO_SOCIO_CPF) {
          return new Promise((resolve) => {
            resolveCascadeProfile = () => resolve(apiFullSuccess([]));
          });
        }
        if (body.cpf === UNRELATED_CPF) {
          return new Promise(() => {}); // nunca resolve — item alheio a esta camada
        }
        return apiFullSuccess([]);
      }
      if (url.includes(`CNPJ=${NEW_CNPJ}`)) {
        return fonteDataCompany(NEW_CNPJ, [
          { nome: 'FULANO', cargo: 'Sócio', documento: PERSON_CPF },
          { nome: 'OUTRO', cargo: 'Sócio', documento: OUTRO_SOCIO_CPF },
        ]);
      }
      return jsonResponse({ message: 'unexpected' }, 404);
    });

    useGraphStore.setState({ rootId: 'fake-root', currentLayer: 1 });
    putPersonNode(0);

    const promise = useGraphStore.getState().nextLayer();
    await vi.waitFor(() => {
      if (!resolveCascadeProfile) throw new Error('perfil do sócio em cascata ainda não começou');
    });
    resolveCascadeProfile?.();
    // Enquanto a resolução acima ainda está em voo (microtask), uma operação
    // totalmente alheia a esta camada enfileira um CPF que nunca termina —
    // isso não pode fazer nextLayer travar esperando por ele.
    usePersonProfileStore.getState().prefetchProfiles([UNRELATED_CPF]);

    await promise;
    expect(useGraphStore.getState().layerLoading).toBe(false);
  });
});
