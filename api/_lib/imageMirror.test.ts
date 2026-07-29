import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getSupabaseClientMock } = vi.hoisted(() => ({ getSupabaseClientMock: vi.fn() }));
vi.mock('./supabase', () => ({ getSupabaseClient: getSupabaseClientMock }));

import { collectMirrorTargets, looksLikeBase64Image, looksLikeImageUrl, mirrorImagesInPayload } from './imageMirror';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
const SIGNED = 'https://proj.supabase.co/storage/v1/object/sign/imagens_url/espelho/abc.png?token=t';

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

/** Base64 de PNG longo o bastante para passar o piso de 200 caracteres. */
const PNG_BASE64_LONG = toBase64(new Uint8Array([...PNG_BYTES, ...new Uint8Array(300).fill(0x41)]));

let uploadMock: ReturnType<typeof vi.fn>;
let createSignedUrlMock: ReturnType<typeof vi.fn>;
let maybeSingleMock: ReturnType<typeof vi.fn>;
let upsertMock: ReturnType<typeof vi.fn>;

function installSupabaseMock() {
  uploadMock = vi.fn().mockResolvedValue({ error: null });
  createSignedUrlMock = vi.fn().mockResolvedValue({ data: { signedUrl: SIGNED }, error: null });
  maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: null });
  upsertMock = vi.fn().mockResolvedValue({ error: null });

  getSupabaseClientMock.mockReturnValue({
    storage: { from: () => ({ upload: uploadMock, createSignedUrl: createSignedUrlMock, remove: vi.fn() }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }),
      upsert: upsertMock,
    }),
  });
}

function imageResponse(bytes: Uint8Array): Response {
  return new Response(bytes, { status: 200, headers: { 'content-type': 'image/png' } });
}

describe('looksLikeImageUrl', () => {
  it('1. aceita URL com extensão de imagem em qualquer chave', () => {
    expect(looksLikeImageUrl('qualquerCoisa', 'https://cdn.example.com/a.jpg')).toBe(true);
  });

  it('2. aceita URL sem extensão quando a chave sugere imagem', () => {
    expect(looksLikeImageUrl('foto', 'https://cdn.example.com/abc123')).toBe(true);
  });

  it('3. aceita chave genérica dentro de container que sugere imagem', () => {
    expect(looksLikeImageUrl('url', 'https://cdn.example.com/abc', 'fotos')).toBe(true);
  });

  it('4. rejeita URL comum sem pista de imagem (ex.: link de vazamento)', () => {
    expect(looksLikeImageUrl('link', 'https://exemplo.com/vazamento', 'ocorrencias')).toBe(false);
  });

  it('5. rejeita esquema que não é http(s)', () => {
    expect(looksLikeImageUrl('foto', 'javascript:alert(1)')).toBe(false);
    expect(looksLikeImageUrl('foto', 'file:///etc/passwd')).toBe(false);
  });
});

describe('looksLikeBase64Image', () => {
  it('6. aceita data URL de imagem', () => {
    expect(looksLikeBase64Image('x', `data:image/png;base64,${toBase64(PNG_BYTES)}`)).toBe(true);
  });

  it('7. aceita Base64 longo sob chave sugestiva e rejeita string curta', () => {
    expect(looksLikeBase64Image('fotoBase64', PNG_BASE64_LONG)).toBe(true);
    expect(looksLikeBase64Image('fotoBase64', 'QUJD')).toBe(false);
  });

  it('8. rejeita Base64 longo sob chave não sugestiva', () => {
    expect(looksLikeBase64Image('observacoes', PNG_BASE64_LONG)).toBe(false);
  });
});

describe('collectMirrorTargets', () => {
  it('9. encontra foto em cadastral, em array de objetos e Base64', () => {
    const targets = collectMirrorTargets({
      SERVICE_RESPONSE: {
        cadastral: { foto: 'https://cdn.example.com/foto' },
        fotos: [{ url: 'https://cdn.example.com/1' }],
        docs: { imagemBase64: PNG_BASE64_LONG },
      },
    });
    expect(targets).toHaveLength(3);
    expect(targets.filter((t) => t.kind === 'url')).toHaveLength(2);
    expect(targets.filter((t) => t.kind === 'base64')).toHaveLength(1);
  });

  it('10. ignora URL que já é do nosso Storage', () => {
    process.env.SUPABASE_URL = 'https://proj.supabase.co';
    try {
      expect(collectMirrorTargets({ cadastral: { foto: SIGNED } })).toHaveLength(0);
    } finally {
      delete process.env.SUPABASE_URL;
    }
  });
});

