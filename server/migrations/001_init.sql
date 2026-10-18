-- 001_init.sql — esquema inicial do HELIO (ADR #17).
--
-- Quatro tabelas: conta, campanha (com o Selo da Missao), vinculo e cena.
--
-- A cena fica em JSONB com `schemaVersion` dentro, de proposito: as regras do
-- sistema ainda vao ser inventadas na mesa, e coluna rigida brigaria com o
-- autor. A ficha vai seguir o mesmo principio quando chegar.
--
-- Ids sao gerados na aplicacao (`uid()` de @helio/shared), entao nao ha
-- extensao nenhuma aqui — o banco guarda, nao decide.

create table if not exists account (
  id            text primary key,
  name          text not null,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

-- Nome de conta nao diferencia maiuscula de minuscula: "Helio" e "helio" sao a
-- mesma pessoa, e descobrir isso no login seria uma surpresa ruim.
create unique index if not exists account_name_lower_key on account (lower(name));

create table if not exists campaign (
  id            text primary key,
  code          text not null unique,      -- o Selo da Missao (lido em voz alta)
  name          text not null,
  gm_account_id text references account(id) on delete set null,
  created_at    timestamptz not null default now()
);

create table if not exists membership (
  account_id  text not null references account(id) on delete cascade,
  campaign_id text not null references campaign(id) on delete cascade,
  role        text not null check (role in ('gm', 'player')),
  created_at  timestamptz not null default now(),
  primary key (account_id, campaign_id)
);

-- Uma cena por campanha. O `data` e o `ServerScene` serializado.
create table if not exists scene (
  campaign_id text primary key references campaign(id) on delete cascade,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);
