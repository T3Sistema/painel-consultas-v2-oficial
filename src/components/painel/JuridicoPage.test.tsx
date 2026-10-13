// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { JuridicoPage } from './JuridicoPage';
import { PROFILE_PAGES } from '../../lib/profileSchema';
import { normalizePersonSections } from '../../services/personPayload';
import { ADV_CPF, COPARTE_CPF, PESSOA_SECOES, SELF_CPF } from '../../test/personSectionsFixture';

const sr = normalizePersonSections(PESSOA_SECOES as unknown as Record<string, unknown>);
const sections = PROFILE_PAGES.find((p) => p.name === 'Jurídico')!.sections;

function renderPage() {
  return render(
    <JuridicoPage
      sections={sections}
      serviceResponse={sr}
      cpf={SELF_CPF}
      selfName="MARINA SOUZA TESTE"
      onGo={vi.fn()}
      onOpenImage={vi.fn()}
      onConsult={vi.fn()}
    />,
  );
}

const cards = (container: HTMLElement) => container.querySelectorAll('.jur-proc');

describe('JuridicoPage', () => {
  afterEach(() => cleanup());

  it('mostra todos os processos, contrapartes e advogados da pessoa', () => {
    const { container } = renderPage();
    expect(cards(container)).toHaveLength(6);
    expect(screen.getByText('Quem aparece nos processos')).toBeInTheDocument();
    expect(screen.getAllByText('CARLOS TESTE NETO').length).toBeGreaterThan(0);
    expect(screen.getByText('Advogados da pessoa')).toBeInTheDocument();
    expect(screen.getByText('ADVOGADO UM EXEMPLO')).toBeInTheDocument();
  });

  it('filtra por polo e por texto (os cartões que saem animam antes de sumir)', async () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Polo ativo/ }));
    await waitFor(() => expect(cards(container)).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: /^Todos/ }));
    fireEvent.change(screen.getByLabelText('Filtrar processos'), { target: { value: 'tjse' } });
    await waitFor(() => expect(cards(container)).toHaveLength(1));
  });

  it('CPF de terceiro (parte ou advogado) aparece mascarado até a pessoa pedir para revelar', () => {
    const { container } = renderPage();
    for (const toggle of screen.getAllByRole('button', { name: /Partes e representantes/ })) fireEvent.click(toggle);
    const text = container.textContent ?? '';
    expect(text).not.toContain(COPARTE_CPF);
    expect(text).not.toContain(ADV_CPF);
    // CNPJ é dado público — aparece formatado
    expect(text).toContain('11.222.333/0001-81');
  });

  it('cartão expandido traz partes por polo e marca a pessoa consultada', () => {
    const { container } = renderPage();
    const first = cards(container)[0] as HTMLElement;
    fireEvent.click(within(first).getByRole('button', { name: /Partes e representantes/ }));
    expect(within(first).getByText('Polo passivo')).toBeInTheDocument();
    expect(within(first).getByText('pessoa consultada')).toBeInTheDocument();
  });

  it('sem processos, cai nas seções padrão (com o texto de vazio)', () => {
    render(
      <JuridicoPage sections={sections} serviceResponse={{}} cpf={SELF_CPF} onGo={vi.fn()} onOpenImage={vi.fn()} onConsult={vi.fn()} />,
    );
    expect(screen.getByText('Nenhum processo judicial encontrado.')).toBeInTheDocument();
  });
});
