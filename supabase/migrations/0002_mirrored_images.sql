-- Índice das imagens espelhadas no bucket `imagens_url`.
--
-- Toda imagem que chega numa consulta é gravada no nosso Storage antes de a
-- resposta chegar ao navegador (ver api/_lib/imageMirror.ts). Esta tabela
-- mapeia origem → objeto no bucket para que a mesma imagem não precise ser
-- baixada de novo a cada consulta.
--
-- `source_hash` é o SHA-256 da URL de origem (prefixado com "url:") quando a
-- imagem veio de um link, ou o SHA-256 do próprio binário quando veio em
-- Base64 — nunca a URL em texto claro, que carregaria o domínio de origem
-- para dentro do banco.
--
-- RLS habilitado sem nenhuma policy, igual às demais tabelas (0001): só a
-- Service Role Key, sempre no servidor, acessa esta tabela.

create table public.mirrored_images (
  id uuid primary key default gen_random_uuid(),
  source_hash text not null unique,
  storage_path text not null,
  mime_type text not null,
  byte_size integer not null,
  created_at timestamptz not null default now()
);

create index mirrored_images_created_at_idx on public.mirrored_images(created_at);

alter table public.mirrored_images enable row level security;
-- Nenhuma policy criada de propósito (ver 0001).
