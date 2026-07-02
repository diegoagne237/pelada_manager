# Pelada Manager ⚽

App de gestão da pelada (React + Vite + Tailwind + Supabase). Controla lista de
presença, sorteio de times, placar ao vivo, coletes, pagamentos, caixinha e o
relatório da temporada — tudo persistido no Supabase.

## Rodando local

```bash
npm install
npm run dev
```

As credenciais ficam em `.env` (já preenchido com a URL e a chave publishable —
ambas seguras no frontend):

```
VITE_SUPABASE_URL=https://btgmrcgvofehfaceujze.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
```

## Banco de dados

Rode uma vez o SQL em `supabase/schema.sql` no **SQL Editor** do Supabase
(New query → cola tudo → Run). Ele cria as tabelas, os índices, a view de saldo
e as policies de RLS.

Tabelas: `players`, `sessions`, `session_players`, `goals`, `goleiros_aluguel`,
`caixinha_extrato`. O saldo da caixinha é sempre a **soma do extrato** (auditável);
"editar saldo" lança uma linha de *Ajuste manual*.

## Deploy na Vercel

1. `git push` para o repositório `pelada_manager`.
2. Import na Vercel (framework detectado: **Vite**).
3. Em **Settings → Environment Variables**, adicione:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy.

## Estrutura

```
src/
  main.jsx            entrypoint
  PeladaManager.jsx   app inteiro (UI + fluxo da sessão)
  db.js               camada de dados (todas as chamadas ao Supabase)
  supabaseClient.js   cliente configurado por env vars
  index.css           tailwind + fontes
supabase/schema.sql   schema do banco
```

## Notas

- O RLS está com policies abertas (`public_all`) — ok para uso pessoal. Para
  travar, adicione Supabase Auth e restrinja as policies por usuário.
- O app começa **vazio**: cadastre o elenco na aba *Elenco* antes de abrir a
  primeira sessão.
