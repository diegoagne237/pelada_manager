-- Migration: adicionar player_id em goleiros_aluguel
-- Rode no SQL Editor do Supabase (não afeta dados existentes)
alter table goleiros_aluguel
  add column if not exists player_id uuid references players(id) on delete set null;
