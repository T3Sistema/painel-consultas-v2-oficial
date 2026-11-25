// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listSavedQueriesMock, getSavedQueryMock, findPeopleByPhoneMock } = vi.hoisted(() => ({
  listSavedQueriesMock: vi.fn(),
  getSavedQueryMock: vi.fn(),
  findPeopleByPhoneMock: vi.fn(),
}));
vi.mock('../services/savedQueries', () => ({
  listSavedQueries: listSavedQueriesMock,
  getSavedQuery: getSavedQueryMock,
}));
vi.mock('../services/phoneLookup', () => ({ findPeopleByPhone: findPeopleByPhoneMock }));

import { SearchForm } from './SearchForm';
import { useGraphStore } from '../store/graphStore';
import { maskCNPJ } from '../lib/format';

describe('SearchForm — branding e busca de CNPJ', () => {
  beforeEach(() => {
    listSavedQueriesMock.mockReset().mockResolvedValue([]);
    getSavedQueryMock.mockReset();
    useGraphStore.setState({ error: null, searchPhase: 'idle', searchFailedCpfs: [], searchProfilesTotal: 0 });
  });
  afterEach(() => cleanup());

  it('1. mostra o logo, o título, e as abas CNPJ/Consulta Avançada habilitadas', () => {
    render(<SearchForm />);
    expect(screen.getByAltText('TRIAD3')).toBeInTheDocument();
    expect(screen.getByText('PAINEL DE CONSULTAS')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CNPJ' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Consulta Avançada' })).toBeInTheDocument();
    expect(screen.getByText('SMS')).toBeInTheDocument();
  });

  it('2. rejeita CNPJ com dígitos verificadores inválidos sem chamar startSearch', () => {
    const startSearch = vi.fn();
    useGraphStore.setState({ startSearch });
    render(<SearchForm />);
    fireEvent.change(screen.getByPlaceholderText('00.000.000/0000-00'), { target: { value: '11.111.111/1111-11' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(screen.getByText(/CNPJ inválido/)).toBeInTheDocument();
    expect(startSearch).not.toHaveBeenCalled();
  });

  it('3. CNPJ válido chama startSearch com os 14 dígitos', () => {
    const startSearch = vi.fn();
    useGraphStore.setState({ startSearch });
    render(<SearchForm />);
    fireEvent.change(screen.getByPlaceholderText('00.000.000/0000-00'), { target: { value: '33.260.563/0001-78' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(startSearch).toHaveBeenCalledWith('33260563000178');
  });

  it('4. apagar um dígito no MEIO do CNPJ mantém o cursor no lugar (não pula pro fim)', async () => {
    render(<SearchForm />);
    const input = screen.getByPlaceholderText('00.000.000/0000-00') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '33.260.563/0001-78' } });

    // Apaga o "6" de "260" (índice 4) — simula posicionar o cursor ali e teclar Backspace.
    fireEvent.change(input, { target: { value: '33.20.563/0001-78', selectionStart: 4 } });
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(input.value).toBe(maskCNPJ('33.20.563/0001-78'));
    // Cursor deve continuar perto de onde o dígito foi apagado — nunca no fim da string.
    expect(input.selectionStart).toBeLessThan(input.value.length - 3);
  });
});

describe('SearchForm — Consulta Avançada (busca por CPF)', () => {
  beforeEach(() => {
    listSavedQueriesMock.mockReset().mockResolvedValue([]);
    getSavedQueryMock.mockReset();
    useGraphStore.setState({ error: null, searchPhase: 'idle', searchFailedCpfs: [], searchProfilesTotal: 0 });
  });
  afterEach(() => cleanup());

  it('1. clicar em "Consulta Avançada" troca o campo para máscara de CPF', () => {
    render(<SearchForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Consulta Avançada' }));
    expect(screen.getByPlaceholderText('000.000.000-00')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('00.000.000/0000-00')).not.toBeInTheDocument();
  });

  it('2. rejeita CPF com dígitos verificadores inválidos sem chamar startPersonSearch', () => {
    const startPersonSearch = vi.fn();
    useGraphStore.setState({ startPersonSearch });
    render(<SearchForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Consulta Avançada' }));
    fireEvent.change(screen.getByPlaceholderText('000.000.000-00'), { target: { value: '111.444.777-36' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(screen.getByText(/CPF inválido/)).toBeInTheDocument();
    expect(startPersonSearch).not.toHaveBeenCalled();
  });

  it('3. CPF válido chama startPersonSearch com os 11 dígitos', () => {
    const startPersonSearch = vi.fn();
    useGraphStore.setState({ startPersonSearch });
    render(<SearchForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Consulta Avançada' }));
    fireEvent.change(screen.getByPlaceholderText('000.000.000-00'), { target: { value: '111.444.777-35' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(startPersonSearch).toHaveBeenCalledWith('11144477735');
  });

  it('4. alternar entre CNPJ e CPF preserva o texto digitado em cada campo', () => {
    render(<SearchForm />);
    fireEvent.change(screen.getByPlaceholderText('00.000.000/0000-00'), { target: { value: '33.260.563/0001-78' } });
    fireEvent.click(screen.getByRole('button', { name: 'Consulta Avançada' }));
    fireEvent.change(screen.getByPlaceholderText('000.000.000-00'), { target: { value: '111.444.777-35' } });
    fireEvent.click(screen.getByRole('button', { name: 'CNPJ' }));
    expect(screen.getByPlaceholderText('00.000.000/0000-00')).toHaveValue('33.260.563/0001-78');
    fireEvent.click(screen.getByRole('button', { name: 'Consulta Avançada' }));
    expect(screen.getByPlaceholderText('000.000.000-00')).toHaveValue('111.444.777-35');
  });
});

describe('SearchForm — busca por Telefone', () => {
  beforeEach(() => {
    listSavedQueriesMock.mockReset().mockResolvedValue([]);
    getSavedQueryMock.mockReset();
    findPeopleByPhoneMock.mockReset();
    useGraphStore.setState({ error: null, searchPhase: 'idle', searchFailedCpfs: [], searchProfilesTotal: 0 });
  });
  afterEach(() => cleanup());

  const openPhoneTab = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Telefone' }));
    return screen.getByPlaceholderText('(00) 00000-0000') as HTMLInputElement;
  };

  it('1. a aba Telefone aplica a máscara de celular', () => {
    render(<SearchForm />);
    const input = openPhoneTab();
    fireEvent.change(input, { target: { value: '11987654321' } });
    expect(input).toHaveValue('(11) 98765-4321');
  });

  it('2. telefone sem DDD é rejeitado sem consultar', () => {
    render(<SearchForm />);
    fireEvent.change(openPhoneTab(), { target: { value: '98765432' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(screen.getByText(/com DDD/)).toBeInTheDocument();
    expect(findPeopleByPhoneMock).not.toHaveBeenCalled();
  });

  it('3. um único vínculo abre o dossiê direto pelo CPF', async () => {
    const startPersonSearch = vi.fn();
    useGraphStore.setState({ startPersonSearch });
    findPeopleByPhoneMock.mockResolvedValue([{ cpf: '11144477735', nome: 'MARIA EXEMPLO' }]);
    render(<SearchForm />);
    fireEvent.change(openPhoneTab(), { target: { value: '(11) 98765-4321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await vi.waitFor(() => expect(startPersonSearch).toHaveBeenCalledWith('11144477735'));
    expect(findPeopleByPhoneMock).toHaveBeenCalledWith('11987654321');
  });

  it('4. vários vínculos viram uma lista; escolher um abre o dossiê', async () => {
    const startPersonSearch = vi.fn();
    useGraphStore.setState({ startPersonSearch });
    findPeopleByPhoneMock.mockResolvedValue([
      { cpf: '11144477735', nome: 'MARIA EXEMPLO', nascimento: '1980-01-02' },
      { cpf: '52998224725', nome: 'JOAO EXEMPLO' },
    ]);
    render(<SearchForm />);
    fireEvent.change(openPhoneTab(), { target: { value: '(11) 98765-4321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await screen.findByText('2 pessoas vinculadas', { exact: false });
    expect(screen.getByText('111.444.777-35 · 02/01/1980')).toBeInTheDocument();
    expect(startPersonSearch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('JOAO EXEMPLO'));
    expect(startPersonSearch).toHaveBeenCalledWith('52998224725');
  });

  it('5. nenhum vínculo mostra aviso; erro mostra a mensagem neutra', async () => {
    findPeopleByPhoneMock.mockResolvedValueOnce([]);
    render(<SearchForm />);
    fireEvent.change(openPhoneTab(), { target: { value: '(31) 3456-7890' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await screen.findByText(/Nenhuma pessoa encontrada para o telefone \(31\) 3456-7890/);

    findPeopleByPhoneMock.mockRejectedValueOnce(new Error('Serviço temporariamente indisponível.'));
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await screen.findByText('Serviço temporariamente indisponível.');
  });
});

describe('SearchForm — Consultas recentes', () => {
  beforeEach(() => {
    listSavedQueriesMock.mockReset();
    getSavedQueryMock.mockReset();
    useGraphStore.setState({ error: null, searchPhase: 'idle', searchFailedCpfs: [], searchProfilesTotal: 0 });
  });
  afterEach(() => cleanup());

  it('1. lista as consultas recentes com o nome mascarado por padrão', async () => {
    listSavedQueriesMock.mockResolvedValue([
      { id: 'q1', titulo: 'Grupo Confidencial X', cnpj_raiz: '11222333000181', created_at: '2026-01-01', updated_at: '' },
    ]);
    render(<SearchForm />);
    await screen.findByText(/••/);
    expect(screen.queryByText('Grupo Confidencial X')).not.toBeInTheDocument();
  });

  it('2. botão "Ocultas" revela os nomes ao clicar', async () => {
    listSavedQueriesMock.mockResolvedValue([
      { id: 'q1', titulo: 'Grupo Confidencial X', cnpj_raiz: '11222333000181', created_at: '2026-01-01', updated_at: '' },
    ]);
    render(<SearchForm />);
    await screen.findByText(/••/);
    fireEvent.click(screen.getByRole('button', { name: /Ocultas/ }));
    expect(screen.getByText('Grupo Confidencial X')).toBeInTheDocument();
  });

  it('3. lista vazia mostra "Nenhuma consulta recente."', async () => {
    listSavedQueriesMock.mockResolvedValue([]);
    render(<SearchForm />);
    expect(await screen.findByText('Nenhuma consulta recente.')).toBeInTheDocument();
  });

  it('4. clicar numa consulta recente abre e hidrata o grafo (sem chamar as APIs)', async () => {
    listSavedQueriesMock.mockResolvedValue([
      { id: 'q1', titulo: 'Grupo X', cnpj_raiz: '11222333000181', created_at: '2026-01-01', updated_at: '' },
    ]);
    const snapshot = {
      rootId: 'c:1',
      nodes: [],
      links: [],
      currentLayer: 1,
      maxDepth: 5,
      filters: useGraphStore.getState().filters,
      profiles: {},
    };
    getSavedQueryMock.mockResolvedValue({ id: 'q1', titulo: 'Grupo X', cnpjRaiz: '11222333000181', snapshot, photoUrlsByPersonId: {} });

    render(<SearchForm />);
    await screen.findByText(/••/);
    fireEvent.click(screen.getByRole('button', { name: /••/ }));

    await vi.waitFor(() => expect(useGraphStore.getState().rootId).toBe('c:1'));
    expect(getSavedQueryMock).toHaveBeenCalledWith('q1');
  });

  it('5. "Ver todas as consultas salvas" chama onOpenSavedQueries', async () => {
    listSavedQueriesMock.mockResolvedValue([]);
    const onOpenSavedQueries = vi.fn();
    render(<SearchForm onOpenSavedQueries={onOpenSavedQueries} />);
    fireEvent.click(await screen.findByText('Ver todas as consultas salvas'));
    expect(onOpenSavedQueries).toHaveBeenCalledTimes(1);
  });
});
