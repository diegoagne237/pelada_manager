import React, { useState, useEffect, useRef } from "react";
import * as db from "./db";

/* ============================================================
   PELADA MANAGER — persistência no Supabase
   ============================================================ */

const LOCAL = "Quadra Igreja Santo Antônio";

const STYLE = `
@import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap');
.pm-root, .pm-root * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
.pm-root { font-family: 'Inter', system-ui, sans-serif; }
.disp { font-family: 'Oswald', sans-serif; letter-spacing: .01em; }
.pm-root button { font-family: inherit; cursor: pointer; }
@keyframes pmpop { 0%{transform:scale(.85);opacity:0} 60%{transform:scale(1.05)} 100%{transform:scale(1);opacity:1} }
.pmpop { animation: pmpop .22s ease-out; }
@keyframes pmflash { 0%{opacity:1} 100%{opacity:0} }
.pmflash { animation: pmflash 1.3s ease-out forwards; }
@keyframes pmglow { 0%,100%{box-shadow:0 0 0 1px var(--gl), 0 0 14px -4px var(--gl)} 50%{box-shadow:0 0 0 1px var(--gl), 0 0 22px 0px var(--gl)} }
.pmglow { animation: pmglow 2.2s ease-in-out infinite; }
`;

const C = {
  bg: "#0B120E", surf: "#15201A", surf2: "#1D2C24", line: "#2A3D33",
  chalk: "#EEF3EC", muted: "#8AA093",
  amber: "#F6C445", // COM COLETE (coletes amarelos) + CTA
  blue: "#4EA8DE",  // SEM COLETE
  green: "#37D68A", red: "#F05A3C",
};
const coleteCor = (isColete) => (isColete ? C.amber : C.blue);
const coleteLabel = (isColete) => (isColete ? "COM COLETE" : "SEM COLETE");

/* ---------- helpers ---------- */
const uid = () => Math.random().toString(36).slice(2, 9);
const brl = (v) => `R$ ${Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
const fmtDate = (iso) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
const fmtTime = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const nextMonday22 = () => {
  const d = new Date(); d.setHours(22, 0, 0, 0);
  const today = new Date();
  const diff = (1 - d.getDay() + 7) % 7;
  if (!(d.getDay() === 1 && today.getHours() < 22)) d.setDate(d.getDate() + (diff || 7));
  return d.toISOString();
};
// datetime-local <-> ISO (mantém a hora "de parede" correta em qualquer fuso)
const isoToLocalInput = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const localInputToISO = (local) => (local ? new Date(local).toISOString() : null);
const scores = (g) => ({
  A: g.goals.filter((x) => x.team === "A").length,
  B: g.goals.filter((x) => x.team === "B").length,
});

/* ============================================================
   LOGIN — senha geral de acesso
   ============================================================ */
const SENHA = "ggiyroff";
function Login({ onAuth }) {
  const [val, setVal] = useState("");
  const [err, setErr] = useState(false);
  const submit = () => {
    if (val === SENHA) { sessionStorage.setItem("pm_auth", "1"); onAuth(); }
    else { setErr(true); setVal(""); setTimeout(() => setErr(false), 1400); }
  };
  return (
    <div className="pm-root min-h-screen flex flex-col items-center justify-center px-6" style={{ background: C.bg, color: C.chalk }}>
      <style>{STYLE}</style>
      <div className="w-full max-w-xs text-center">
        <div className="disp text-3xl font-700 mb-1">PELADA<span style={{ color: C.amber }}>·</span>MANAGER</div>
        <div className="text-xs mb-10" style={{ color: C.muted }}>Quadra Igreja Santo Antônio · segundas 22h</div>
        <div className="rounded-2xl p-6 space-y-4" style={{ background: C.surf, border: `1px solid ${err ? C.red : C.line}`, transition: "border-color .2s" }}>
          <div className="text-sm font-600" style={{ color: err ? C.red : C.muted }}>{err ? "Senha incorreta" : "Acesso restrito"}</div>
          <input
            type="password" value={val} onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="••••••••"
            autoFocus
            className="w-full text-center text-xl tracking-widest rounded-xl px-4 py-3"
            style={{ background: C.bg, color: C.chalk, border: `1px solid ${err ? C.red : C.line}`, letterSpacing: "0.3em" }}
          />
          <button onClick={submit} className="w-full py-3 rounded-xl disp font-700 text-base"
            style={{ background: `linear-gradient(180deg, ${C.amber}, #E0AC28)`, color: "#241B00" }}>
            ENTRAR
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- fases da sessão ---------- */
const PHASES = [
  { k: "presenca", label: "Lista" }, { k: "times", label: "Times" }, { k: "jogo", label: "Jogo" },
  { k: "resumo", label: "Resumo" }, { k: "coletes", label: "Coletes" }, { k: "pagamentos", label: "Pagto" },
];

/* ============================================================ */
export default function PeladaManager() {
  const [auth, setAuth] = useState(!!sessionStorage.getItem("pm_auth"));
  const [players, setPlayers] = useState([]);
  const [games, setGames] = useState([]);
  const [caixinha, setCaixinha] = useState({ saldo: 0, extrato: [] });
  const [activeId, setActiveId] = useState(null);
  const [tab, setTab] = useState("dashboard");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    db.loadAll()
      .then((d) => { setPlayers(d.players); setGames(d.games); setCaixinha(d.caixinha); })
      .catch((e) => setErr(e.message || String(e)))
      .finally(() => setLoading(false));
  }, []);

  const active = games.find((g) => g.id === activeId) || null;
  const gById = (id) => games.find((g) => g.id === id);
  const upGame = (id, fn) => setGames((gs) => gs.map((g) => (g.id === id ? fn(g) : g)));
  const guard = (p) => { if (p && p.catch) p.catch((e) => { console.error(e); setErr(e.message || String(e)); }); };

  /* ---------- elenco ---------- */
  const addPlayer = (p) =>
    guard(db.addPlayer(p).then((row) =>
      setPlayers((ps) => [...ps, row].sort((a, b) => a.apelido.localeCompare(b.apelido, "pt-BR")))));
  const toggleAtivo = (id) => {
    const cur = players.find((p) => p.id === id);
    setPlayers((ps) => ps.map((p) => (p.id === id ? { ...p, ativo: !p.ativo } : p)));
    guard(db.setPlayerAtivo(id, !cur.ativo));
  };

  const editPlayer = (id, p) => {
    setPlayers((ps) => ps.map((x) => (x.id === id ? { ...x, ...p } : x)));
    guard(db.updatePlayer(id, p));
  };
  const removePlayer = (id) => {
    setPlayers((ps) => ps.filter((x) => x.id !== id));
    // remove das sessões abertas em memória também (já cascadeia no banco)
    setGames((gs) => gs.map((g) => ({
      ...g,
      presentes: g.presentes.filter((x) => x.playerId !== id),
      desistencias: g.desistencias.filter((x) => x.playerId !== id),
      pagos: g.pagos.filter((x) => x !== id),
      teams: g.teams ? { ...g.teams, A: g.teams.A.filter((x) => x !== id), B: g.teams.B.filter((x) => x !== id) } : g.teams,
      goals: g.goals.filter((x) => x.playerId !== id),
    })));
    guard(db.deletePlayer(id));
  };
  const addLancamento = ({ desc, valor, tipo }) => {
    const temp = { id: "tmp_" + uid(), date: new Date().toISOString(), desc, valor, tipo: tipo || "lancamento", sessionId: null };
    setCaixinha((c) => ({ saldo: c.saldo + valor, extrato: [temp, ...c.extrato] }));
    guard(db.addExtrato({ desc, valor, tipo }).then((row) =>
      setCaixinha((c) => ({ ...c, extrato: c.extrato.map((e) => (e.id === temp.id ? row : e)) }))));
  };
  const setSaldoManual = (target) => {
    const delta = target - caixinha.saldo;
    if (delta === 0) return;
    addLancamento({ desc: "Ajuste manual", valor: delta, tipo: "ajuste" });
  };

  /* ---------- sessão ---------- */
  const createSession = () =>
    guard(db.createSession(nextMonday22()).then((g) => { setGames((gs) => [g, ...gs]); setActiveId(g.id); }));

  const encerrar = (id) => { upGame(id, (g) => ({ ...g, status: "encerrada" })); guard(db.updateSession(id, { status: "encerrada" })); };

  const deleteSession = (id) => {
    setCaixinha((c) => {
      const removed = c.extrato.filter((e) => e.sessionId === id && e.tipo === "fechamento");
      const sum = removed.reduce((a, e) => a + e.valor, 0);
      return { saldo: c.saldo - sum, extrato: c.extrato.filter((e) => !(e.sessionId === id && e.tipo === "fechamento")) };
    });
    setGames((gs) => gs.filter((g) => g.id !== id));
    setActiveId(null);
    guard(db.deleteSession(id));
  };

  const a = {
    goTo: (id, k) => {
      const i = PHASES.findIndex((p) => p.k === k);
      const cur = gById(id); const mp = Math.max(cur ? cur.maxPhase : 0, i);
      upGame(id, (g) => ({ ...g, phase: k, maxPhase: mp }));
      guard(db.updateSession(id, { phase: k, maxPhase: mp }));
    },
    updateDate: (id, iso) => { upGame(id, (g) => ({ ...g, date: iso })); guard(db.updateSession(id, { date: iso })); },
    confirmPresence: (id, pid) => {
      upGame(id, (g) => ({ ...g, presentes: [...g.presentes, { playerId: pid, at: new Date().toISOString() }], desistencias: g.desistencias.filter((x) => x.playerId !== pid) }));
      guard(db.confirmPresence(id, pid));
    },
    desist: (id, pid) => {
      upGame(id, (g) => ({ ...g, presentes: g.presentes.filter((x) => x.playerId !== pid), desistencias: [...g.desistencias, { playerId: pid, at: new Date().toISOString() }], teams: g.teams ? { ...g.teams, A: g.teams.A.filter((i) => i !== pid), B: g.teams.B.filter((i) => i !== pid) } : g.teams, pagos: g.pagos.filter((i) => i !== pid) }));
      guard(db.desist(id, pid));
    },
    undoDesist: (id, pid) => { upGame(id, (g) => ({ ...g, desistencias: g.desistencias.filter((x) => x.playerId !== pid) })); guard(db.undoDesist(id, pid)); },
    saveTeams: (id, teams) => { upGame(id, (g) => ({ ...g, teams })); guard(db.saveTeams(id, teams)); },
    startGame: (id) => { const at = new Date().toISOString(); upGame(id, (g) => ({ ...g, startedAt: at })); guard(db.updateSession(id, { startedAt: at })); },
    addGoal: (id, goal) => {
      const temp = "tmp_" + uid();
      upGame(id, (g) => ({ ...g, goals: [...g.goals, { id: temp, ...goal }] }));
      guard(db.addGoal(id, goal).then((row) => upGame(id, (g) => ({ ...g, goals: g.goals.map((x) => (x.id === temp ? row : x)) }))));
    },
    undoGoal: (id) => {
      const g = gById(id); const last = g && g.goals[g.goals.length - 1];
      if (!last) return;
      upGame(id, (gg) => ({ ...gg, goals: gg.goals.slice(0, -1) }));
      if (!String(last.id).startsWith("tmp_")) guard(db.deleteGoal(last.id));
    },
    finalizeGame: (id, durationSec) => {
      const cur = gById(id); const mp = Math.max(cur ? cur.maxPhase : 0, 3);
      upGame(id, (g) => ({ ...g, jogoFinalizado: true, durationSec, phase: "resumo", maxPhase: mp }));
      guard(db.updateSession(id, { jogoFinalizado: true, durationSec, phase: "resumo", maxPhase: mp }));
    },
    setColeteLavar: (id, pid) => {
      const cur = gById(id).coleteLavar; const val = cur === pid ? null : pid;
      upGame(id, (g) => ({ ...g, coleteLavar: val })); guard(db.updateSession(id, { coleteLavar: val }));
    },
    togglePago: (id, pid) => {
      const g = gById(id); const has = g.pagos.includes(pid);
      upGame(id, (gg) => ({ ...gg, pagos: has ? gg.pagos.filter((x) => x !== pid) : [...gg.pagos, pid] }));
      guard(db.setPago(id, pid, !has));
    },
    addGoleiro: (id, gk) => {
      const temp = "tmp_" + uid();
      upGame(id, (g) => ({ ...g, goleirosAluguel: [...g.goleirosAluguel, { id: temp, ...gk }] }));
      guard(db.addGoleiro(id, gk).then((row) => upGame(id, (g) => ({ ...g, goleirosAluguel: g.goleirosAluguel.map((x) => (x.id === temp ? row : x)) }))));
    },
    removeGoleiro: (id, gid) => {
      upGame(id, (g) => ({ ...g, goleirosAluguel: g.goleirosAluguel.filter((x) => x.id !== gid) }));
      if (!String(gid).startsWith("tmp_")) guard(db.removeGoleiro(gid));
    },
    updateGoleiroCusto: (sessionId, gid, custo) => {
      upGame(sessionId, (g) => ({ ...g, goleirosAluguel: g.goleirosAluguel.map((x) => x.id === gid ? { ...x, custo } : x) }));
      guard(db.updateGoleiroCusto(gid, custo));
    },
    concluirPagamento: (id) => {
      const g = gById(id); const custo = g.goleirosAluguel.reduce((acc, x) => acc + x.custo, 0);
      const delta = g.pagos.length * g.valorJogador - g.valorQuadra - custo;
      const entry = { id: "tmp_" + uid(), date: new Date().toISOString(), desc: `Fechamento ${fmtDate(g.date)} · ${g.pagos.length} pagantes`, valor: delta, tipo: "fechamento", sessionId: id };
      setCaixinha((c) => ({ saldo: c.saldo + delta, extrato: [entry, ...c.extrato] }));
      upGame(id, (gg) => ({ ...gg, pagamentoConcluido: true, saldoSessao: delta }));
      guard(db.addExtrato({ desc: entry.desc, valor: delta, tipo: "fechamento", sessionId: id }).then((row) =>
        setCaixinha((c) => ({ ...c, extrato: c.extrato.map((e) => (e.id === entry.id ? row : e)) }))));
      guard(db.updateSession(id, { pagamentoConcluido: true, saldoSessao: delta }));
    },
    reabrirPagamento: (id) => {
      const g = gById(id); const delta = g.saldoSessao || 0;
      setCaixinha((c) => ({ saldo: c.saldo - delta, extrato: c.extrato.filter((e) => !(e.sessionId === id && e.tipo === "fechamento")) }));
      upGame(id, (gg) => ({ ...gg, pagamentoConcluido: false, saldoSessao: 0 }));
      guard(db.deleteExtratoBySession(id, "fechamento"));
      guard(db.updateSession(id, { pagamentoConcluido: false, saldoSessao: 0 }));
    },
    encerrar,
    deleteSession,
    marcarColeteDevolvido: (id) => {
      upGame(id, (g) => ({ ...g, coleteDevolvido: true }));
      guard(db.updateSession(id, { coleteDevolvido: true }));
    },
  };

  if (!auth) return <Login onAuth={() => setAuth(true)} />;

  if (loading) {
    return (
      <div className="pm-root min-h-screen w-full flex items-center justify-center" style={{ background: C.bg, color: C.muted }}>
        <style>{STYLE}</style>
        <div className="disp text-lg">Carregando pelada…</div>
      </div>
    );
  }

  return (
    <div className="pm-root min-h-screen w-full" style={{ background: C.bg, color: C.chalk }}>
      <style>{STYLE}</style>
      {err && (
        <div className="fixed top-2 left-1/2 -translate-x-1/2 z-50 max-w-md w-[92%] rounded-lg px-3 py-2 text-xs flex items-center justify-between"
          style={{ background: C.red, color: "#160B08" }}>
          <span>Erro: {err}</span>
          <button onClick={() => setErr(null)} className="ml-2 font-700">✕</button>
        </div>
      )}
      {active ? (
        <SessionFlow game={active} players={players} a={a} games={games} onExit={() => setActiveId(null)} />
      ) : (
        <>
          <main className="max-w-xl mx-auto px-4 pt-6" style={{ paddingBottom: 96 }}>
            {tab === "dashboard" && (
              <Dashboard games={games} players={players} onStart={createSession}
                onOpen={setActiveId} onEncerrar={encerrar} />
            )}
            {tab === "temporada" && <Temporada games={games} players={players} caixinha={caixinha} />}
            {tab === "caixinha" && <Caixinha caixinha={caixinha} onAdd={addLancamento} onSetSaldo={setSaldoManual} />}
            {tab === "elenco" && <Elenco players={players} games={games} onAdd={addPlayer} onToggle={toggleAtivo} onEdit={editPlayer} onRemove={removePlayer} />}
          </main>
          <BottomNav tab={tab} setTab={setTab} />
        </>
      )}
    </div>
  );
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function Dashboard({ games, players, onStart, onOpen, onEncerrar }) {
  return (
    <div>
      <header className="mb-5">
        <div className="disp text-2xl font-700" style={{ lineHeight: 1 }}>
          PELADA<span style={{ color: C.amber }}>·</span>MANAGER
        </div>
        <div className="text-xs mt-1" style={{ color: C.muted }}>{LOCAL} · segundas 22h</div>
      </header>

      <button onClick={onStart}
        className="w-full rounded-2xl py-5 mb-7 active:scale-[.98] transition-transform"
        style={{ background: `linear-gradient(180deg, ${C.amber}, #E0AC28)`, color: "#241B00", boxShadow: `0 8px 30px -8px ${C.amber}66` }}>
        <div className="disp text-xl font-700 tracking-wide">＋ INICIAR NOVA SESSÃO</div>
        <div className="text-xs font-600 opacity-70 mt-0.5">Abrir a lista da próxima segunda</div>
      </button>

      <h2 className="disp text-sm font-600 tracking-widest mb-3" style={{ color: C.muted }}>JOGOS</h2>
      {players.length === 0 && (
        <div className="rounded-xl p-4 mb-3 text-sm" style={{ background: C.surf, border: `1px dashed ${C.line}`, color: C.muted }}>
          Cadastre o elenco primeiro (aba <b style={{ color: C.chalk }}>Elenco</b>) pra montar a lista da pelada.
        </div>
      )}
      <div className="space-y-3">
        {games.length === 0 ? (
          <div className="rounded-xl p-5 text-center text-sm" style={{ background: C.surf, border: `1px solid ${C.line}`, color: C.muted }}>
            Nenhum jogo ainda. Toque em <b style={{ color: C.amber }}>Iniciar nova sessão</b> pra começar.
          </div>
        ) : (
          games.map((g) => (
            <GameCard key={g.id} g={g} players={players} onOpen={() => onOpen(g.id)} onEncerrar={() => onEncerrar(g.id)} />
          ))
        )}
      </div>
    </div>
  );
}

