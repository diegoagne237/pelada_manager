import { supabase } from "./supabaseClient";

/* ============================================================
   MAPPERS: linha do banco (snake_case) -> shape do app (camelCase)
   ============================================================ */
const mapPlayer = (r) => ({
  id: r.id, nome: r.nome, apelido: r.apelido, numero: r.numero, goleiro: r.goleiro, ativo: r.ativo,
});

function mapSession(r) {
  const sp = r.session_players || [];
  const conf = sp.filter((x) => x.status === "confirmado");
  const desis = sp.filter((x) => x.status === "desistiu");
  const teamA = conf.filter((x) => x.team === "A").map((x) => x.player_id);
  const teamB = conf.filter((x) => x.team === "B").map((x) => x.player_id);
  const hasTeams = teamA.length || teamB.length || r.colete_team;
  return {
    id: r.id, createdAt: r.created_at, date: r.data, local: r.local,
    status: r.status, phase: r.phase, maxPhase: r.max_phase,
    valorQuadra: Number(r.valor_quadra), valorJogador: Number(r.valor_jogador), custoGoleiro: Number(r.custo_goleiro),
    presentes: conf.slice().sort((a, b) => new Date(a.confirmed_at) - new Date(b.confirmed_at))
      .map((x) => ({ playerId: x.player_id, at: x.confirmed_at })),
    desistencias: desis.map((x) => ({ playerId: x.player_id, at: x.desistiu_at })),
    teams: hasTeams ? { A: teamA, B: teamB, coleteTeam: r.colete_team || "A" } : null,
    pagos: conf.filter((x) => x.pago).map((x) => x.player_id),
    goleirosAluguel: (r.goleiros_aluguel || []).map((x) => ({ id: x.id, nome: x.nome, custo: Number(x.custo) })),
    goals: (r.goals || []).slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map((x) => ({ id: x.id, team: x.team, playerId: x.player_id, minute: x.minute, ownGoal: x.own_goal })),
    startedAt: r.started_at, durationSec: r.duration_sec, jogoFinalizado: r.jogo_finalizado,
    coleteLavar: r.colete_lavar, pagamentoConcluido: r.pagamento_concluido, saldoSessao: Number(r.saldo_sessao),
    coleteDevolvido: r.colete_devolvido,
  };
}
const mapExtrato = (r) => ({
  id: r.id, date: r.data, desc: r.descricao, valor: Number(r.valor), tipo: r.tipo, sessionId: r.session_id,
});

/* ============================================================
   LOAD (tudo de uma vez, no boot do app)
   ============================================================ */
export async function loadAll() {
  const [pRes, sRes, cRes] = await Promise.all([
    supabase.from("players").select("*").order("apelido"),
    supabase.from("sessions").select("*, session_players(*), goals(*), goleiros_aluguel(*)").order("data", { ascending: false }),
    supabase.from("caixinha_extrato").select("*").order("data", { ascending: false }),
  ]);
  if (pRes.error) throw pRes.error;
  if (sRes.error) throw sRes.error;
  if (cRes.error) throw cRes.error;
  const extrato = (cRes.data || []).map(mapExtrato);
  const saldo = extrato.reduce((a, x) => a + x.valor, 0);
  return {
    players: (pRes.data || []).map(mapPlayer),
    games: (sRes.data || []).map(mapSession),
    caixinha: { saldo, extrato },
  };
}

/* ============================================================
   PLAYERS
   ============================================================ */
export async function addPlayer(p) {
  const { data, error } = await supabase.from("players")
    .insert({ nome: p.nome, apelido: p.apelido, numero: p.numero, goleiro: p.goleiro, ativo: true })
    .select().single();
  if (error) throw error;
  return mapPlayer(data);
}
export async function setPlayerAtivo(id, ativo) {
  const { error } = await supabase.from("players").update({ ativo }).eq("id", id);
  if (error) throw error;
}
export async function updatePlayer(id, p) {
  const { error } = await supabase.from("players")
    .update({ nome: p.nome, apelido: p.apelido, numero: p.numero ?? null, goleiro: p.goleiro })
    .eq("id", id);
  if (error) throw error;
}
export async function deletePlayer(id) {
  const { error } = await supabase.from("players").delete().eq("id", id);
  if (error) throw error;
}

/* ============================================================
   SESSIONS
   ============================================================ */
const SESSION_FIELDS = {
  date: "data", local: "local", status: "status", phase: "phase", maxPhase: "max_phase",
  valorQuadra: "valor_quadra", valorJogador: "valor_jogador", custoGoleiro: "custo_goleiro",
  coleteTeam: "colete_team", startedAt: "started_at", durationSec: "duration_sec",
  jogoFinalizado: "jogo_finalizado", pagamentoConcluido: "pagamento_concluido",
  saldoSessao: "saldo_sessao", coleteLavar: "colete_lavar", coleteDevolvido: "colete_devolvido",
};

