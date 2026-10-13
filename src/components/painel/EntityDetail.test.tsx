// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EntityDetail } from './EntityDetail';
import { usePersonProfileStore } from '../../store/personProfileStore';
import { addOrMergeLink, companyId, personId, useGraphStore } from '../../store/graphStore';
import type { ApiFullProfile } from '../../services/apifull';
import type { GraphLink, GraphNode } from '../../types/graph';

const PERSON_CPF = '11144477735';
const PARENTE_CPF = '52998224725'; // CPF sintético válido (checksum ok)
const RAW_PASSWORD = 'iade0509';
const RAW_EMAIL_PASSWORD = '1605jabuti';
const PLACE_PHOTO_URL = 'https://reidasfotosbr.com/v1/5ec61918064767d2f0c6fa8b5ac71b734cad';

const PROFILE: ApiFullProfile = {
  SERVICE_RESPONSE: {
    cadastral: {
      nome: 'FULANO DE TAL',
      cpfMask: '111.444.777-35',
      dataNasc: '16/03/1973',
      idade: 53,
      sexo: 'M',
      signo: 'Peixes',
      signoChines: 'Boi',
      classeSocial: 'A',
      escolaridade: 'SUPERIOR COMPLETO',
      mae: { nome: 'MARIA JOSE' },
      pai: { nome: 'CICERO' },
      cns: 700004153088603,
      pis: 12625028019,
      tituloEleitor: { numero: 16854861716, zona: '1', secao: '248' },
    },
    cnh: { nome: 'FULANO DE TAL', registro: '00560237696', uf_cnh: 'AL' },
    parentes: [
      { grau: 'Filho', nome: 'MARIA LUZIMAR', cpfParente: PARENTE_CPF, idade: 26, renda: 'R$ 1.621,00', cidade: 'Maceió', uf: 'AL', profissao: 'Continuo' },
    ],
    telefones: [{ ddd: '82', tel: '996302401', telefone: '(82) 996302401', flagWhatsApp: false, classificacao: 'A', data: '19/01/2025', prioridade: 7 }],
    sociedades: [
      { razao_social: 'WRV LTDA', cnpj: '21819440000145', qualificacao_socio_descricao: 'Sócio-Administrador', situacao_cadastral: 'ATIVA', dt_entrada: '09/03/2021' },
    ],
    credenciaisVazadas: [
      { tipo: 'EMAIL', valor: 'x@y.com', resultados: [{ host: 'accounts.google.com', login: 'x@y.com', password: RAW_PASSWORD, file_date: '2024-01-01' }] },
    ],
    emails: [{ email: 'x@y.com', password: RAW_EMAIL_PASSWORD, avaliacao: 'RUIM' }],
    movimentacoesOnline: [
      {
        email: 'x@y.com',
        fonte: 'GOOGLE_MAPS',
        fotos: [{ url: PLACE_PHOTO_URL, local: 'Local Teste', endereco: 'Rua Teste, 1' }],
        perfil: { nome: 'Fulano', nivel: 1, nomeNivel: 'Nível 1', pontosTotal: 1 },
        reviews: [],
        contribuicoes: [],
      },
    ],
    placas: [],
    linhaDoTempo: [{ data: '1973-03-16', categoria: 'PESSOAL', descricao: 'Nascimento de <b>Fulano</b>' }],
  },
};

const PERSON_NODE: GraphNode = {
  id: personId(PERSON_CPF),
  kind: 'person',
  label: 'FULANO DE TAL',
  depth: 0,
  expanded: false,
  person: { cpf: PERSON_CPF, nome: 'FULANO DE TAL' },
};

const COMPANY_NODE: GraphNode = {
  id: companyId('11222333000181'),
  kind: 'company',
  label: 'EMPRESA TESTE LTDA',
  depth: 0,
  expanded: true,
  company: {
    cnpj: '11222333000181',
    razaoSocial: 'EMPRESA TESTE LTDA',
    situacao: 'ATIVA',
    capitalSocial: 100000,
    cnaePrincipal: { codigo: '6920601', descricao: 'Atividades de contabilidade' },
  },
};