function PayFlag({ g }) {
  if (!g.jogoFinalizado)
    return <Badge color={C.muted}>Aguardando jogo</Badge>;
  if (g.pagamentoConcluido)
    return <Badge color={C.green}>✓ Pagamento concluído</Badge>;
  const faltam = g.presentes.length - g.pagos.length;
  return <Badge color={faltam === 0 ? C.green : C.amber}>{faltam === 0 ? "Todos pagaram — confirmar" : `Faltam ${faltam} pagar`}</Badge>;
}
function Badge({ children, color }) {
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-full font-600 disp"
      style={{ background: `${color}18`, color, border: `1px solid ${color}55` }}>{children}</span>
  );
}

function GameCard({ g, players, onOpen, onEncerrar }) {
  const [confirm, setConfirm] = useState(false);
  const s = scores(g);
  const aberta = g.status === "aberta";
  const comSide = g.teams?.coleteTeam || "B";
  const semSide = comSide === "A" ? "B" : "A";
  const played = g.jogoFinalizado;
  const draw = played && s.A === s.B;
  const winSem = played && s[semSide] > s[comSide];
  const winCom = played && s[comSide] > s[semSide];

  return (
    <div className={`rounded-xl p-4 ${aberta ? "pmglow" : ""}`}
      style={{ background: C.surf, border: `1px solid ${aberta ? C.amber : C.line}`, "--gl": `${C.amber}66` }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs" style={{ color: C.muted }}>
          {new Date(g.date).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" })}
        </span>
        {aberta && <Badge color={C.amber}>● SESSÃO ABERTA</Badge>}
      </div>

      <button onClick={onOpen} className="w-full text-left">
        {played ? (
          <div className="grid grid-cols-3 items-center py-1">
            <div className="flex justify-center">
              <span className="disp text-sm font-700 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full whitespace-nowrap"
                style={{ background: `${coleteCor(false)}1A`, color: coleteCor(false), border: `1px solid ${coleteCor(false)}66` }}>
                👕 SEM COLETE
              </span>
            </div>
            <div className="text-center flex items-center justify-center gap-2">
              <span className="disp text-4xl font-700" style={{ color: winSem ? C.green : C.chalk }}>{s[semSide]}</span>
              <span className="disp text-xl" style={{ color: C.muted }}>×</span>
              <span className="disp text-4xl font-700" style={{ color: winCom ? C.green : C.chalk }}>{s[comSide]}</span>
            </div>
            <div className="flex justify-center">
              <span className="disp text-sm font-700 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full whitespace-nowrap"
                style={{ background: `${coleteCor(true)}1A`, color: coleteCor(true), border: `1px solid ${coleteCor(true)}66` }}>
                🦺 COM COLETE
              </span>
            </div>
          </div>
        ) : (
          <div className="py-2 text-sm" style={{ color: C.muted }}>
            {g.phase === "presenca" && `Montando lista · ${g.presentes.length} confirmados`}
            {g.phase === "times" && "Times sendo definidos"}
            {g.phase === "jogo" && "Pronto para começar / em jogo"}
          </div>
        )}
        {draw && <div className="text-center disp text-[10px] mt-1" style={{ color: C.muted }}>EMPATE</div>}
      </button>

      <div className="mt-3 pt-3 flex items-center justify-between gap-2" style={{ borderTop: `1px solid ${C.line}` }}>
        <PayFlag g={g} />
        {aberta && (
          confirm ? (
            <span className="flex items-center gap-1 text-xs">
              <span style={{ color: C.muted }}>Encerrar?</span>
              <button onClick={onEncerrar} className="px-2 py-1 rounded" style={{ background: C.red, color: "#160B08" }}>Sim</button>
              <button onClick={() => setConfirm(false)} className="px-2 py-1 rounded" style={{ background: C.surf2, color: C.muted }}>Não</button>
            </span>
          ) : (
            <button onClick={() => setConfirm(true)} className="text-xs px-2 py-1 rounded"
              style={{ background: C.surf2, color: C.muted }}>Encerrar sessão</button>
          )
        )}
      </div>
    </div>
  );
}

/* ============================================================
   CAIXINHA
   ============================================================ */
function Caixinha({ caixinha, onAdd, onSetSaldo }) {
  const [editing, setEditing] = useState(false);
  const [novoSaldo, setNovoSaldo] = useState(caixinha.saldo);
  const [addOpen, setAddOpen] = useState(false);
  const [desc, setDesc] = useState(""); const [valor, setValor] = useState(""); const [tipo, setTipo] = useState("saida");
  const neg = caixinha.saldo < 0;

  const addLancamento = () => {
    const v = parseFloat(String(valor).replace(",", "."));
    if (!desc.trim() || isNaN(v) || v <= 0) return;
    const signed = tipo === "saida" ? -v : v;
    onAdd({ desc: desc.trim(), valor: signed, tipo: "lancamento" });
    setDesc(""); setValor(""); setAddOpen(false);
  };

  return (
    <div>
      <h1 className="disp text-2xl font-700 mb-4">CAIXINHA</h1>
      <div className="rounded-2xl p-5 mb-4 text-center" style={{ background: C.surf, border: `1px solid ${neg ? C.red : C.line}` }}>
        <div className="text-xs tracking-widest disp mb-1" style={{ color: C.muted }}>SALDO ATUAL</div>
        {editing ? (
          <div className="flex items-center justify-center gap-2 my-2">
            <span className="disp text-3xl" style={{ color: C.muted }}>R$</span>
            <input autoFocus type="number" value={novoSaldo} onChange={(e) => setNovoSaldo(e.target.value)}
              className="disp text-4xl font-700 w-40 text-center rounded-lg py-1" style={{ background: C.bg, color: C.chalk, border: `1px solid ${C.line}` }} />
          </div>
        ) : (
          <div className="disp text-5xl font-700 my-1" style={{ color: neg ? C.red : C.green }}>{neg && "−"}{brl(caixinha.saldo)}</div>
        )}
        {editing ? (
          <div className="flex gap-2 mt-3">
            <button onClick={() => setEditing(false)} className="flex-1 py-2 rounded-lg text-sm" style={{ background: C.surf2, color: C.muted }}>Cancelar</button>
            <button onClick={() => { onSetSaldo(parseFloat(novoSaldo) || 0); setEditing(false); }} className="flex-1 py-2 rounded-lg text-sm font-600" style={{ background: C.green, color: "#06231A" }}>Salvar saldo</button>
          </div>
        ) : (
          <button onClick={() => { setNovoSaldo(caixinha.saldo); setEditing(true); }} className="text-xs mt-2 underline" style={{ color: C.muted }}>editar saldo manualmente</button>
        )}
      </div>

      <button onClick={() => setAddOpen((v) => !v)} className="w-full py-3 rounded-xl mb-4 disp font-600" style={{ background: C.surf2, color: C.amber, border: `1px solid ${C.line}` }}>＋ Novo lançamento</button>
      {addOpen && (
        <div className="rounded-xl p-4 mb-4 space-y-3" style={{ background: C.surf, border: `1px solid ${C.line}` }}>
          <div className="flex gap-2">
            {["saida", "entrada"].map((t) => (
              <button key={t} onClick={() => setTipo(t)} className="flex-1 py-2 rounded-lg text-sm font-600"
                style={{ background: tipo === t ? (t === "saida" ? C.red : C.green) : C.surf2, color: tipo === t ? "#160B08" : C.muted }}>
                {t === "saida" ? "Saída (gasto)" : "Entrada"}
              </button>
            ))}
          </div>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Descrição (ex: quadra extra, churrasco)" className="w-full rounded-lg px-3 py-2.5 text-sm" style={{ background: C.bg, color: C.chalk, border: `1px solid ${C.line}` }} />
          <input value={valor} onChange={(e) => setValor(e.target.value)} type="number" placeholder="Valor (R$)" className="w-full rounded-lg px-3 py-2.5 text-sm" style={{ background: C.bg, color: C.chalk, border: `1px solid ${C.line}` }} />
          <button onClick={addLancamento} className="w-full py-2.5 rounded-lg font-600 disp" style={{ background: C.amber, color: "#241B00" }}>Adicionar ao extrato</button>
        </div>
      )}

      <h2 className="disp text-sm font-600 tracking-widest mb-2" style={{ color: C.muted }}>EXTRATO</h2>
      <div className="space-y-2">
        {caixinha.extrato.map((e) => (
          <div key={e.id} className="flex items-center justify-between rounded-lg px-4 py-3" style={{ background: C.surf, border: `1px solid ${C.line}` }}>
            <div><div className="text-sm">{e.desc}</div><div className="text-xs" style={{ color: C.muted }}>{fmtDate(e.date)} · {fmtTime(e.date)}</div></div>
            <div className="disp text-lg font-700" style={{ color: e.valor >= 0 ? C.green : C.red }}>{e.valor >= 0 ? "+" : "−"}{brl(e.valor)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   ELENCO
   ============================================================ */
function Elenco({ players, games, onAdd, onToggle, onEdit, onRemove }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ nome: "", apelido: "", numero: "", goleiro: false });
  const [editing, setEditing] = useState(null); // player sendo editado

  const stats = {}; players.forEach((p) => (stats[p.id] = { jogos: 0, gols: 0 }));
  games.filter((g) => g.jogoFinalizado).forEach((g) => {
    new Set([...(g.teams?.A || []), ...(g.teams?.B || [])]).forEach((pid) => { if (stats[pid]) stats[pid].jogos++; });
    g.goals.forEach((gl) => { if (!gl.ownGoal && stats[gl.playerId]) stats[gl.playerId].gols++; });
  });

  const sortAlpha = (list) => [...list].sort((a, b) => a.apelido.localeCompare(b.apelido, "pt-BR"));
  const ativos = sortAlpha(players.filter((p) => p.ativo));
  const inativos = sortAlpha(players.filter((p) => !p.ativo));

  const save = () => {
    if (!form.apelido.trim()) return;
    onAdd({
      nome: form.nome.trim() || form.apelido.trim(),
      apelido: form.apelido.trim(),
      numero: form.numero ? parseInt(form.numero) : null,
      goleiro: form.goleiro,
    });
    setForm({ nome: "", apelido: "", numero: "", goleiro: false }); setOpen(false);
  };
  const toggleAtivo = (id) => onToggle(id);

  const openEdit = (p) => setEditing({ id: p.id, nome: p.nome || "", apelido: p.apelido, numero: p.numero ? String(p.numero) : "", goleiro: p.goleiro });
  const saveEdit = () => {
    if (!editing.apelido.trim()) return;
    onEdit(editing.id, { nome: editing.nome.trim() || editing.apelido.trim(), apelido: editing.apelido.trim(), numero: editing.numero ? parseInt(editing.numero) : null, goleiro: editing.goleiro });
    setEditing(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="disp text-2xl font-700">ELENCO</h1>
        <button onClick={() => setOpen((v) => !v)} className="disp text-sm px-3 py-1.5 rounded-lg font-600" style={{ background: C.amber, color: "#241B00" }}>＋ Jogador</button>
      </div>
      {open && (
        <div className="rounded-xl p-4 mb-4 space-y-3" style={{ background: C.surf, border: `1px solid ${C.line}` }}>
          <input value={form.apelido} onChange={(e) => setForm({ ...form, apelido: e.target.value })} placeholder="Apelido (aparece no placar) *" className="w-full rounded-lg px-3 py-2.5 text-sm" style={{ background: C.bg, color: C.chalk, border: `1px solid ${C.line}` }} />
          <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Nome completo" className="w-full rounded-lg px-3 py-2.5 text-sm" style={{ background: C.bg, color: C.chalk, border: `1px solid ${C.line}` }} />
          <div className="flex gap-3">
            <input value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} type="number" placeholder="Nº (opcional)" className="w-28 rounded-lg px-3 py-2.5 text-sm" style={{ background: C.bg, color: C.chalk, border: `1px solid ${C.line}` }} />
            <button onClick={() => setForm({ ...form, goleiro: !form.goleiro })} className="flex-1 rounded-lg text-sm font-600" style={{ background: form.goleiro ? C.blue : C.surf2, color: form.goleiro ? "#04121C" : C.muted }}>🧤 Goleiro fixo</button>
          </div>
          <button onClick={save} className="w-full py-2.5 rounded-lg font-600 disp" style={{ background: C.green, color: "#06231A" }}>Salvar no elenco</button>
        </div>
      )}

      <div className="text-xs disp tracking-widest mb-2" style={{ color: C.muted }}>ATIVOS · {ativos.length}</div>
      <div className="space-y-2 mb-5">{ativos.map((p) => <PlayerRow key={p.id} p={p} st={stats[p.id]} onToggle={() => toggleAtivo(p.id)} onEdit={() => openEdit(p)} />)}</div>
      {inativos.length > 0 && (
        <>
          <div className="text-xs disp tracking-widest mb-2" style={{ color: C.muted }}>INATIVOS · {inativos.length}</div>
          <div className="space-y-2">{inativos.map((p) => <PlayerRow key={p.id} p={p} st={stats[p.id]} onToggle={() => toggleAtivo(p.id)} onEdit={() => openEdit(p)} dim />)}</div>
        </>
      )}

      {/* Modal de edição */}
      {editing && (
        <Modal onClose={() => setEditing(null)} title="Editar jogador">
          <div className="space-y-3 mb-4">
            <input value={editing.apelido} onChange={(e) => setEditing({ ...editing, apelido: e.target.value })} placeholder="Apelido *" className="w-full rounded-lg px-3 py-2.5 text-sm" style={{ background: C.bg, color: C.chalk, border: `1px solid ${C.line}` }} />
            <input value={editing.nome} onChange={(e) => setEditing({ ...editing, nome: e.target.value })} placeholder="Nome completo" className="w-full rounded-lg px-3 py-2.5 text-sm" style={{ background: C.bg, color: C.chalk, border: `1px solid ${C.line}` }} />
            <div className="flex gap-3">
              <input value={editing.numero} onChange={(e) => setEditing({ ...editing, numero: e.target.value })} type="number" placeholder="Nº (opcional)" className="w-28 rounded-lg px-3 py-2.5 text-sm" style={{ background: C.bg, color: C.chalk, border: `1px solid ${C.line}` }} />
              <button onClick={() => setEditing({ ...editing, goleiro: !editing.goleiro })} className="flex-1 rounded-lg text-sm font-600" style={{ background: editing.goleiro ? C.blue : C.surf2, color: editing.goleiro ? "#04121C" : C.muted }}>🧤 Goleiro fixo</button>
            </div>
          </div>
          <button onClick={saveEdit} className="w-full py-3 rounded-xl disp font-700 mb-2" style={{ background: C.green, color: "#06231A" }}>Salvar alterações</button>
          <div className="pt-3 mt-1" style={{ borderTop: `1px solid ${C.line}` }}>
            <PlayerDeleteButton playerId={editing.id} onRemove={(id) => { onRemove(id); setEditing(null); }} />
          </div>
        </Modal>
      )}
    </div>
  );
}
function PlayerRow({ p, st, onToggle, onEdit, dim }) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2.5" style={{ background: C.surf, border: `1px solid ${C.line}`, opacity: dim ? 0.55 : 1 }}>
      <div className="disp w-9 h-9 rounded-lg flex items-center justify-center text-sm font-700 shrink-0" style={{ background: C.surf2, color: p.numero ? C.chalk : C.muted }}>{p.numero ?? "—"}</div>
      <div className="flex-1 min-w-0">
        <div className="font-600 text-sm flex items-center gap-1.5">{p.apelido} {p.goleiro && <span title="Goleiro fixo">🧤</span>}</div>
        <div className="flex items-center gap-3 text-xs mt-0.5" style={{ color: C.muted }}>
          <span>🏃 {st.jogos} {st.jogos === 1 ? "jogo" : "jogos"}</span>
          <span>⚽ {st.gols} {st.gols === 1 ? "gol" : "gols"}</span>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <button onClick={onEdit} className="text-xs px-2 py-1 rounded" style={{ background: C.surf2, color: C.muted }}>✏️</button>
        <button onClick={onToggle} className="text-xs px-2 py-1 rounded" style={{ background: C.surf2, color: C.muted }}>{p.ativo ? "Arquivar" : "Reativar"}</button>
      </div>
    </div>
  );
}

function PlayerDeleteButton({ playerId, onRemove }) {
  const [step, setStep] = useState(0);
  if (step === 0) return (
    <button onClick={() => setStep(1)} className="w-full py-2.5 rounded-xl text-sm font-600 disp" style={{ background: `${C.red}18`, color: C.red, border: `1px solid ${C.red}44` }}>
      Excluir jogador
    </button>
  );
  return (
    <div className="rounded-xl p-3 space-y-2" style={{ background: `${C.red}12`, border: `1px solid ${C.red}55` }}>
      <p className="text-xs text-center" style={{ color: C.red }}>Isso remove o jogador e <b>apaga o histórico de presença e gols</b> dele. Não dá pra desfazer.</p>
      <div className="flex gap-2">
        <button onClick={() => setStep(0)} className="flex-1 py-2 rounded-lg text-sm" style={{ background: C.surf2, color: C.muted }}>Cancelar</button>
        <button onClick={() => onRemove(playerId)} className="flex-1 py-2 rounded-lg text-sm font-700" style={{ background: C.red, color: "#160B08" }}>Confirmar exclusão</button>
      </div>
    </div>
  );
}

/* ============================================================
   TEMPORADA (relatório / dashboard de estatísticas)
   ============================================================ */
function Temporada({ games, players, caixinha }) {
  const finalized = games.filter((g) => g.jogoFinalizado);
  const map = {};
  players.forEach((p) => (map[p.id] = { p, jogos: 0, gols: 0, v: 0, e: 0, d: 0, colete: 0, lavou: 0 }));
  finalized.forEach((g) => {
    const sc = scores(g);
    ["A", "B"].forEach((side) => {
      const other = side === "A" ? "B" : "A";
      const res = sc[side] > sc[other] ? "v" : sc[side] === sc[other] ? "e" : "d";
      (g.teams?.[side] || []).forEach((pid) => {
        if (!map[pid]) return;
        map[pid].jogos++; map[pid][res]++;
        if (side === g.teams?.coleteTeam) map[pid].colete++;
      });
    });
    g.goals.forEach((gl) => { if (!gl.ownGoal && map[gl.playerId]) map[gl.playerId].gols++; });
    if (g.coleteLavar && map[g.coleteLavar]) map[g.coleteLavar].lavou++;
  });
  const arr = Object.values(map).filter((x) => x.jogos > 0);
  const artilheiros = [...arr].filter((x) => x.gols > 0).sort((a, b) => b.gols - a.gols || a.jogos - b.jogos);
  const ranking = [...arr].sort((a, b) => (b.v * 3 + b.e) - (a.v * 3 + a.e) || b.v - a.v);
  const coleteRank = [...arr].sort((a, b) => b.colete - a.colete);
  const maxColete = Math.max(1, ...coleteRank.map((x) => x.colete));

  const dev = {}; let totalDev = 0;
  games.filter((g) => g.jogoFinalizado && !g.pagamentoConcluido).forEach((g) => {
    g.presentes.forEach((x) => {
      if (!g.pagos.includes(x.playerId)) { dev[x.playerId] = (dev[x.playerId] || 0) + g.valorJogador; totalDev += g.valorJogador; }
    });
  });
  const devList = Object.entries(dev).map(([pid, val]) => ({ p: players.find((p) => p.id === pid), val })).sort((a, b) => b.val - a.val);
  const totalGols = finalized.reduce((a, g) => a + g.goals.filter((x) => !x.ownGoal).length, 0);
  const medal = (i) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}º`);

  return (
    <div>
      <header className="mb-4">
        <h1 className="disp text-2xl font-700">TEMPORADA <span style={{ color: C.amber }}>2026</span></h1>
        <div className="text-xs mt-0.5" style={{ color: C.muted }}>{LOCAL} · acumulado de todos os jogos</div>
      </header>

      {/* chips */}
      <div className="grid grid-cols-2 gap-2 mb-5">
        <Chip label="Jogos" value={finalized.length} />
        <Chip label="Gols na temporada" value={totalGols} />
        <Chip label="Caixinha" value={brl(caixinha.saldo)} color={caixinha.saldo < 0 ? C.red : C.green} small />
        <Chip label="A receber" value={totalDev > 0 ? brl(totalDev) : "—"} color={totalDev > 0 ? C.red : C.muted} small />
      </div>

      {/* artilharia */}
      <Section title="ARTILHARIA">
        {artilheiros.length === 0 && <Empty>Nenhum gol registrado ainda.</Empty>}
        {artilheiros.map((x, i) => (
          <div key={x.p.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: C.surf, border: `1px solid ${i < 3 ? `${C.amber}55` : C.line}` }}>
            <span className="disp w-7 text-center font-700" style={{ color: i < 3 ? C.amber : C.muted }}>{medal(i)}</span>
            <div className="flex-1">
              <div className="font-700 text-sm">{x.p.apelido} {x.p.goleiro && "🧤"}</div>
              <div className="text-xs" style={{ color: C.muted }}>{x.jogos} jogos · {(x.gols / x.jogos).toFixed(1)} por jogo</div>
            </div>
            <span className="disp text-2xl font-700" style={{ color: C.amber }}>{x.gols}</span>
          </div>
        ))}
      </Section>

      {/* aproveitamento */}
      <Section title="APROVEITAMENTO">
        {ranking.map((x, i) => (
          <div key={x.p.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: C.surf, border: `1px solid ${C.line}` }}>
            <span className="disp w-6 text-center font-700" style={{ color: C.muted }}>{i + 1}</span>
            <span className="flex-1 font-700 text-sm">{x.p.apelido} {x.p.goleiro && "🧤"}</span>
            <span className="flex items-center gap-1">
              <VED n={x.v} c={C.green} t="V" /><VED n={x.e} c={C.muted} t="E" /><VED n={x.d} c={C.red} t="D" />
            </span>
            <span className="disp text-sm font-700 w-10 text-right" style={{ color: C.chalk }}>{x.v * 3 + x.e}<span className="text-[10px]" style={{ color: C.muted }}> pts</span></span>
          </div>
        ))}
      </Section>

      {/* rodízio de colete */}
      <Section title="RODÍZIO DE COLETE" hint="quantas vezes cada um jogou de colete">
        {coleteRank.map((x) => (
          <div key={x.p.id} className="rounded-xl px-3 py-2.5" style={{ background: C.surf, border: `1px solid ${C.line}` }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-700 text-sm">{x.p.apelido} {x.p.goleiro && "🧤"}</span>
              <span className="text-xs" style={{ color: C.muted }}><b style={{ color: C.amber }}>{x.colete}</b> de {x.jogos} jogos{x.lavou > 0 && ` · levou p/ lavar ${x.lavou}×`}</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: C.surf2 }}>
              <div className="h-full rounded-full" style={{ width: `${(x.colete / maxColete) * 100}%`, background: C.amber }} />
            </div>
          </div>
        ))}
      </Section>

      {/* devedores */}
      <Section title="PENDÊNCIAS DE PAGAMENTO">
        {devList.length === 0 ? (
          <div className="rounded-xl px-4 py-5 text-center" style={{ background: `${C.green}12`, border: `1px solid ${C.green}55` }}>
            <div className="disp font-700" style={{ color: C.green }}>Todo mundo em dia 🎉</div>
          </div>
        ) : (
          <>
            {devList.map((d) => (
              <div key={d.p.id} className="flex items-center justify-between rounded-xl px-3 py-2.5" style={{ background: C.surf, border: `1px solid ${C.red}44` }}>
                <span className="font-700 text-sm">{d.p.apelido}</span>
                <span className="disp font-700" style={{ color: C.red }}>deve {brl(d.val)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between px-3 pt-1">
              <span className="text-xs" style={{ color: C.muted }}>Total a receber</span>
              <span className="disp font-700" style={{ color: C.red }}>{brl(totalDev)}</span>
            </div>
          </>
        )}
      </Section>
    </div>
  );
}
function Chip({ label, value, color = C.chalk, small }) {
  return (
    <div className="rounded-xl px-4 py-3" style={{ background: C.surf, border: `1px solid ${C.line}` }}>
      <div className="text-[11px] mb-0.5" style={{ color: C.muted }}>{label}</div>
      <div className={`disp font-700 ${small ? "text-xl" : "text-3xl"}`} style={{ color }}>{value}</div>
    </div>
  );
}
function Section({ title, hint, children }) {
  return (
    <div className="mb-5">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="disp text-sm font-600 tracking-widest" style={{ color: C.muted }}>{title}</h2>
        {hint && <span className="text-[10px]" style={{ color: C.muted }}>{hint}</span>}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
function VED({ n, c, t }) {
  return <span className="disp text-xs font-700 px-1.5 py-0.5 rounded" style={{ background: `${c}1A`, color: c }}>{n}{t}</span>;
}
function Empty({ children }) {
  return <div className="text-sm text-center py-3 rounded-xl" style={{ color: C.muted, background: C.surf }}>{children}</div>;
}

/* ============================================================
   BOTTOM NAV
   ============================================================ */
function BottomNav({ tab, setTab }) {
  const items = [{ k: "dashboard", label: "Jogos", icon: "⚽" }, { k: "temporada", label: "Temporada", icon: "🏆" }, { k: "caixinha", label: "Caixinha", icon: "💰" }, { k: "elenco", label: "Elenco", icon: "👥" }];
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-20" style={{ background: `${C.surf}F2`, borderTop: `1px solid ${C.line}`, backdropFilter: "blur(8px)" }}>
      <div className="max-w-xl mx-auto flex">
        {items.map((it) => {
          const on = tab === it.k;
          return (
            <button key={it.k} onClick={() => setTab(it.k)} className="flex-1 py-3 flex flex-col items-center gap-0.5">
              <span style={{ fontSize: 20, opacity: on ? 1 : 0.5 }}>{it.icon}</span>
              <span className="disp text-[11px] font-600" style={{ color: on ? C.amber : C.muted }}>{it.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/* ============================================================
   SESSÃO
   ============================================================ */
function SessionFlow({ game, players, a, games, onExit }) {
  const idx = PHASES.findIndex((p) => p.k === game.phase);
  const [delStep, setDelStep] = useState(0);
  const goTo = (k) => a.goTo(game.id, k);

  // sessão anterior com colete a devolver (a mais recente encerrada, diferente da atual)
  const sessaoComColetePendente = games.find(
    (g) => g.id !== game.id && g.coleteLavar && !g.coleteDevolvido && g.status === "encerrada"
  );

  return (
    <div className="min-h-screen flex flex-col">
      <div className="sticky top-0 z-10 px-4 pt-4 pb-3" style={{ background: C.bg, borderBottom: `1px solid ${C.line}` }}>
        <div className="max-w-xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="disp font-700 text-sm">
                {new Date(game.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                {game.status === "aberta" && <span className="ml-2" style={{ color: C.amber }}>● aberta</span>}
              </div>
              <div className="text-[10px]" style={{ color: C.muted }}>{LOCAL}</div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setDelStep(1)} className="text-xs px-2.5 py-1.5 rounded" style={{ background: C.surf, color: C.red, border: `1px solid ${C.line}` }}>🗑</button>
              <button onClick={onExit} className="text-xs px-3 py-1.5 rounded" style={{ background: C.surf, color: C.muted }}>← Jogos</button>
            </div>
          </div>
          <div className="flex gap-1.5">
            {PHASES.map((p, i) => {
              const reached = i <= game.maxPhase;
              return (
                <button key={p.k} onClick={() => reached && goTo(p.k)} disabled={!reached} className="flex-1 text-center">
                  <div className="h-1 rounded-full mb-1" style={{ background: i <= idx ? C.amber : C.line }} />
                  <div className="disp text-[10px] font-600" style={{ color: i === idx ? C.amber : reached ? C.chalk : C.muted, opacity: reached ? 1 : 0.5 }}>{p.label}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex-1 max-w-xl w-full mx-auto px-4 py-5" style={{ paddingBottom: 120 }}>
        {game.phase === "presenca" && <PhasePresenca s={game} players={players} a={a} goTo={goTo} />}
        {game.phase === "times" && <PhaseTimes s={game} players={players} a={a} goTo={goTo} />}
        {game.phase === "jogo" && <PhaseJogo s={game} players={players} a={a} goTo={goTo} sessaoAnterior={sessaoComColetePendente} />}
        {game.phase === "resumo" && <PhaseResumo s={game} players={players} goTo={goTo} />}
        {game.phase === "coletes" && <PhaseColetes s={game} players={players} a={a} goTo={goTo} />}
        {game.phase === "pagamentos" && (
          <PhasePagamentos s={game} players={players} a={a} goTo={goTo} />
        )}
      </div>

      {delStep === 1 && (
        <Modal onClose={() => setDelStep(0)} title="Excluir esta sessão?">
          <p className="text-sm mb-4" style={{ color: C.muted }}>
            Vai apagar lista, times, gols, pagamentos e coletes desta partida. Isso não pode ser desfeito.
          </p>
          <div className="flex gap-2">
            <button onClick={() => setDelStep(0)} className="flex-1 py-2.5 rounded-lg text-sm font-600" style={{ background: C.surf2, color: C.muted }}>Cancelar</button>
            <button onClick={() => setDelStep(2)} className="flex-1 py-2.5 rounded-lg text-sm font-600" style={{ background: `${C.red}22`, color: C.red, border: `1px solid ${C.red}` }}>Continuar</button>
          </div>
        </Modal>
      )}
      {delStep === 2 && (
        <Modal onClose={() => setDelStep(0)} title="Tem certeza mesmo?">
          <p className="text-sm mb-4" style={{ color: C.muted }}>Confirmação final. A sessão será excluída permanentemente.</p>
          <div className="flex gap-2">
            <button onClick={() => setDelStep(0)} className="flex-1 py-2.5 rounded-lg text-sm font-600" style={{ background: C.surf2, color: C.muted }}>Voltar</button>
            <button onClick={() => a.deleteSession(game.id)} className="flex-1 py-2.5 rounded-lg text-sm font-700" style={{ background: C.red, color: "#160B08" }}>Excluir definitivamente</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function PhasePresenca({ s, players, a, goTo }) {
  const [editDate, setEditDate] = useState(false);
  const ativos = players.filter((p) => p.ativo);
  const presIds = s.presentes.map((x) => x.playerId);
  const desIds = s.desistencias.map((x) => x.playerId);
  const disponiveis = ativos.filter((p) => !presIds.includes(p.id) && !desIds.includes(p.id))
    .sort((a, b) => a.apelido.localeCompare(b.apelido, "pt-BR"));
  const name = (id) => players.find((p) => p.id === id)?.apelido;
  const goleiro = (id) => players.find((p) => p.id === id)?.goleiro;

  const confirmar = (id) => a.confirmPresence(s.id, id);
  const desistir = (id) => a.desist(s.id, id);
  const voltar = (id) => a.undoDesist(s.id, id);

  return (
    <div>
      <div className="rounded-xl p-3 mb-4 flex items-center justify-between" style={{ background: C.surf, border: `1px solid ${C.line}` }}>
        <div>
          <div className="text-xs" style={{ color: C.muted }}>Lista aberta às {fmtTime(s.createdAt)}</div>
          {editDate ? (
            <input type="datetime-local" value={isoToLocalInput(s.date)} onChange={(e) => a.updateDate(s.id, localInputToISO(e.target.value))} className="mt-1 rounded px-2 py-1 text-sm" style={{ background: C.bg, color: C.chalk, border: `1px solid ${C.line}` }} />
          ) : (
            <div className="disp text-sm font-600">{new Date(s.date).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "short" })} · {fmtTime(s.date)}</div>
          )}
        </div>
        <button onClick={() => setEditDate((v) => !v)} className="text-xs underline" style={{ color: C.muted }}>{editDate ? "ok" : "editar"}</button>
      </div>

      <h2 className="disp font-600 tracking-wide mb-2" style={{ color: C.green }}>CONFIRMADOS · {s.presentes.length}</h2>
      <div className="space-y-2 mb-5">
        {s.presentes.length === 0 && <div className="text-sm text-center py-4 rounded-xl" style={{ color: C.muted, background: C.surf }}>Toque em um jogador abaixo para confirmar a presença</div>}
        {s.presentes.map((x, i) => (
          <div key={x.playerId} className="flex items-center justify-between rounded-lg px-3 py-2.5 pmpop" style={{ background: C.surf, border: `1px solid ${C.green}44` }}>
            <div className="flex items-center gap-2">
              <span className="disp text-xs w-5" style={{ color: C.muted }}>{i + 1}.</span>
              <span className="font-600 text-sm">{name(x.playerId)}{goleiro(x.playerId) && " 🧤"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs" style={{ color: C.muted }}>{fmtTime(x.at)}</span>
              <button onClick={() => desistir(x.playerId)} className="text-xs px-2 py-1 rounded" style={{ background: C.surf2, color: C.red }}>desistiu</button>
            </div>
          </div>
        ))}
      </div>

      {disponiveis.length > 0 && (
        <>
          <h2 className="disp font-600 tracking-wide mb-2" style={{ color: C.muted }}>TOQUE PARA CONFIRMAR</h2>
          <div className="grid grid-cols-2 gap-2 mb-5">
            {disponiveis.map((p) => (
              <button key={p.id} onClick={() => confirmar(p.id)} className="rounded-lg px-3 py-3 text-left active:scale-95 transition-transform" style={{ background: C.surf2, border: `1px solid ${C.line}` }}>
                <span className="font-600 text-sm">{p.apelido} {p.goleiro && "🧤"}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {s.desistencias.length > 0 && (
        <>
          <h2 className="disp font-600 tracking-wide mb-2" style={{ color: C.red }}>DESISTIRAM · {s.desistencias.length}</h2>
          <div className="space-y-2 mb-5">
            {s.desistencias.map((x) => (
              <div key={x.playerId} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: C.surf, border: `1px solid ${C.line}`, opacity: 0.7 }}>
                <span className="text-sm line-through" style={{ color: C.muted }}>{name(x.playerId)}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: C.muted }}>saiu {fmtTime(x.at)}</span>
                  <button onClick={() => voltar(x.playerId)} className="text-xs px-2 py-1 rounded" style={{ background: C.surf2, color: C.green }}>voltou</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <StickyBar next={{ label: `Definir times (${s.presentes.length})`, disabled: s.presentes.length < 2, onClick: () => goTo("times") }} />
    </div>
  );
}

/* ---------- FASE 2: TIMES ---------- */
function PhaseTimes({ s, players, a, goTo }) {
  const presentes = s.presentes.map((x) => players.find((p) => p.id === x.playerId)).filter(Boolean);
  const teams = s.teams || { A: [], B: [], coleteTeam: "A" };
  const inTeams = [...teams.A, ...teams.B];
  const pool = presentes.map((p) => p.id).filter((id) => !inTeams.includes(id));
  const name = (id) => players.find((p) => p.id === id);

  const setTeams = (t) => a.saveTeams(s.id, t);
  const sortear = () => {
    const gk = presentes.filter((p) => p.goleiro).map((p) => p.id);
    const linha = presentes.filter((p) => !p.goleiro).map((p) => p.id).sort(() => Math.random() - 0.5);
    const A = [], B = [];
    if (gk[0]) A.push(gk[0]); if (gk[1]) B.push(gk[1]);
    gk.slice(2).forEach((g) => (A.length <= B.length ? A : B).push(g));
    linha.forEach((id) => (A.length <= B.length ? A : B).push(id));
    setTeams({ A, B, coleteTeam: teams.coleteTeam });
  };
  const put = (id, side) => setTeams({ ...teams, A: teams.A.filter((x) => x !== id).concat(side === "A" ? id : []), B: teams.B.filter((x) => x !== id).concat(side === "B" ? id : []) });
  const swap = (id) => { const side = teams.A.includes(id) ? "B" : "A"; put(id, side); };

  const Col = ({ side }) => {
    const colete = teams.coleteTeam === side;
    return (
      <div className="rounded-xl p-3" style={{ background: C.surf, border: `1px solid ${coleteCor(colete)}` }}>
        <button onClick={() => setTeams({ ...teams, coleteTeam: side })} className="w-full mb-2 py-1.5 rounded-lg disp font-700 text-sm" style={{ background: `${coleteCor(colete)}22`, color: coleteCor(colete), border: `1px solid ${coleteCor(colete)}66` }}>
          {coleteLabel(colete)}
        </button>
        <div className="space-y-2 min-h-[40px]">
          {teams[side].map((id) => {
            const p = name(id);
            return (
              <div key={id} className="flex items-center justify-between rounded-xl px-3 py-2.5" style={{ background: `${coleteCor(colete)}1A`, border: `1px solid ${coleteCor(colete)}55` }}>
                <span className="font-700 text-base">{p.apelido} {p.goleiro && "🧤"}</span>
                <button onClick={() => swap(id)} className="text-xs px-2 py-1 rounded-lg" style={{ background: C.bg, color: coleteCor(colete) }}>⇄</button>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div>
      <button onClick={sortear} className="w-full py-3 rounded-xl mb-4 disp font-700" style={{ background: C.amber, color: "#241B00" }}>🎲 Sortear times {inTeams.length > 0 && "(refazer)"}</button>
      {pool.length > 0 && (
        <div className="rounded-xl p-3 mb-4" style={{ background: C.surf, border: `1px dashed ${C.line}` }}>
          <div className="text-xs mb-2" style={{ color: C.muted }}>Sem time — sorteie ou distribua manualmente</div>
          <div className="flex flex-wrap gap-1.5">
            {pool.map((id) => (
              <div key={id} className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm" style={{ background: C.surf2 }}>
                {name(id).apelido}
                <button onClick={() => put(id, "A")} className="text-xs px-1 rounded font-700" style={{ background: C.bg, color: C.amber }}>C</button>
                <button onClick={() => put(id, "B")} className="text-xs px-1 rounded font-700" style={{ background: C.bg, color: C.blue }}>S</button>
              </div>
            ))}
          </div>
          <div className="text-[10px] mt-1.5" style={{ color: C.muted }}>C = com colete · S = sem colete (segundo os rótulos abaixo)</div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 mb-2">
        <Col side="A" /><Col side="B" />
      </div>
      <StickyBar back={{ label: "Lista", onClick: () => goTo("presenca") }}
        next={{ label: "Começar o jogo ▶", disabled: teams.A.length === 0 || teams.B.length === 0 || pool.length > 0, onClick: () => goTo("jogo") }} />
    </div>
  );
}

/* ---------- FASE 3: JOGO ---------- */
function PhaseJogo({ s, players, a, goTo, sessaoAnterior }) {
  const name = (id) => players.find((p) => p.id === id);
  const sc = scores(s);
  const comSide = s.teams.coleteTeam, semSide = comSide === "A" ? "B" : "A";
  // mostra check-in de colete se há sessão anterior com colete pendente E o jogo ainda não começou
  const [coleteOk, setColeteOk] = useState(
    !sessaoAnterior || !!sessaoAnterior.coleteDevolvido || !!s.startedAt
  );

  // read-only quando já finalizado
  if (s.jogoFinalizado) {
    return (
      <div>
        <ScoreHead sc={sc} comSide={comSide} semSide={semSide} time={mmss(s.durationSec || 0)} sub="partida encerrada" />
        <Timeline s={s} name={name} />
        <StickyBar back={{ label: "Times", onClick: () => goTo("times") }} next={{ label: "Ver resumo ▶", onClick: () => goTo("resumo") }} />
      </div>
    );
  }

  if (!coleteOk) {
    const quem = players.find((p) => p.id === sessaoAnterior.coleteLavar);
    return <ColeteCheck sessao={sessaoAnterior} quem={quem} a={a} onOk={() => setColeteOk(true)} />;
  }

  return <LiveGame s={s} players={players} a={a} goTo={goTo} />;
}

function ColeteCheck({ sessao, quem, a, onOk }) {
  const data = sessao.date ? new Date(sessao.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "") : "sessão anterior";

  return (
    <div className="flex flex-col items-center py-10 px-2 text-center">
      <div className="text-5xl mb-5">🦺</div>
      <h2 className="disp text-xl font-700 mb-1" style={{ color: C.amber }}>CHECK-IN DE COLETE</h2>
      <p className="text-sm mb-2" style={{ color: C.muted }}>
        Na pelada de <b style={{ color: C.chalk }}>{data}</b>, os coletes foram com:
      </p>
      <div className="disp text-2xl font-700 mb-6" style={{ color: C.amber }}>
        {quem ? quem.apelido : "jogador desconhecido"}
      </div>

      <div className="w-full max-w-sm rounded-2xl p-5 space-y-3" style={{ background: C.surf, border: `1px solid ${C.line}` }}>
        <p className="text-sm" style={{ color: C.chalk }}>Os coletes foram devolvidos hoje?</p>
        <button
          onClick={() => { a.marcarColeteDevolvido(sessao.id); onOk(); }}
          className="w-full py-4 rounded-xl disp font-700 text-base active:scale-[.98] transition-transform"
          style={{ background: C.green, color: "#06231A" }}>
          ✓ SIM, COLETES DEVOLVIDOS
        </button>
        <button
          onClick={onOk}
          className="w-full py-3 rounded-xl disp font-600 text-sm"
          style={{ background: C.surf2, color: C.muted, border: `1px solid ${C.line}` }}>
          Ainda não devolveu — pular
        </button>
      </div>

      <p className="text-xs mt-5 max-w-xs" style={{ color: C.muted }}>
        Se pular, esse check-in aparece de novo na próxima sessão até confirmar a devolução.
      </p>
    </div>
  );
}

function LiveGame({ s, players, a, goTo }) {
  const startElapsed = s.startedAt ? Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 1000) : 0;
  const [now, setNow] = useState(startElapsed);
  const [running, setRunning] = useState(!!s.startedAt);
  const [flash, setFlash] = useState(null);
  const [ownGoalFor, setOwnGoalFor] = useState(null);
  const timer = useRef(null);
  const name = (id) => players.find((p) => p.id === id);

  useEffect(() => {
    if (running) { timer.current = setInterval(() => setNow((n) => n + 1), 1000); return () => clearInterval(timer.current); }
  }, [running]);

  const minute = () => Math.floor(now / 60) + 1;
  const sc = scores(s);
  const comSide = s.teams.coleteTeam, semSide = comSide === "A" ? "B" : "A";

  const start = () => { a.startGame(s.id); setRunning(true); };
  const addGoal = (team, playerId, ownGoal = false) => {
    a.addGoal(s.id, { team, playerId, minute: minute(), ownGoal });
    setFlash({ team, ap: ownGoal ? `contra (${name(playerId).apelido})` : name(playerId).apelido });
    setTimeout(() => setFlash(null), 1300); setOwnGoalFor(null);
  };
  const undo = () => a.undoGoal(s.id);

  if (!s.startedAt && !running) {
    return (
      <div className="text-center py-16">
        <div className="disp text-lg mb-1" style={{ color: C.muted }}>Times prontos</div>
        <div className="text-sm mb-8" style={{ color: C.muted }}>Toque para iniciar o cronômetro</div>
        <button onClick={start} className="disp text-2xl font-700 px-10 py-6 rounded-2xl" style={{ background: C.green, color: "#06231A" }}>▶ INICIAR JOGO</button>
      </div>
    );
  }

  const Panel = ({ side }) => {
    const colete = side === comSide;
    const other = side === "A" ? "B" : "A";
    return (
      <div className="rounded-2xl p-3" style={{ background: C.surf, border: `1px solid ${coleteCor(colete)}` }}>
        <div className="disp font-700 text-sm mb-2 text-center py-1 rounded" style={{ background: `${coleteCor(colete)}1A`, color: coleteCor(colete) }}>{coleteLabel(colete)}</div>
        <div className="space-y-2">
          {s.teams[side].map((id) => {
            const p = name(id);
            const gols = s.goals.filter((g) => g.team === side && g.playerId === id && !g.ownGoal).length;
            return (
              <button key={id} onClick={() => addGoal(side, id)} className="w-full flex items-center justify-between rounded-xl px-3 active:scale-95 transition-transform" style={{ background: `${coleteCor(colete)}18`, minHeight: 56, border: `1px solid ${coleteCor(colete)}66` }}>
                <span className="font-700 text-lg text-left">{p.apelido} {p.goleiro && "🧤"}</span>
                {gols > 0 && <span className="disp text-lg font-700 px-2 rounded-lg" style={{ background: C.bg, color: coleteCor(colete) }}>{gols}</span>}
              </button>
            );
          })}
        </div>
        <button onClick={() => setOwnGoalFor(side)} className="w-full mt-2 py-2 rounded-lg text-xs font-600" style={{ background: C.bg, color: C.muted, border: `1px dashed ${C.line}` }}>+ Gol contra ({coleteLabel(other === comSide)})</button>
      </div>
    );
  };

  return (
    <div>
      <div className="relative">
        <ScoreHead sc={sc} comSide={comSide} semSide={semSide} time={mmss(now)} sub={`${minute()}º min`} live />
        {flash && (
          <div className="absolute inset-0 flex items-center justify-center pmflash rounded-2xl" style={{ background: `${C.bg}E6` }}>
            <div className="text-center pmpop">
              <div className="disp text-2xl font-700" style={{ color: C.green }}>⚽ GOL!</div>
              <div className="font-600">{flash.ap}</div>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between my-3">
        <button onClick={() => setRunning((r) => !r)} className="text-xs px-3 py-1.5 rounded-lg font-600" style={{ background: C.surf2, color: running ? C.amber : C.green }}>{running ? "⏸ Pausar" : "▶ Retomar"}</button>
        {s.goals.length > 0 && <button onClick={undo} className="text-xs px-3 py-1.5 rounded-lg" style={{ background: C.surf2, color: C.red }}>↩ Desfazer gol</button>}
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <Panel side={semSide} /><Panel side={comSide} />
      </div>

      <Timeline s={s} name={name} />

      <StickyBar next={{ label: "Finalizar partida ⏹", onClick: () => { setRunning(false); a.finalizeGame(s.id, now); } }} />

      {ownGoalFor && (
        <Modal onClose={() => setOwnGoalFor(null)} title={`Gol contra — ponto ${coleteLabel(ownGoalFor === comSide)}`}>
          <p className="text-sm mb-3" style={{ color: C.muted }}>Quem fez contra?</p>
          <div className="grid grid-cols-2 gap-2">
            {s.teams[ownGoalFor === "A" ? "B" : "A"].map((id) => (
              <button key={id} onClick={() => addGoal(ownGoalFor, id, true)} className="rounded-lg px-3 py-3 font-600 text-sm active:scale-95" style={{ background: C.surf2, border: `1px solid ${C.line}` }}>{name(id).apelido}</button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function ScoreHead({ sc, comSide, semSide, time, sub, live }) {
  const winSem = sc[semSide] > sc[comSide], winCom = sc[comSide] > sc[semSide];
  return (
    <div className="rounded-2xl p-4" style={{ background: C.surf, border: `1px solid ${C.line}` }}>
      <div className="flex items-center justify-center gap-4 mb-1">
        <span className="disp text-6xl font-700" style={{ color: winSem ? C.green : C.chalk }}>{sc[semSide]}</span>
        <div className="text-center">
          <div className="disp text-2xl font-700 tabular-nums" style={{ color: live ? C.amber : C.muted }}>{time}</div>
          <div className="text-[10px]" style={{ color: C.muted }}>{sub}</div>
        </div>
        <span className="disp text-6xl font-700" style={{ color: winCom ? C.green : C.chalk }}>{sc[comSide]}</span>
      </div>
      <div className="flex justify-between px-2 text-xs disp font-700">
        <span style={{ color: C.blue }}>SEM COLETE</span><span style={{ color: C.amber }}>COM COLETE</span>
      </div>
    </div>
  );
}
function Timeline({ s, name }) {
  if (s.goals.length === 0) return null;
  return (
    <div className="rounded-xl p-3 mb-4" style={{ background: C.surf, border: `1px solid ${C.line}` }}>
      <div className="disp text-xs tracking-widest mb-2" style={{ color: C.muted }}>LINHA DO TEMPO</div>
      <div className="space-y-1">
        {[...s.goals].sort((a, b) => a.minute - b.minute).map((g) => {
          const colete = g.team === s.teams.coleteTeam;
          return (
            <div key={g.id} className="flex items-center gap-2 text-sm">
              <span className="disp w-8 text-right font-700" style={{ color: C.amber }}>{g.minute}'</span>
              <span style={{ color: coleteCor(colete) }}>●</span>
              <span>{g.ownGoal ? "⚠️" : "⚽"} {name(g.playerId).apelido}{g.ownGoal && <em style={{ color: C.red }}> (contra)</em>}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- FASE 4: RESUMO (o print) ---------- */
function PhaseResumo({ s, players, goTo }) {
  const name = (id) => players.find((p) => p.id === id);
  const sc = scores(s);
  const comSide = s.teams.coleteTeam, semSide = comSide === "A" ? "B" : "A";
  const draw = sc.A === sc.B;
  const resultado = draw ? "EMPATE" : `${coleteLabel((sc.A > sc.B ? "A" : "B") === comSide)} VENCEU`;

  const artByTeam = (side) => {
    const map = {};
    s.goals.filter((g) => g.team === side && !g.ownGoal).forEach((g) => { const ap = name(g.playerId).apelido; map[ap] = (map[ap] || 0) + 1; });
    const contras = s.goals.filter((g) => g.team === side && g.ownGoal).map((g) => name(g.playerId).apelido);
    return { art: Object.entries(map).sort((a, b) => b[1] - a[1]), contras };
  };

  const TeamArt = ({ side }) => {
    const colete = side === comSide; const d = artByTeam(side);
    return (
      <div className="rounded-xl p-3" style={{ background: C.surf, border: `1px solid ${coleteCor(colete)}` }}>
        <div className="disp font-700 text-xs text-center py-1 rounded mb-2" style={{ background: `${coleteCor(colete)}1A`, color: coleteCor(colete) }}>{coleteLabel(colete)} · {sc[side]}</div>
        <div className="space-y-1">
          {d.art.length === 0 && d.contras.length === 0 && <div className="text-xs text-center" style={{ color: C.muted }}>—</div>}
          {d.art.map(([ap, n]) => (
            <div key={ap} className="flex items-center justify-between text-sm"><span>⚽ {ap}</span>{n > 1 && <span className="disp font-700" style={{ color: C.amber }}>×{n}</span>}</div>
          ))}
          {d.contras.map((ap, i) => (
            <div key={i} className="text-xs" style={{ color: C.red }}>⚠️ {ap} (contra)</div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="rounded-2xl p-4 mb-4 text-center" style={{ background: `linear-gradient(180deg, ${C.surf2}, ${C.surf})`, border: `1px solid ${C.line}` }}>
        <div className="disp text-[11px] tracking-widest" style={{ color: C.muted }}>{LOCAL.toUpperCase()}</div>
        <div className="text-xs mb-2" style={{ color: C.muted }}>{new Date(s.date).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}</div>
        <div className="flex items-center justify-center gap-4">
          <span className="disp text-7xl font-700" style={{ color: !draw && semSide === (sc.A > sc.B ? "A" : "B") ? C.green : C.chalk }}>{sc[semSide]}</span>
          <span className="disp text-3xl" style={{ color: C.muted }}>×</span>
          <span className="disp text-7xl font-700" style={{ color: !draw && comSide === (sc.A > sc.B ? "A" : "B") ? C.green : C.chalk }}>{sc[comSide]}</span>
        </div>
        <div className="flex justify-center gap-8 text-xs disp font-700 mb-2">
          <span style={{ color: C.blue }}>SEM COLETE</span><span style={{ color: C.amber }}>COM COLETE</span>
        </div>
        <div className="disp font-700 text-sm inline-block px-3 py-1 rounded-full" style={{ background: draw ? C.surf2 : `${C.green}22`, color: draw ? C.muted : C.green }}>{resultado}</div>
      </div>

      <h2 className="disp font-600 tracking-widest text-xs mb-2" style={{ color: C.muted }}>ARTILHEIROS</h2>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <TeamArt side={semSide} /><TeamArt side={comSide} />
      </div>

      <Timeline s={s} name={name} />

      <StickyBar back={{ label: "Jogo", onClick: () => goTo("jogo") }} next={{ label: "Coletes ▶", onClick: () => goTo("coletes") }} />
    </div>
  );
}

/* ---------- FASE 5: COLETES ---------- */
function PhaseColetes({ s, players, a, goTo }) {
  const presentes = s.presentes.map((x) => players.find((p) => p.id === x.playerId)).filter(Boolean)
    .sort((a, b) => a.apelido.localeCompare(b.apelido, "pt-BR"));
  const set = (id) => a.setColeteLavar(s.id, id);
  return (
    <div>
      <h2 className="disp font-600 tracking-wide mb-1" style={{ color: C.amber }}>🧺 QUEM LEVOU OS COLETES PRA LAVAR?</h2>
      <p className="text-xs mb-3" style={{ color: C.muted }}>Feito na hora, logo após o jogo. A devolução é verificada na chegada da próxima partida.</p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {presentes.map((p) => {
          const on = s.coleteLavar === p.id;
          return (
            <button key={p.id} onClick={() => set(p.id)} className="rounded-lg px-3 py-3 text-sm font-600 active:scale-95" style={{ background: on ? `${C.amber}22` : C.surf, border: `1px solid ${on ? C.amber : C.line}`, color: on ? C.amber : C.chalk }}>
              {p.apelido} {on && "✓"}
            </button>
          );
        })}
      </div>
      <StickyBar back={{ label: "Resumo", onClick: () => goTo("resumo") }} next={{ label: "Pagamentos ▶", onClick: () => goTo("pagamentos") }} />
    </div>
  );
}

/* ---------- FASE 6: PAGAMENTOS ---------- */
function PhasePagamentos({ s, players, a, goTo }) {
  const presentes = s.presentes.map((x) => players.find((p) => p.id === x.playerId)).filter(Boolean)
    .sort((a, b) => a.apelido.localeCompare(b.apelido, "pt-BR"));
  const locked = s.pagamentoConcluido;

  // IDs já marcados como goleiro de aluguel nesta sessão
  const goIds = new Set(s.goleirosAluguel.map((g) => g.playerId).filter(Boolean));

  const togglePago = (id) => { if (locked) return; a.togglePago(s.id, id); };

  // Marcar/desmarcar goleiro de aluguel diretamente do card do jogador
  const toggleGoleiro = (player) => {
    if (locked) return;
    const existing = s.goleirosAluguel.find((g) => g.playerId === player.id);
    if (existing) {
      a.removeGoleiro(s.id, existing.id);
    } else {
      a.addGoleiro(s.id, { playerId: player.id, nome: player.apelido, custo: s.custoGoleiro });
    }
  };

  // Editar custo de goleiro já marcado
  const [editCusto, setEditCusto] = useState(null); // { id, valor }
  const salvarCusto = () => {
    if (!editCusto) return;
    const v = parseFloat(String(editCusto.valor).replace(",", "."));
    if (isNaN(v) || v < 0) return;
    // optimistic
    a.updateGoleiroCusto(s.id, editCusto.id, v);
    setEditCusto(null);
  };

  const custoGoleiros = s.goleirosAluguel.reduce((acc, g) => acc + g.custo, 0);
  const arrecadado = s.pagos.length * s.valorJogador;
  const saldo = arrecadado - s.valorQuadra - custoGoleiros;
  const devedores = presentes.length - s.pagos.length;

  return (
    <div>
      {/* FECHAMENTO */}
      <div className="rounded-2xl p-4 mb-4" style={{ background: C.surf, border: `1px solid ${saldo < 0 ? C.red : C.line}` }}>
        <div className="disp text-xs tracking-widest mb-3" style={{ color: C.muted }}>FECHAMENTO DA SESSÃO {locked && "· APLICADO"}</div>
        <div className="space-y-1.5 text-sm">
          <Row l={`${s.pagos.length} pagantes × ${brl(s.valorJogador)}`} v={`+${brl(arrecadado)}`} c={C.green} />
          <Row l="Quadra" v={`−${brl(s.valorQuadra)}`} c={C.red} />
          {custoGoleiros > 0 && <Row l={`${s.goleirosAluguel.length} goleiro(s) de aluguel`} v={`−${brl(custoGoleiros)}`} c={C.red} />}
        </div>
        <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: `1px solid ${C.line}` }}>
          <span className="disp font-600">{saldo >= 0 ? "Vai pra caixinha" : "Sai da caixinha"}</span>
          <span className="disp text-2xl font-700" style={{ color: saldo >= 0 ? C.green : C.red }}>{saldo >= 0 ? "+" : "−"}{brl(saldo)}</span>
        </div>
        {!locked && <div className="text-[11px] mt-2" style={{ color: C.muted }}>A caixinha só muda quando você confirmar o pagamento.</div>}
      </div>

      {/* LISTA DE PRESENTES — pago + goleiro de aluguel integrados */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="disp font-600 tracking-wide" style={{ color: C.green }}>PAGAMENTOS · {s.pagos.length}/{presentes.length}</h2>
        {devedores > 0 && <span className="text-xs" style={{ color: C.red }}>{devedores} devendo</span>}
      </div>
      <div className="space-y-2 mb-4">
        {presentes.map((p) => {
          const pago = s.pagos.includes(p.id);
          const isGo = goIds.has(p.id);
          const goEntry = s.goleirosAluguel.find((g) => g.playerId === p.id);
          return (
            <div key={p.id} className="rounded-xl overflow-hidden" style={{ border: `1px solid ${isGo ? C.blue : pago ? C.green : C.line}` }}>
              {/* linha principal: nome + status pago */}
              <button onClick={() => togglePago(p.id)} className="w-full flex items-center justify-between px-3 py-3 active:scale-[.98]"
                style={{ background: isGo ? `${C.blue}12` : pago ? `${C.green}18` : C.surf, opacity: locked && !pago ? 0.5 : 1 }}>
                <div className="flex items-center gap-2">
                  <span className="font-600 text-sm">{p.apelido}</span>
                  {isGo && <span className="text-xs px-1.5 py-0.5 rounded disp font-600" style={{ background: C.blue, color: "#04121C" }}>ALUGUEL</span>}
                  {!isGo && p.goleiro && <span>🧤</span>}
                </div>
                <span className="disp text-sm font-700" style={{ color: pago ? C.green : C.muted }}>{pago ? "✓ PAGO" : `deve ${brl(s.valorJogador)}`}</span>
              </button>
              {/* linha secundária: marcar/desmarcar aluguel + custo */}
              {!locked && (
                <div className="flex items-center gap-2 px-3 pb-2.5 pt-1" style={{ background: isGo ? `${C.blue}08` : C.surf }}>
                  <button onClick={() => toggleGoleiro(p)}
                    className="text-xs px-2 py-1 rounded font-600"
                    style={{ background: isGo ? `${C.blue}30` : C.surf2, color: isGo ? C.blue : C.muted }}>
                    🧤 {isGo ? "Remover aluguel" : "Goleiro aluguel"}
                  </button>
                  {isGo && goEntry && (
                    editCusto?.id === goEntry.id ? (
                      <div className="flex items-center gap-1 ml-auto">
                        <input autoFocus value={editCusto.valor} onChange={(e) => setEditCusto({ ...editCusto, valor: e.target.value })}
                          onKeyDown={(e) => e.key === "Enter" && salvarCusto()}
                          type="number" className="w-16 rounded px-2 py-1 text-xs" style={{ background: C.bg, color: C.chalk, border: `1px solid ${C.blue}` }} />
                        <button onClick={salvarCusto} className="text-xs px-2 py-1 rounded font-600" style={{ background: C.blue, color: "#04121C" }}>ok</button>
                        <button onClick={() => setEditCusto(null)} className="text-xs px-1" style={{ color: C.muted }}>✕</button>
                      </div>
                    ) : (
                      <button onClick={() => setEditCusto({ id: goEntry.id, valor: String(goEntry.custo) })}
                        className="ml-auto text-xs px-2 py-1 rounded"
                        style={{ background: C.surf2, color: C.red }}>
                        −{brl(goEntry.custo)} ✏️
                      </button>
                    )
                  )}
                </div>
              )}
              {/* locked: só mostra o custo se é goleiro */}
              {locked && isGo && goEntry && (
                <div className="px-3 pb-2 text-xs" style={{ color: C.blue, background: `${C.blue}08` }}>Aluguel: −{brl(goEntry.custo)}</div>
              )}
            </div>
          );
        })}
      </div>

      {locked ? (
        <div className="rounded-xl p-4 mb-3 text-center" style={{ background: `${C.green}14`, border: `1px solid ${C.green}` }}>
          <div className="disp font-700" style={{ color: C.green }}>✓ PAGAMENTO CONCLUÍDO</div>
          <div className="text-xs mt-1" style={{ color: C.muted }}>{saldo >= 0 ? "Entrou" : "Saiu"} {brl(saldo)} {saldo >= 0 ? "na" : "da"} caixinha</div>
          <button onClick={() => a.reabrirPagamento(s.id)} className="text-xs mt-2 underline" style={{ color: C.muted }}>reabrir pagamento</button>
        </div>
      ) : (
        <button onClick={() => a.concluirPagamento(s.id)} className="w-full py-4 rounded-2xl disp text-base font-700 mb-3" style={{ background: C.green, color: "#06231A", boxShadow: `0 8px 24px -10px ${C.green}` }}>
          ✓ CONFIRMAR PAGAMENTO E FECHAR CAIXINHA
        </button>
      )}

      {s.status === "aberta" ? (
        <button onClick={() => a.encerrar(s.id)} className="w-full py-3 rounded-xl disp font-600" style={{ background: C.surf2, color: C.red, border: `1px solid ${C.line}` }}>Encerrar sessão</button>
      ) : (
        <div className="text-center text-xs" style={{ color: C.muted }}>Sessão encerrada</div>
      )}

      <div className="mt-3"><StickyBar back={{ label: "Coletes", onClick: () => goTo("coletes") }} /></div>
    </div>
  );
}

/* ---------- helpers UI ---------- */
function Row({ l, v, c }) {
  return <div className="flex items-center justify-between"><span style={{ color: C.muted }}>{l}</span><span className="disp font-600" style={{ color: c }}>{v}</span></div>;
}
function StickyBar({ back, next }) {
  return (
    <div className="fixed bottom-0 left-0 right-0 px-4 pb-4 pt-3" style={{ background: `linear-gradient(180deg, transparent, ${C.bg} 40%)` }}>
      <div className="max-w-xl mx-auto flex gap-2">
        {back && <button onClick={back.onClick} className="py-4 px-5 rounded-2xl disp font-700 active:scale-95" style={{ background: C.surf2, color: C.muted, border: `1px solid ${C.line}` }}>‹ {back.label}</button>}
        {next && <button onClick={next.onClick} disabled={next.disabled} className="flex-1 py-4 rounded-2xl disp text-base font-700 active:scale-[.98] transition-transform" style={{ background: next.disabled ? C.surf2 : C.amber, color: next.disabled ? C.muted : "#241B00" }}>{next.label}</button>}
      </div>
    </div>
  );
}
function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-30 flex items-end sm:items-center justify-center p-4" style={{ background: "#000A" }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl p-5 pmpop" onClick={(e) => e.stopPropagation()} style={{ background: C.surf, border: `1px solid ${C.line}` }}>
        <div className="flex items-center justify-between mb-3"><h3 className="disp font-700">{title}</h3><button onClick={onClose} style={{ color: C.muted }}>✕</button></div>
        {children}
      </div>
    </div>
  );
}