export async function createSession(dateISO) {
  const { data, error } = await supabase.from("sessions").insert({ data: dateISO }).select().single();
  if (error) throw error;
  return mapSession({ ...data, session_players: [], goals: [], goleiros_aluguel: [] });
}
export async function updateSession(id, patch) {
  const upd = {};
  for (const k in patch) if (SESSION_FIELDS[k] !== undefined) upd[SESSION_FIELDS[k]] = patch[k];
  if (Object.keys(upd).length === 0) return;
  const { error } = await supabase.from("sessions").update(upd).eq("id", id);
  if (error) throw error;
}
export async function deleteSession(id) {
  const { error } = await supabase.from("sessions").delete().eq("id", id);
  if (error) throw error;
}

/* ============================================================
   PRESENÇA / TIMES / PAGAMENTO (session_players)
   ============================================================ */
export async function confirmPresence(sessionId, playerId) {
  const { error } = await supabase.from("session_players").upsert(
    { session_id: sessionId, player_id: playerId, status: "confirmado", confirmed_at: new Date().toISOString(), desistiu_at: null },
    { onConflict: "session_id,player_id" }
  );
  if (error) throw error;
}
export async function desist(sessionId, playerId) {
  const { error } = await supabase.from("session_players")
    .update({ status: "desistiu", desistiu_at: new Date().toISOString(), team: null, pago: false })
    .eq("session_id", sessionId).eq("player_id", playerId);
  if (error) throw error;
}
export async function undoDesist(sessionId, playerId) {
  const { error } = await supabase.from("session_players").delete()
    .eq("session_id", sessionId).eq("player_id", playerId);
  if (error) throw error;
}
export async function saveTeams(sessionId, teams) {
  const clr = await supabase.from("session_players").update({ team: null }).eq("session_id", sessionId);
  if (clr.error) throw clr.error;
  if (teams.A.length) {
    const { error } = await supabase.from("session_players").update({ team: "A" }).eq("session_id", sessionId).in("player_id", teams.A);
    if (error) throw error;
  }
  if (teams.B.length) {
    const { error } = await supabase.from("session_players").update({ team: "B" }).eq("session_id", sessionId).in("player_id", teams.B);
    if (error) throw error;
  }
  const { error } = await supabase.from("sessions").update({ colete_team: teams.coleteTeam }).eq("id", sessionId);
  if (error) throw error;
}
export async function setPago(sessionId, playerId, pago) {
  const { error } = await supabase.from("session_players").update({ pago })
    .eq("session_id", sessionId).eq("player_id", playerId);
  if (error) throw error;
}

/* ============================================================
   GOLS
   ============================================================ */
export async function addGoal(sessionId, g) {
  const { data, error } = await supabase.from("goals")
    .insert({ session_id: sessionId, player_id: g.playerId, team: g.team, minute: g.minute, own_goal: g.ownGoal })
    .select().single();
  if (error) throw error;
  return { id: data.id, team: data.team, playerId: data.player_id, minute: data.minute, ownGoal: data.own_goal };
}
export async function deleteGoal(id) {
  const { error } = await supabase.from("goals").delete().eq("id", id);
  if (error) throw error;
}

/* ============================================================
   GOLEIROS DE ALUGUEL
   ============================================================ */
export async function addGoleiro(sessionId, g) {
  const { data, error } = await supabase.from("goleiros_aluguel")
    .insert({ session_id: sessionId, nome: g.nome, custo: g.custo }).select().single();
  if (error) throw error;
  return { id: data.id, nome: data.nome, custo: Number(data.custo) };
}
export async function removeGoleiro(id) {
  const { error } = await supabase.from("goleiros_aluguel").delete().eq("id", id);
  if (error) throw error;
}

/* ============================================================
   CAIXINHA (extrato -> saldo é a soma)
   ============================================================ */
export async function addExtrato(e) {
  const { data, error } = await supabase.from("caixinha_extrato")
    .insert({ descricao: e.desc, valor: e.valor, tipo: e.tipo || "lancamento", session_id: e.sessionId || null })
    .select().single();
  if (error) throw error;
  return mapExtrato(data);
}
export async function deleteExtratoBySession(sessionId, tipo) {
  const { error } = await supabase.from("caixinha_extrato").delete()
    .eq("session_id", sessionId).eq("tipo", tipo);
  if (error) throw error;
}
