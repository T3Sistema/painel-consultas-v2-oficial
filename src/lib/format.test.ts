import { describe, expect, it } from 'vitest';
import { caretPositionForDigitCount, isValidCPF, isValidPhone, maskCPF, maskPhone, normalizePhone } from './format';

describe('maskCPF', () => {
  it('aplica a máscara progressivamente conforme os dígitos entram', () => {
    expect(maskCPF('1')).toBe('1');
    expect(maskCPF('111')).toBe('111');
    expect(maskCPF('1114')).toBe('111.4');
    expect(maskCPF('111444')).toBe('111.444');
    expect(maskCPF('1114447')).toBe('111.444.7');
    expect(maskCPF('111444777')).toBe('111.444.777');
    expect(maskCPF('1114447773')).toBe('111.444.777-3');
    expect(maskCPF('11144477735')).toBe('111.444.777-35');
  });

  it('ignora caracteres não numéricos e trunca em 11 dígitos', () => {
    expect(maskCPF('111.444.777-35')).toBe('111.444.777-35');
    expect(maskCPF('111444777359999')).toBe('111.444.777-35');
  });
});

describe('caretPositionForDigitCount', () => {
  it('posiciona o cursor logo após o N-ésimo dígito, pulando pontuação', () => {
    // "111.444.777-35" — dígitos nos índices 0,1,2, 4,5,6, 8,9,10, 12,13
    expect(caretPositionForDigitCount('111.444.777-35', 0)).toBe(0);
    expect(caretPositionForDigitCount('111.444.777-35', 3)).toBe(3); // logo antes do primeiro "."
    expect(caretPositionForDigitCount('111.444.777-35', 4)).toBe(5); // 1 dígito depois do ".", cursor após ele
    expect(caretPositionForDigitCount('111.444.777-35', 11)).toBe(14); // todos os dígitos
  });

  it('cai no fim da string quando pede mais dígitos do que existem', () => {
    expect(caretPositionForDigitCount('111.4', 99)).toBe(5);
  });
});

describe('isValidCPF', () => {
  it('aceita CPF válido (fixture sintética, não é um documento real)', () => {
    expect(isValidCPF('111.444.777-35')).toBe(true);
    expect(isValidCPF('11144477735')).toBe(true);
  });

  it('rejeita CPF com dígito verificador errado', () => {
    expect(isValidCPF('111.444.777-36')).toBe(false);
  });

  it('rejeita CPF com menos de 11 dígitos', () => {
    expect(isValidCPF('123456789')).toBe(false);
  });

  it('rejeita CPF com mais de 11 dígitos', () => {
    expect(isValidCPF('123456789012')).toBe(false);
  });

  it('rejeita sequência de dígitos repetidos', () => {
    expect(isValidCPF('111.111.111-11')).toBe(false);
    expect(isValidCPF('00000000000')).toBe(false);
  });
});

describe('telefone', () => {
  it('maskPhone formata fixo e celular progressivamente', () => {
    expect(maskPhone('')).toBe('');
    expect(maskPhone('1')).toBe('(1');
    expect(maskPhone('119')).toBe('(11) 9');
    expect(maskPhone('3134567890')).toBe('(31) 3456-7890');
    expect(maskPhone('11987654321')).toBe('(11) 98765-4321');
    expect(maskPhone('119876543210000')).toBe('(11) 98765-4321');
  });

  it('isValidPhone exige DDD e o formato de fixo/celular', () => {
    expect(isValidPhone('(11) 98765-4321')).toBe(true);
    expect(isValidPhone('(31) 3456-7890')).toBe(true);
    expect(isValidPhone('+55 11 98765-4321')).toBe(true);
    expect(isValidPhone('98765-4321')).toBe(false);
    expect(isValidPhone('(11) 8765-43210')).toBe(false); // 11 dígitos sem o 9
    expect(isValidPhone('(11) 9876-5432')).toBe(false); // celular incompleto
    expect(isValidPhone('(01) 3456-7890')).toBe(false); // DDD inválido
    expect(isValidPhone('11111111111')).toBe(false);
  });

  it('normalizePhone remove o prefixo 55', () => {
    expect(normalizePhone('+55 (11) 98765-4321')).toBe('11987654321');
    expect(normalizePhone('5511987654321')).toBe('11987654321');
    expect(normalizePhone('(55) 3456-7890')).toBe('5534567890');
  });
});
