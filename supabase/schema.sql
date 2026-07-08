-- =====================================================================
-- PELADA MANAGER — schema Supabase (Postgres)
-- Rode no Supabase: SQL Editor > New query > cole tudo > Run
-- =====================================================================

-- ---------- ELENCO ----------
create table if not exists players (
  id          uuid primary key default gen_random_uuid(),
  nome        text,
  apelido     text not null,
  numero      int,
  goleiro     boolean not null default false,   -- goleiro fixo (entra no sorteio)
  ativo       boolean not null default true,
  foto_url    text,
  created_at  timestamptz not null default now()
);

-- ---------- SESSÕES (cada pelada) ----------
create table if not exists sessions (
  id                    uuid primary key default gen_random_uuid(),
  data                  timestamptz not null,             -- dia/hora do jogo (padrão: segunda 22h, definido no app)
  local                 text not null default 'Quadra Igreja Santo Antônio',
  status                text not null default 'aberta'    check (status in ('aberta','encerrada')),
  phase                 text not null default 'presenca'  check (phase in ('presenca','times','jogo','resumo','coletes','pagamentos')),
  max_phase             int  not null default 0,
  valor_quadra          numeric not null default 180,
  valor_jogador         numeric not null default 20,
  custo_goleiro         numeric not null default 25,
  colete_team           text check (colete_team in ('A','B')),   -- qual lado está de colete
  started_at            timestamptz,                      -- início do cronômetro
  duration_sec          int,
  jogo_finalizado       boolean not null default false,
  pagamento_concluido   boolean not null default false,
  saldo_sessao          numeric not null default 0,       -- delta aplicado na caixinha no fechamento
  colete_lavar          uuid references players(id) on delete set null,  -- quem levou os coletes p/ lavar
  colete_devolvido      boolean not null default false,   -- verificado na chegada da próxima pelada
  created_at            timestamptz not null default now()
);

-- ---------- PRESENÇA / TIMES / PAGAMENTO (jogador dentro de uma sessão) ----------
create table if not exists session_players (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references sessions(id) on delete cascade,
  player_id    uuid not null references players(id)  on delete cascade,
  status       text not null default 'confirmado' check (status in ('confirmado','desistiu')),
  confirmed_at timestamptz not null default now(),       -- horário da confirmação
  desistiu_at  timestamptz,                              -- horário da desistência
  team         text check (team in ('A','B')),           -- time; null = ainda sem time
  pago         boolean not null default false,
  unique (session_id, player_id)
);

-- ---------- GOLS ----------
create table if not exists goals (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references sessions(id) on delete cascade,
  player_id   uuid not null references players(id)  on delete cascade,
  team        text not null check (team in ('A','B')),   -- time que MARCOU o ponto
  minute      int  not null,
  own_goal    boolean not null default false,            -- gol contra (autor é do time adversário)
  created_at  timestamptz not null default now()
);

-- ---------- GOLEIROS DE ALUGUEL (só custo, por sessão) ----------
create table if not exists goleiros_aluguel (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references sessions(id) on delete cascade,
  player_id   uuid references players(id) on delete set null,  -- jogador cadastrado (opcional para compatibilidade)
  nome        text not null default 'Goleiro',
  custo       numeric not null default 25
);

-- ---------- CAIXINHA (livro-caixa; saldo = soma do extrato) ----------
create table if not exists caixinha_extrato (
  id          uuid primary key default gen_random_uuid(),
  data        timestamptz not null default now(),
  descricao   text not null,
  valor       numeric not null,                          -- +entrada / -saída
  tipo        text not null default 'lancamento' check (tipo in ('fechamento','ajuste','lancamento')),
  session_id  uuid references sessions(id) on delete cascade,  -- fechamento some se a sessão for excluída
  created_at  timestamptz not null default now()
);

-- saldo atual da caixinha
create or replace view v_caixinha_saldo as
  select coalesce(sum(valor), 0)::numeric as saldo from caixinha_extrato;

-- ---------- ÍNDICES ----------
create index if not exists idx_sp_session   on session_players(session_id);
create index if not exists idx_sp_player    on session_players(player_id);
create index if not exists idx_goals_session on goals(session_id);
create index if not exists idx_goals_player  on goals(player_id);
create index if not exists idx_ga_session    on goleiros_aluguel(session_id);
create index if not exists idx_cx_session    on caixinha_extrato(session_id);
create index if not exists idx_sessions_data on sessions(data desc);

-- =====================================================================
-- RLS — acesso liberado para a chave publishable (anon).
-- OK para um app pessoal/privado agora. Quando quiser travar,
-- a gente adiciona Supabase Auth e restringe as policies.
-- =====================================================================
alter table players           enable row level security;
alter table sessions          enable row level security;
alter table session_players   enable row level security;
alter table goals             enable row level security;
alter table goleiros_aluguel  enable row level security;
alter table caixinha_extrato  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['players','sessions','session_players','goals','goleiros_aluguel','caixinha_extrato']
  loop
    execute format('drop policy if exists "public_all" on %I;', t);
    execute format('create policy "public_all" on %I for all using (true) with check (true);', t);
  end loop;
end $$;