describe('mirrorImagesInPayload', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getSupabaseClientMock.mockReset();
    installSupabaseMock();
    fetchMock = vi.fn().mockResolvedValue(imageResponse(PNG_BYTES));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('11. payload sem imagem nenhuma nunca toca o Storage', async () => {
    const payload = { SERVICE_RESPONSE: { nome: 'Fulano', sociedades: [] } };
    const stats = await mirrorImagesInPayload(payload);
    expect(stats).toEqual({ found: 0, mirrored: 0, failed: 0 });
    expect(getSupabaseClientMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('12. substitui a URL de origem pela URL assinada do nosso Storage', async () => {
    const payload = { SERVICE_RESPONSE: { cadastral: { foto: 'https://cdn.fornecedor.com/foto.jpg' } } };
    const stats = await mirrorImagesInPayload(payload);

    expect(stats).toEqual({ found: 1, mirrored: 1, failed: 0 });
    expect(payload.SERVICE_RESPONSE.cadastral.foto).toBe(SIGNED);
    expect(uploadMock).toHaveBeenCalledTimes(1);
    // Caminho é content-addressed e carrega a extensão real do MIME farejado.
    expect(uploadMock.mock.calls[0][0]).toMatch(/^espelho\/[0-9a-f]{64}\.png$/);
  });

  it('13. nenhum host de origem sobra no payload serializado', async () => {
    const payload = {
      SERVICE_RESPONSE: {
        cadastral: { foto: 'https://cdn.fornecedor.com/foto.jpg' },
        fotos: [{ url: 'https://outra-origem.example.com/x.png' }],
      },
    };
    await mirrorImagesInPayload(payload);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/cdn\.fornecedor\.com|outra-origem/);
  });

  it('14. URL que falha no download vira null — nunca mantém o link de origem', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 404 }));
    const payload = { SERVICE_RESPONSE: { cadastral: { foto: 'https://cdn.fornecedor.com/foto.jpg' } } };
    const stats = await mirrorImagesInPayload(payload);

    expect(stats).toEqual({ found: 1, mirrored: 0, failed: 1 });
    expect(payload.SERVICE_RESPONSE.cadastral.foto).toBeNull();
  });

  it('15. conteúdo que não é imagem (PDF) não é espelhado e o link some', async () => {
    fetchMock.mockResolvedValue(imageResponse(PDF_BYTES));
    const payload = { SERVICE_RESPONSE: { cadastral: { foto: 'https://cdn.fornecedor.com/doc' } } };
    await mirrorImagesInPayload(payload);

    expect(uploadMock).not.toHaveBeenCalled();
    expect(payload.SERVICE_RESPONSE.cadastral.foto).toBeNull();
  });

  it('16. imagem em Base64 vira URL do nosso Storage, sem rede', async () => {
    const payload = { SERVICE_RESPONSE: { docs: { fotoBase64: PNG_BASE64_LONG } } };
    const stats = await mirrorImagesInPayload(payload);

    expect(stats.mirrored).toBe(1);
    expect(payload.SERVICE_RESPONSE.docs.fotoBase64).toBe(SIGNED);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('17. Base64 que não é imagem fica intacto (dado embutido, sem host a vazar)', async () => {
    const pdfBase64 = toBase64(new Uint8Array([...PDF_BYTES, ...new Uint8Array(300).fill(0x41)]));
    const payload = { SERVICE_RESPONSE: { docs: { documentoBase64: pdfBase64 } } };
    await mirrorImagesInPayload(payload);

    expect(payload.SERVICE_RESPONSE.docs.documentoBase64).toBe(pdfBase64);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('18. a mesma URL repetida é baixada uma única vez e reusada em todos os campos', async () => {
    const repeated = 'https://cdn.fornecedor.com/foto.jpg';
    const payload = {
      SERVICE_RESPONSE: { cadastral: { foto: repeated }, fotos: [{ url: repeated }, { url: repeated }] },
    };
    const stats = await mirrorImagesInPayload(payload);

    expect(stats.found).toBe(3);
    expect(stats.mirrored).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(payload.SERVICE_RESPONSE.fotos.every((f) => f.url === SIGNED)).toBe(true);
  });

  it('19. imagem já espelhada antes reusa o objeto do bucket, sem baixar de novo', async () => {
    maybeSingleMock.mockResolvedValue({ data: { storage_path: 'espelho/abc.png' }, error: null });
    const payload = { SERVICE_RESPONSE: { cadastral: { foto: 'https://cdn.fornecedor.com/foto.jpg' } } };
    const stats = await mirrorImagesInPayload(payload);

    expect(stats.mirrored).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
    expect(createSignedUrlMock).toHaveBeenCalledWith('espelho/abc.png', expect.any(Number));
  });

  it('20. Storage indisponível remove a imagem em vez de vazar a origem', async () => {
    getSupabaseClientMock.mockImplementation(() => {
      throw new Error('SUPABASE_URL/SUPABASE_SECRET_KEY não configuradas no servidor.');
    });
    const payload = { SERVICE_RESPONSE: { cadastral: { foto: 'https://cdn.fornecedor.com/foto.jpg' } } };
    const stats = await mirrorImagesInPayload(payload);

    expect(stats.failed).toBe(1);
    expect(payload.SERVICE_RESPONSE.cadastral.foto).toBeNull();
  });

  it('21. URL de rede interna é bloqueada pelo SSRF antes de qualquer download', async () => {
    const payload = { SERVICE_RESPONSE: { cadastral: { foto: 'http://169.254.169.254/latest/meta-data/foto.png' } } };
    const stats = await mirrorImagesInPayload(payload);

    expect(stats.failed).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(payload.SERVICE_RESPONSE.cadastral.foto).toBeNull();
  });
});