function seedProfileCache() {
  usePersonProfileStore.setState({
    profilesByCpf: new Map([[PERSON_CPF, PROFILE]]),
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

function selectNode(node: GraphNode, extraNodes: GraphNode[] = [], links: GraphLink[] = []) {
  const nodeIndex = new Map<string, GraphNode>();
  [node, ...extraNodes].forEach((n) => nodeIndex.set(n.id, n));
  useGraphStore.setState({
    nodeIndex,
    nodes: [...nodeIndex.values()],
    links,
    selectedNodeId: node.id,
    unsavedChanges: false,
  });
}

const PAGE_LABELS = [
  'Cadastral & Civil',
  'Contatos & Endereços',
  'Financeiro & Consumo',
  'Carreira & Negócios',
  'Jurídico',
  'Cyber Sec & Vazamentos',
  'Presença & Viagens',
  'Bens & Patrimônio',
  'Saúde',
  'Timeline',
];

describe('EntityDetail — pessoa em tela cheia com o dicionário de campos', () => {
  beforeEach(() => {
    seedProfileCache();
    selectNode(PERSON_NODE);
  });
  afterEach(() => cleanup());

  it('renderiza as 9 abas nomeadas na ordem pedida', () => {
    render(<EntityDetail />);
    for (const l of PAGE_LABELS) {
      expect(screen.getByRole('button', { name: new RegExp(l) })).toBeInTheDocument();
    }
  });

  it('a aba Cadastral & Civil mostra as seções curadas (Registro Civil, Título de Eleitor, CNH)', () => {
    render(<EntityDetail />);
    expect(screen.getByText('Dados de Registro Civil & RFB')).toBeInTheDocument();
    expect(screen.getByText('Título de Eleitor')).toBeInTheDocument();
    expect(screen.getByText('Dados de Habilitação (CNH)')).toBeInTheDocument();
    // valor derivado/curado com rótulo em pt-BR
    expect(screen.getByText('Signo ocidental')).toBeInTheDocument();
    expect(screen.getByText('Peixes')).toBeInTheDocument();
    // card de parentesco com botão Consultar
    expect(screen.getByText('MARIA LUZIMAR')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Consultar' })).toBeInTheDocument();
  });

  it('trocar de aba muda o conteúdo (Bens & Patrimônio mostra estado vazio)', () => {
    render(<EntityDetail />);
    fireEvent.click(screen.getByRole('button', { name: /Bens & Patrimônio/ }));
    expect(screen.getByText('Nenhum veículo/placa encontrado.')).toBeInTheDocument();
    expect(screen.queryByText('Dados de Registro Civil & RFB')).not.toBeInTheDocument();
  });

  it('senha vazada vem mascarada por padrão, mas pode ser revelada com o botão de olho', () => {
    const { container } = render(<EntityDetail />);
    fireEvent.click(screen.getByRole('button', { name: /Cyber Sec & Vazamentos/ }));
    expect(screen.getByText('accounts.google.com')).toBeInTheDocument();
    expect(container.textContent).not.toContain(RAW_PASSWORD);

    const revealBtn = container.querySelector('.cy-pass .profile-reveal');
    expect(revealBtn).toBeTruthy();
    fireEvent.click(revealBtn as Element);
    expect(container.textContent).toContain(RAW_PASSWORD);
  });

  it('"Senha vazada" do e-mail também vem mascarada com botão de revelar (mesma categoria de dado)', () => {
    const { container } = render(<EntityDetail />);
    fireEvent.click(screen.getByRole('button', { name: /Contatos & Endereços/ }));
    expect(container.textContent).not.toContain(RAW_EMAIL_PASSWORD);

    const passwordCard = screen.getByText('Senha vazada').closest('.ef-card');
    const revealBtn = passwordCard?.querySelector('.profile-reveal');
    expect(revealBtn).toBeTruthy();
    fireEvent.click(revealBtn as Element);
    expect(container.textContent).toContain(RAW_EMAIL_PASSWORD);
  });

  it('foto dentro de um objeto genérico (ex.: movimentacoesOnline[].fotos[].url) vira miniatura clicável, nunca a URL crua como texto', () => {
    render(<EntityDetail />);
    fireEvent.click(screen.getByRole('button', { name: /Presença & Viagens/ }));
    expect(screen.queryByText(PLACE_PHOTO_URL)).not.toBeInTheDocument();
    const thumb = screen.getByRole('button', { name: /Ampliar imagem/ });
    expect(thumb.querySelector('img')).toHaveAttribute('src', PLACE_PHOTO_URL);
  });

  it('a busca reúne seções de todas as páginas que casam', () => {
    render(<EntityDetail />);
    fireEvent.change(screen.getByPlaceholderText('Buscar nas informações'), { target: { value: 'WRV' } });
    expect(screen.getByText('Sociedades (empresas)')).toBeInTheDocument();
    // "WRV" fica destacado (quebrado por <mark>); confere um campo não destacado do mesmo registro
    expect(screen.getByText('Sócio-Administrador')).toBeInTheDocument();
  });

  it('não omite nenhum campo — mostra também os campos fora do conjunto curado', () => {
    render(<EntityDetail />);
    fireEvent.click(screen.getByRole('button', { name: /Contatos & Endereços/ }));
    // "prioridade" e "ddd" não estão nos campos curados de telefone, mas aparecem mesmo assim
    expect(screen.getByText('Prioridade')).toBeInTheDocument();
    expect(screen.getByText('Ddd')).toBeInTheDocument();
  });

  it('a aba "Contatos & Endereços" traz a visão geral calculada e os dois domínios', () => {
    render(<EntityDetail />);
    fireEvent.click(screen.getByRole('button', { name: /Contatos & Endereços/ }));
    expect(screen.getByText('Visão geral dos contatos')).toBeInTheDocument();
    expect(screen.getByText('Formas de contato')).toBeInTheDocument();
    expect(screen.getByText('Localização & vínculos')).toBeInTheDocument();
    // seções continuam presentes por padrão (filtro "Todos") — nada é escondido
    expect(screen.getByRole('button', { name: /^Telefones/ })).toBeInTheDocument();
  });

  it('cards de parente trazem a tag de vínculo (Filho/Sócio/…)', () => {
    render(<EntityDetail />);
    expect(screen.getByText('Filho')).toBeInTheDocument();
  });

  it('clicar em "Consultar" num parente dispara uma nova consulta', () => {
    const startPersonSearch = vi.fn();
    useGraphStore.setState({ startPersonSearch });
    render(<EntityDetail />);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar' }));
    expect(startPersonSearch).toHaveBeenCalledWith(PARENTE_CPF);
  });

  it('a aba "Timeline" mostra a linha do tempo (resumo + evento com HTML removido)', () => {
    render(<EntityDetail />);
    fireEvent.click(screen.getByRole('button', { name: /Timeline/ }));
    // Cabeçalho/resumo da nova página
    expect(screen.getByText('Linha do tempo')).toBeInTheDocument();
    // Evento: HTML da descrição é removido antes de exibir
    expect(screen.getByText('Nascimento de Fulano')).toBeInTheDocument();
    // A "Linha do tempo" saiu da aba "Saúde"
    fireEvent.click(screen.getByRole('button', { name: /Saúde/ }));
    expect(screen.queryByText('Nascimento de Fulano')).not.toBeInTheDocument();
  });
});

describe('EntityDetail — empresa em página única', () => {
  beforeEach(() => {
    seedProfileCache();
    const links: GraphLink[] = [];
    addOrMergeLink(links, PERSON_NODE.id, COMPANY_NODE.id, 'SOCIO', { funcao: 'Sócio', origem: 'Teste' });
    selectNode(COMPANY_NODE, [PERSON_NODE], links);
  });
  afterEach(() => cleanup());

  it('mostra CNPJ, situação e informações gerais sem abas de pessoa', () => {
    render(<EntityDetail />);
    expect(screen.getByText('11.222.333/0001-81')).toBeInTheDocument();
    expect(screen.getByText('Informações gerais')).toBeInTheDocument();
    expect(screen.getByText(/Atividades de contabilidade/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cyber Sec & Vazamentos/ })).not.toBeInTheDocument();
  });

  it('clicar numa conexão navega para a entidade relacionada', () => {
    render(<EntityDetail />);
    fireEvent.click(screen.getByRole('button', { name: /FULANO DE TAL/ }));
    expect(useGraphStore.getState().selectedNodeId).toBe(PERSON_NODE.id);
  });

  it('AUDITORIA DE NEUTRALIDADE: razão social pesquisada que coincide com nome de fornecedor de dados é exibida intacta, sem alteração (o produto nunca adultera conteúdo legítimo pesquisado)', () => {
    const vendorLikeCompany: GraphNode = {
      ...COMPANY_NODE,
      label: 'FONTEDATA CONSULTORIA EMPRESARIAL LTDA',
      company: {
        ...COMPANY_NODE.company!,
        razaoSocial: 'FONTEDATA CONSULTORIA EMPRESARIAL LTDA',
        nomeFantasia: 'APIFULL SOLUÇÕES',
      },
    };
    selectNode(vendorLikeCompany, [PERSON_NODE], []);
    render(<EntityDetail />);
    expect(screen.getAllByText('FONTEDATA CONSULTORIA EMPRESARIAL LTDA').length).toBeGreaterThan(0);
    expect(screen.getAllByText('APIFULL SOLUÇÕES').length).toBeGreaterThan(0);
  });
});

describe('EntityDetail — aba "Financeiro & Consumo" (cockpit + cartões)', () => {
  const FIN_PROFILE: ApiFullProfile = {
    SERVICE_RESPONSE: {
      contasBancos: [
        { banco: 'Banco do Brasil', agencia: '1234', conta: '567890', codBanco: '001', tipoConta: 'Corrente' },
      ],
      irpf: [
        { ano: 2023, situacao: 'Restituído', lote: '3', banco: 'Caixa', agencia: '0001', dt_lote: '2023-08-31', numeroRecibo: 'REC-9' },
      ],
      ccf: [{ ocorrencia: 1 }],
      propensoes: { cpf: PERSON_CPF, csb8: 5, csb8_faixa: 'B', propensaoCartao: 1, propensaoViagem: 0 },
    },
  };

  beforeEach(() => {
    usePersonProfileStore.setState({
      profilesByCpf: new Map([[PERSON_CPF, FIN_PROFILE]]),
      requestsByCpf: new Map(),
      errorsByCpf: new Map(),
      sociedadesStatusByCpf: new Map(),
      queue: [],
      processing: false,
      queueTotal: 0,
      queueDone: 0,
      queueFailed: 0,
    });
    selectNode(PERSON_NODE);
  });
  afterEach(() => cleanup());

  it('cockpit acusa o sinal de risco quando há cheque sem fundo', () => {
    render(<EntityDetail />);
    fireEvent.click(screen.getByRole('button', { name: /Financeiro & Consumo/ }));
    expect(screen.getByText('1 sinal de atenção')).toBeInTheDocument();
    // "Consta" aparece na célula de sinal de cheques sem fundo
    expect(screen.getAllByText('Consta').length).toBeGreaterThan(0);
  });

  it('conta bancária vira cartão sem perder nenhum campo (inclusive os não curados)', () => {
    render(<EntityDetail />);
    fireEvent.click(screen.getByRole('button', { name: /Financeiro & Consumo/ }));
    expect(screen.getByText('Banco do Brasil')).toBeInTheDocument();
    // "tipoConta" não está no conjunto curado, mas nada é omitido (rótulo presente)
    expect(screen.getByText('Tipo Conta')).toBeInTheDocument();
  });

  it('IRPF vira linha de restituições e mantém os campos não curados', () => {
    render(<EntityDetail />);
    fireEvent.click(screen.getByRole('button', { name: /Financeiro & Consumo/ }));
    expect(screen.getByText('Restituído')).toBeInTheDocument();
    expect(screen.getByText('2023')).toBeInTheDocument();
    // "numeroRecibo" é campo não curado do registro de IRPF
    expect(screen.getByText('Numero Recibo')).toBeInTheDocument();
  });
});

describe('EntityDetail — aba "Presença & Viagens" (pegada digital)', () => {
  const PRES_PROFILE: ApiFullProfile = {
    SERVICE_RESPONSE: {
      viagens: [{ destino: 'Lisboa', pais: 'Portugal', data: '2023-07-10', companhia: 'TAP' }],
      movimentacoesOnline: [
        {
          email: 'x@y.com',
          fonte: 'GOOGLE_MAPS',
          fotos: [{ url: PLACE_PHOTO_URL, local: 'Praça Central', endereco: 'Rua A, 1' }],
          perfil: { nome: 'Fulano', nivel: 5, nomeNivel: 'Nível 5', pontosTotal: 1200 },
          reviews: [{ local: 'Restaurante X', nota: 4 }],
          contribuicoes: [],
        },
      ],
      estrangeiro: { situacao: 'Naturalizado', pais_origem: 'Argentina' },
    },
  };

  beforeEach(() => {
    usePersonProfileStore.setState({
      profilesByCpf: new Map([[PERSON_CPF, PRES_PROFILE]]),
      requestsByCpf: new Map(),
      errorsByCpf: new Map(),
      sociedadesStatusByCpf: new Map(),
      queue: [],
      processing: false,
      queueTotal: 0,
      queueDone: 0,
      queueFailed: 0,
    });
    selectNode(PERSON_NODE);
  });
  afterEach(() => cleanup());

  it('monta a pegada digital com resumo, Local Guide e situação migratória', () => {
    render(<EntityDetail />);
    fireEvent.click(screen.getByRole('button', { name: /Presença & Viagens/ }));
    expect(screen.getByText(/Pegada digital/)).toBeInTheDocument();
    expect(screen.getByText(/Local Guide · Nível 5/)).toBeInTheDocument();
    expect(screen.getByText('Situação migratória registrada')).toBeInTheDocument();
  });

  it('fotos do Google Maps viram miniatura clicável e nada é omitido', () => {
    render(<EntityDetail />);
    fireEvent.click(screen.getByRole('button', { name: /Presença & Viagens/ }));
    // foto vira thumbnail (nunca URL crua)
    expect(screen.queryByText(PLACE_PHOTO_URL)).not.toBeInTheDocument();
    const thumb = screen.getByRole('button', { name: /Ampliar imagem/ });
    expect(thumb.querySelector('img')).toHaveAttribute('src', PLACE_PHOTO_URL);
    // caption/campos do lugar e da viagem preservados
    expect(screen.getByText('Praça Central')).toBeInTheDocument();
    expect(screen.getByText('Lisboa')).toBeInTheDocument();
  });
});

describe('EntityDetail — aba "Bens & Patrimônio" (inventário)', () => {
  const PAT_PROFILE: ApiFullProfile = {
    SERVICE_RESPONSE: {
      placas: [
        { placa: 'ABC1D23', marca: 'VW', modelo: 'Nivus', ano: 2022, cor: 'Prata', chassi: '9BW...' },
      ],
      aeronaves: [
        { matricula: 'PT-XYZ', fabricante: 'Embraer', modelo: 'Phenom 300' },
      ],
    },
  };

  beforeEach(() => {
    usePersonProfileStore.setState({
      profilesByCpf: new Map([[PERSON_CPF, PAT_PROFILE]]),
      requestsByCpf: new Map(),
      errorsByCpf: new Map(),
      sociedadesStatusByCpf: new Map(),
      queue: [],
      processing: false,
      queueTotal: 0,
      queueDone: 0,
      queueFailed: 0,
    });
    selectNode(PERSON_NODE);
  });
  afterEach(() => cleanup());

  it('monta o inventário com as coleções de bens e a placa promovida', () => {
    render(<EntityDetail />);
    fireEvent.click(screen.getByRole('button', { name: /Bens & Patrimônio/ }));
    expect(screen.getByText('Inventário de bens')).toBeInTheDocument();
    expect(screen.getByText('ABC1D23')).toBeInTheDocument(); // placa
    expect(screen.getByText('PT-XYZ')).toBeInTheDocument(); // aeronave (via ProfileCardEntries)
  });

  it('não perde nenhum campo do veículo (curados e não previstos)', () => {
    render(<EntityDetail />);
    fireEvent.click(screen.getByRole('button', { name: /Bens & Patrimônio/ }));
    // demais campos do veículo aparecem no corpo do cartão (campos exclusivos do veículo)
    expect(screen.getByText('Marca')).toBeInTheDocument();
    expect(screen.getByText('Cor')).toBeInTheDocument();
    expect(screen.getByText('Chassi')).toBeInTheDocument();
  });
});

describe('EntityDetail — aba "Cyber Sec & Vazamentos" (central de ameaças)', () => {
  const CYBER_PROFILE: ApiFullProfile = {
    SERVICE_RESPONSE: {
      credenciaisVazadas: [
        {
          tipo: 'EMAIL',
          valor: 'fulano@example.com',
          origem: 'Coleção #1',
          resultados: [
            { host: 'accounts.google.com', url: 'https://accounts.google.com/x', login: 'fulano@example.com', password: 'iade0509', file_date: '2024-01-01', hash: 'abc123' },
          ],
        },
      ],
    },
  };

  beforeEach(() => {
    usePersonProfileStore.setState({
      profilesByCpf: new Map([[PERSON_CPF, CYBER_PROFILE]]),
      requestsByCpf: new Map(),
      errorsByCpf: new Map(),
      sociedadesStatusByCpf: new Map(),
      queue: [],
      processing: false,
      queueTotal: 0,
      queueDone: 0,
      queueFailed: 0,
    });
    selectNode(PERSON_NODE);
  });
  afterEach(() => cleanup());

  it('console acusa exposição e mede a força da senha sem revelá-la', () => {
    const { container } = render(<EntityDetail />);
    fireEvent.click(screen.getByRole('button', { name: /Cyber Sec & Vazamentos/ }));
    expect(screen.getByText('Exposição detectada')).toBeInTheDocument();
    // força derivada (8 caracteres) aparece sem expor a senha
    expect(screen.getByText(/8 caract\./)).toBeInTheDocument();
    expect(container.textContent).not.toContain('iade0509');
  });

  it('não perde campos não previstos do alvo nem do breach', () => {
    render(<EntityDetail />);
    fireEvent.click(screen.getByRole('button', { name: /Cyber Sec & Vazamentos/ }));
    // "origem" é chave do alvo fora do conjunto tipo/valor/resultados
    expect(screen.getByText('Origem')).toBeInTheDocument();
    // "hash" é chave do breach fora de host/url/login/password/file_date
    expect(screen.getByText('Hash')).toBeInTheDocument();
  });
});

describe('EntityDetail — aba "Carreira & Negócios" (trajetória)', () => {
  const CAR_PROFILE: ApiFullProfile = {
    SERVICE_RESPONSE: {
      sociedades: [
        { razao_social: 'WRV LTDA', cnpj: '21819440000145', qualificacao_socio_descricao: 'Sócio-Administrador', situacao_cadastral: 'ATIVA', dt_entrada: '09/03/2021', capitalSocial: 50000 },
      ],
      empregos: [
        { razao_social: 'ALPHA S/A', descricao_cbo: 'Analista', salario: 4200, data_admissao: '01/02/2015', data_demissao: '30/06/2019', cnpj_empregador: '11222333000181', matricula: 'A-77' },
      ],
      rais: [
        { razao_social: 'BETA ME', cnpj: '99888777000166', ano_base: 2014, admissao: '2014-03-01', demissao_tratada: '2014-12-20' },
      ],
      ppe: [{ cargo: 'Assessor', orgao: 'Prefeitura' }],
      inscricoesOab: [{ numero: '12345', uf: 'AL' }],
    },
  };

  beforeEach(() => {
    usePersonProfileStore.setState({
      profilesByCpf: new Map([[PERSON_CPF, CAR_PROFILE]]),
      requestsByCpf: new Map(),
      errorsByCpf: new Map(),
      sociedadesStatusByCpf: new Map(),
      queue: [],
      processing: false,
      queueTotal: 0,
      queueDone: 0,
      queueFailed: 0,
    });
    selectNode(PERSON_NODE);
  });
  afterEach(() => cleanup());

  it('funde sociedades, empregos e RAIS numa trajetória única', () => {
    render(<EntityDetail />);
    fireEvent.click(screen.getByRole('button', { name: /Carreira & Negócios/ }));
    expect(screen.getByText('Trajetória profissional')).toBeInTheDocument();
    expect(screen.getByText('WRV LTDA')).toBeInTheDocument();
    expect(screen.getByText('ALPHA S/A')).toBeInTheDocument();
    expect(screen.getByText('BETA ME')).toBeInTheDocument();
    // panorama acusa exposição política
    expect(screen.getByText('Politicamente exposta (PPE)')).toBeInTheDocument();
  });

  it('não perde nenhum campo dos registros da trajetória (curados e não curados)', () => {
    render(<EntityDetail />);
    fireEvent.click(screen.getByRole('button', { name: /Carreira & Negócios/ }));
    // campo curado não usado no "rosto" do cartão (salário do emprego)
    expect(screen.getByText('Salário')).toBeInTheDocument();
    // campo NÃO curado do emprego — nada é omitido
    expect(screen.getByText('Matricula')).toBeInTheDocument();
    // campo não curado da sociedade
    expect(screen.getByText('Capital Social')).toBeInTheDocument();
  });

  it('mantém a seção "Conexões no mapa" injetada', () => {
    render(<EntityDetail />);
    fireEvent.click(screen.getByRole('button', { name: /Carreira & Negócios/ }));
    expect(screen.getByText('Conexões no mapa')).toBeInTheDocument();
  });
});

describe('EntityDetail — sem nó selecionado', () => {
  afterEach(() => cleanup());
  it('não renderiza nada quando nenhum nó está selecionado', () => {
    useGraphStore.setState({ selectedNodeId: null, nodeIndex: new Map(), nodes: [], links: [] });
    const { container } = render(<EntityDetail />);
    expect(container.firstChild).toBeNull();
  });

  it('o botão de fechar volta ao mapa (limpa a seleção)', () => {
    seedProfileCache();
    selectNode(PERSON_NODE);
    render(<EntityDetail />);
    fireEvent.click(screen.getByRole('button', { name: /voltar ao mapa/i }));
    expect(useGraphStore.getState().selectedNodeId).toBeNull();
  });
});
