import { QUESTION_BANK } from "./questions.js";
 
const ALL_CATEGORIES = Object.keys(QUESTION_BANK);
const ELO_K = 32;
const RANKED_TIMER = 20;
 
// ─── ELO ─────────────────────────────────────────────────────────────────────
function expectedScore(pElo, qElo) { return 1 / (1 + Math.pow(10, (qElo - pElo) / 400)); }
function questionElo(d) { return d === "easy" ? 900 : d === "medium" ? 1200 : 1500; }
function calcEloChange(pElo, d, correct) { return Math.round(ELO_K * ((correct ? 1 : 0) - expectedScore(pElo, questionElo(d)))); }
function calcInitialElo(results) {
  let elo = 1000;
  results.forEach(r => { elo += calcEloChange(elo, r.difficulty, r.correct); });
  return Math.max(400, Math.min(2400, elo));
}
 
// ─── SHUFFLE / PICK ──────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function wrapQ(q) { return { ...q, shuffledOptions: shuffle(q.options.map((t, i) => ({ text: t, originalIndex: i }))) }; }
 
function pickAssessment() {
  const qs = [];
  ALL_CATEGORIES.forEach(cat => { qs.push(...shuffle(QUESTION_BANK[cat]).slice(0, 4)); });
  return shuffle(qs).slice(0, 30).map(wrapQ);
}
 
function adaptivePick(count, pElo, seenIds) {
  const weights = { easy: pElo < 1000 ? 3 : 1, medium: 2, hard: pElo > 1300 ? 3 : 1 };
  const guaranteed = [];
  ALL_CATEGORIES.forEach(cat => {
    const pool = QUESTION_BANK[cat].filter(q => !seenIds.has(q.id));
    guaranteed.push(shuffle(pool.length ? pool : QUESTION_BANK[cat])[0]);
  });
  const gIds = new Set(guaranteed.map(q => q.id));
  const remaining = count - guaranteed.length;
  if (remaining > 0) {
    const pool = Object.values(QUESTION_BANK).flat().filter(q => !seenIds.has(q.id) && !gIds.has(q.id));
    const weighted = pool.flatMap(q => Array(weights[q.difficulty]).fill(q));
    const extra = shuffle(weighted).filter((q, i, a) => a.findIndex(x => x.id === q.id) === i).slice(0, remaining);
    guaranteed.push(...extra);
  }
  return shuffle(guaranteed).map(wrapQ);
}
 
function pickQuick(count, catFilter, diffFilter, seenIds) {
  const prefixMap = { Sports:"sp", History:"hi", "Pop Culture":"pc", "Science & Nature":"sc", Geography:"ge", "Food & Drink":"fd", Music:"mu", Oddities:"od" };
  let pool = Object.values(QUESTION_BANK).flat().filter(q => {
    const catOk = catFilter === "All" || q.id.startsWith(prefixMap[catFilter]);
    const diffOk = diffFilter === "Mixed" || q.difficulty === diffFilter.toLowerCase();
    return catOk && diffOk;
  });
  const fresh = pool.filter(q => !seenIds.has(q.id));
  return shuffle(fresh.length >= count ? fresh : pool).slice(0, count).map(wrapQ);
}
 
function getDailyQuestions() {
  const seed = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  let s = parseInt(seed);
  const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const qs = [];
  ALL_CATEGORIES.forEach(cat => { qs.push(...[...QUESTION_BANK[cat]].sort(() => r() - 0.5).slice(0, 3)); });
  return qs.sort(() => r() - 0.5).slice(0, 20).map(q => ({ ...q, shuffledOptions: q.options.map((t, i) => ({ text: t, originalIndex: i })) }));
}
 
// ─── STORAGE ─────────────────────────────────────────────────────────────────
import { supabase } from './supabase.js'

const loadPlayers = async () => {
  const { data } = await supabase.from('players').select('*')
  const map = {}
  data?.forEach(p => {
    map[p.username] = {
      username: p.username, elo: p.elo, assessed: p.assessed,
      games: p.games, wins: p.wins, dailyStreak: p.daily_streak,
      lastDaily: p.last_daily, eloHistory: p.elo_history || [],
      personalBests: p.personal_bests || {}
    }
  })
  return map
}

const savePlayers = async (ps) => {
  const rows = Object.values(ps).map(p => ({
    username: p.username, elo: p.elo, assessed: p.assessed,
    games: p.games, wins: p.wins, daily_streak: p.dailyStreak,
    last_daily: p.lastDaily, elo_history: p.eloHistory,
    personal_bests: p.personalBests
  }))
  await supabase.from('players').upsert(rows, { onConflict: 'username' })
}

const todayKey = () => new Date().toISOString().slice(0, 10)

const loadDailyScores = async () => {
  const today = todayKey()
  const { data } = await supabase.from('daily_scores').select('*').eq('play_date', today).order('pct', { ascending: false })
  return data?.map(s => ({ username: s.username, score: s.score, total: s.total, pct: s.pct })) || []
}

const saveDailyScore = async (username, score, total) => {
  const pct = Math.round(score / total * 100)
  await supabase.from('daily_scores').upsert({ username, score, total, pct, play_date: todayKey() }, { onConflict: 'username,play_date' })
}

const saveFlag = async (flag) => {
  await supabase.from('flagged_questions').insert({ question_id: flag.questionId, question: flag.question, correct_answer: flag.correctAnswer, note: flag.note })
}
 
// ─── HELPERS ─────────────────────────────────────────────────────────────────
function getRank(elo) {
  if (elo >= 1800) return { label: "Trivia Legend", color: "#FFD700", icon: "👑" };
  if (elo >= 1500) return { label: "Mastermind",    color: "#E879F9", icon: "🧠" };
  if (elo >= 1300) return { label: "Expert",        color: "#60A5FA", icon: "⚡" };
  if (elo >= 1100) return { label: "Contender",     color: "#34D399", icon: "🎯" };
  if (elo >= 900)  return { label: "Apprentice",    color: "#FB923C", icon: "📚" };
  return                  { label: "Novice",         color: "#94A3B8", icon: "🌱" };
}
function catFromId(id) {
  if (id.startsWith("sp")) return "Sports"; if (id.startsWith("hi")) return "History";
  if (id.startsWith("pc")) return "Pop Culture"; if (id.startsWith("sc")) return "Science & Nature";
  if (id.startsWith("ge")) return "Geography"; if (id.startsWith("fd")) return "Food & Drink";
  if (id.startsWith("mu")) return "Music"; return "Oddities";
}
 
// ─── DESIGN TOKENS ───────────────────────────────────────────────────────────
const C = { bg:"#0D0D14", card:"rgba(255,255,255,0.04)", border:"rgba(255,255,255,0.08)", text:"#F0EEF8", muted:"#8B87A8", purple:"#A855F7", green:"#34D399", red:"#EF4444", yellow:"#F59E0B", blue:"#60A5FA" };
const S = {
  app:  { minHeight:"100vh", background:C.bg, color:C.text, fontFamily:"'Georgia',serif", display:"flex", flexDirection:"column", alignItems:"center", padding:"20px 16px 60px" },
  card: { background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:"24px 20px", width:"100%", maxWidth:560 },
  input:{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.12)", borderRadius:10, padding:"12px 16px", color:C.text, fontSize:16, width:"100%", outline:"none", fontFamily:"inherit", boxSizing:"border-box" },
  btn:  (v="primary") => ({ background:v==="primary"?"linear-gradient(135deg,#7C3AED,#A855F7)":v==="danger"?"rgba(239,68,68,0.15)":"transparent", border:v==="ghost"?"1px solid rgba(255,255,255,0.15)":v==="danger"?"1px solid rgba(239,68,68,0.4)":"none", borderRadius:10, padding:"11px 18px", color:v==="danger"?"#FCA5A5":"#fff", fontSize:14, cursor:"pointer", fontFamily:"inherit", fontWeight:600, letterSpacing:"0.2px", transition:"all 0.15s" }),
  opt:  (st) => ({ background:st==="correct"?"rgba(52,211,153,0.15)":st==="wrong"?"rgba(239,68,68,0.15)":st==="selected"?"rgba(124,58,237,0.2)":"rgba(255,255,255,0.04)", border:`1px solid ${st==="correct"?C.green:st==="wrong"?C.red:st==="selected"?C.purple:C.border}`, borderRadius:10, padding:"12px 14px", color:st==="correct"?C.green:st==="wrong"?C.red:C.text, fontSize:14, cursor:st&&st!=="selected"?"default":"pointer", fontFamily:"inherit", textAlign:"left", width:"100%", transition:"all 0.15s", fontWeight:st==="correct"?600:400 }),
  pill: (color) => ({ background:`${color}22`, border:`1px solid ${color}55`, borderRadius:20, padding:"2px 9px", fontSize:12, color, fontWeight:600, display:"inline-block" }),
  bar:  { height:5, background:"rgba(255,255,255,0.08)", borderRadius:3, overflow:"hidden", position:"relative" },
  barFill:(pct,color) => ({ position:"absolute", top:0, left:0, height:"100%", width:`${pct}%`, background:`linear-gradient(90deg,${color},${color}88)`, borderRadius:3, transition:"width 0.3s ease" }),
};
 
// ─── SHARED COMPONENTS ───────────────────────────────────────────────────────
const Pill = ({ color, children }) => <span style={S.pill(color)}>{children}</span>;
const Stat = ({ label, value, color=C.purple }) => (
  <div style={{ background:"rgba(255,255,255,0.04)", borderRadius:10, padding:"10px 6px", textAlign:"center" }}>
    <div style={{ fontSize:18, fontWeight:700, color }}>{value}</div>
    <div style={{ fontSize:11, color:C.muted }}>{label}</div>
  </div>
);
const ModeCard = ({ icon, title, desc, onClick, disabled }) => (
  <button onClick={disabled?undefined:onClick} style={{ background:disabled?"rgba(255,255,255,0.02)":"rgba(255,255,255,0.05)", border:`1px solid ${disabled?"rgba(255,255,255,0.05)":C.border}`, borderRadius:12, padding:"14px 12px", cursor:disabled?"not-allowed":"pointer", textAlign:"left", opacity:disabled?0.4:1, transition:"all 0.15s", fontFamily:"inherit" }}>
    <div style={{ fontSize:22, marginBottom:4 }}>{icon}</div>
    <div style={{ fontSize:14, fontWeight:700, color:C.text, marginBottom:2 }}>{title}</div>
    <div style={{ fontSize:11, color:C.muted }}>{desc}</div>
  </button>
);
const BackBtn = ({ onClick }) => <button style={{ ...S.btn("ghost"), marginBottom:20, padding:"8px 14px", fontSize:13 }} onClick={onClick}>← Back</button>;
 
// ─── WELCOME ─────────────────────────────────────────────────────────────────
function WelcomeScreen({ onLogin }) {
  const [name, setName] = useState("");
  const [known, setKnown] = useState([]);
  useEffect(() => { loadPlayers().then(ps => setKnown(Object.keys(ps))); }, []);
  const go = async () => {
    const n = name.trim(); if (!n) return;
    const ps = await loadPlayers();
    onLogin(n, ps[n] || null, ps);
  };
  return (
    <div style={{ ...S.card, textAlign:"center", marginTop:40 }}>
      <div style={{ fontSize:48, marginBottom:12 }}>🎯</div>
      <div style={{ fontFamily:"'Georgia',serif", fontSize:32, fontWeight:700, color:C.text, marginBottom:4 }}>TRIVIUM</div>
      <div style={{ color:C.muted, fontSize:13, marginBottom:28, letterSpacing:"1px" }}>KNOWLEDGE · RANKED · RELENTLESS</div>
      <input style={S.input} placeholder="Enter your username" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => e.key==="Enter" && go()} autoComplete="off" />
      <div style={{ height:12 }} />
      <button style={{ ...S.btn("primary"), width:"100%" }} onClick={go} disabled={!name.trim()}>Enter the Arena</button>
      {known.length > 0 && <div style={{ marginTop:16, fontSize:12, color:C.muted }}>Known players: {known.join(", ")}</div>}
    </div>
  );
}
 
// ─── HOME ─────────────────────────────────────────────────────────────────────
function HomeScreen({ player, onStart, onLeaderboard, onDaily, onProfile }) {
  const rank = getRank(player.elo || 1000);
  const needs = !player.assessed;
  return (
    <div style={S.card}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:700 }}>Hey, {player.username} 👋</div>
          <div style={{ fontSize:13, color:C.muted, marginTop:2 }}>{needs?"Complete assessment to get ranked":`Elo: ${player.elo} · ${rank.icon} ${rank.label}`}</div>
        </div>
        {!needs && <Pill color={rank.color}>{rank.icon} {rank.label}</Pill>}
      </div>
      {needs && (
        <div style={{ background:"rgba(124,58,237,0.12)", border:"1px solid rgba(124,58,237,0.3)", borderRadius:12, padding:16, marginBottom:16 }}>
          <div style={{ fontWeight:700, color:C.purple, marginBottom:4 }}>📋 Assessment Required</div>
          <div style={{ fontSize:13, color:"#B8B4CC" }}>Answer 30 questions across all categories to determine your starting Elo rating.</div>
          <button style={{ ...S.btn("primary"), marginTop:12, width:"100%" }} onClick={() => onStart("assessment")}>Start 30-Question Assessment</button>
        </div>
      )}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
        <ModeCard icon="🏆" title="Ranked Play"     desc="All categories · Elo at stake"    onClick={() => onStart("ranked")} disabled={needs} />
        <ModeCard icon="⚡" title="Quick Play"      desc="Your rules · No pressure"         onClick={() => onStart("quick")} />
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
        <ModeCard icon="📅" title="Daily Challenge" desc="Beat today's leaderboard"         onClick={onDaily} />
        <ModeCard icon="📊" title="Leaderboard"     desc="See the rankings"                 onClick={onLeaderboard} />
      </div>
      <ModeCard icon="👤" title="My Profile" desc="Stats, Elo history & personal bests" onClick={onProfile} />
      {!needs && (
        <div style={{ marginTop:16, display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
          <Stat label="Elo"          value={player.elo} />
          <Stat label="Ranked Games" value={player.games || 0} />
          <Stat label="Daily Streak" value={`🔥${player.dailyStreak || 0}`} color={C.yellow} />
        </div>
      )}
    </div>
  );
}
 
// ─── RANKED SETUP ────────────────────────────────────────────────────────────
function RankedSetupScreen({ onStart, onBack }) {
  const [count, setCount] = useState(20);
  return (
    <div style={S.card}>
      <BackBtn onClick={onBack} />
      <div style={{ fontSize:20, fontWeight:700, marginBottom:4 }}>🏆 Ranked Play</div>
      <div style={{ fontSize:13, color:C.muted, marginBottom:8 }}>All 8 categories · At least 1 from each · Elo on the line</div>
      <div style={{ background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.25)", borderRadius:8, padding:"8px 12px", marginBottom:20, fontSize:12, color:"#FCA5A5" }}>
        ⏱ 20-second timer per question. Unanswered = wrong. Tab switches are logged.
      </div>
      <div style={{ fontSize:13, fontWeight:600, color:C.muted, marginBottom:10 }}>HOW MANY QUESTIONS?</div>
      {[[10,"Quick","~5 min"],[20,"Standard","~10 min · Recommended"],[30,"Deep Dive","~15 min"]].map(([n,label,note]) => (
        <button key={n} onClick={() => setCount(n)} style={{ ...S.btn(count===n?"primary":"ghost"), width:"100%", marginBottom:8, textAlign:"left" }}>
          {n} Questions · {label} <span style={{ opacity:0.6, fontSize:12 }}>({note})</span>
        </button>
      ))}
      <button style={{ ...S.btn("primary"), width:"100%", marginTop:8 }} onClick={() => onStart(count)}>Start Ranked Match</button>
    </div>
  );
}
 
// ─── QUICK SETUP ─────────────────────────────────────────────────────────────
function QuickSetupScreen({ onStart, onBack }) {
  const [cat,   setCat]   = useState("All");
  const [diff,  setDiff]  = useState("Mixed");
  const [count, setCount] = useState(10);
  return (
    <div style={S.card}>
      <BackBtn onClick={onBack} />
      <div style={{ fontSize:20, fontWeight:700, marginBottom:4 }}>⚡ Quick Play</div>
      <div style={{ fontSize:13, color:C.muted, marginBottom:20 }}>Your rules. No Elo impact.</div>
      {[["CATEGORY",["All",...ALL_CATEGORIES],cat,setCat],["DIFFICULTY",["Easy","Medium","Hard","Mixed"],diff,setDiff]].map(([label,opts,val,set]) => (
        <div key={label} style={{ marginBottom:16 }}>
          <div style={{ fontSize:12, fontWeight:600, color:C.muted, marginBottom:8 }}>{label}</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>{opts.map(o => <button key={o} onClick={() => set(o)} style={{ ...S.btn(val===o?"primary":"ghost"), padding:"5px 11px", fontSize:12 }}>{o}</button>)}</div>
        </div>
      ))}
      <div style={{ marginBottom:20 }}>
        <div style={{ fontSize:12, fontWeight:600, color:C.muted, marginBottom:8 }}>QUESTIONS</div>
        <div style={{ display:"flex", gap:6 }}>{[5,10,15,20,30].map(n => <button key={n} onClick={() => setCount(n)} style={{ ...S.btn(count===n?"primary":"ghost"), padding:"5px 11px", fontSize:12 }}>{n}</button>)}</div>
      </div>
      <button style={{ ...S.btn("primary"), width:"100%" }} onClick={() => onStart({ cat, diff, count })}>Start Game</button>
    </div>
  );
}
 
// ─── GAME SCREEN ─────────────────────────────────────────────────────────────
function GameScreen({ questions, mode, onComplete }) {
  const [cur,         setCur]         = useState(0);
  const [selected,    setSelected]    = useState(null);
  const [locked,      setLocked]      = useState(null);
  const [revealed,    setRevealed]    = useState(false);
  const [results,     setResults]     = useState([]);
  const [timeLeft,    setTimeLeft]    = useState(mode==="ranked" ? RANKED_TIMER : null);
  const [tabSwitches, setTabSwitches] = useState(0);
  const [showWarn,    setShowWarn]    = useState(false);
  const [streak,      setStreak]      = useState(0);
  const [streakFlash, setStreakFlash] = useState(false);
  const timerRef = useRef(null);
 
  const q   = questions[cur];
  const pct = Math.round((cur / questions.length) * 100);
 
  const doReveal = (chosenIdx, timedOut = false) => {
    clearInterval(timerRef.current);
    const correct    = !timedOut && chosenIdx === q.answer;
    const newStreak  = correct ? streak + 1 : 0;
    setStreak(newStreak);
    if (newStreak >= 3) { setStreakFlash(true); setTimeout(() => setStreakFlash(false), 1500); }
    setResults(r => [...r, { difficulty:q.difficulty, correct, id:q.id, timedOut, originalQ:q }]);
    setLocked(timedOut ? -1 : chosenIdx);
    setRevealed(true);
  };
 
  useEffect(() => {
    if (mode !== "ranked" || revealed) return;
    setTimeLeft(RANKED_TIMER);
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(timerRef.current); doReveal(null, true); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [cur, mode]);
 
  useEffect(() => {
    if (mode !== "ranked") return;
    const onBlur = () => { if (!revealed) { setTabSwitches(n => n+1); setShowWarn(true); } };
    const onVis  = () => { if (document.hidden && !revealed) { setTabSwitches(n => n+1); setShowWarn(true); } };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVis);
    return () => { window.removeEventListener("blur", onBlur); document.removeEventListener("visibilitychange", onVis); };
  }, [mode, revealed]);
 
  const choose  = (idx) => { if (revealed) return; setSelected(idx); };
  const confirm = () => { if (selected===null || revealed) return; doReveal(selected); };
  const next    = () => {
    if (cur+1 >= questions.length) { onComplete(results, tabSwitches); return; }
    setCur(c => c+1); setSelected(null); setLocked(null); setRevealed(false);
    if (mode==="ranked") setTimeLeft(RANKED_TIMER);
  };
 
  const getOptState = (opt) => {
    if (!revealed) return selected===opt.originalIndex ? "selected" : null;
    if (opt.originalIndex===q.answer) return "correct";
    if (opt.originalIndex===locked && locked!==q.answer) return "wrong";
    return null;
  };
 
  const modeColor = { assessment:C.yellow, ranked:C.purple, quick:C.green, daily:C.blue }[mode] || C.purple;
  const timerColor = timeLeft<=5 ? C.red : timeLeft<=10 ? C.yellow : C.green;
 
  return (
    <div style={S.card}>
      {/* Header row */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <Pill color={modeColor}>{mode==="assessment"?"Assessment":mode==="ranked"?"🏆 Ranked":mode==="daily"?"📅 Daily":"⚡ Quick"}</Pill>
          {mode==="ranked" && tabSwitches>0 && <Pill color={C.red}>⚠ {tabSwitches} switch{tabSwitches>1?"es":""}</Pill>}
        </div>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          {mode==="ranked" && !revealed && <div style={{ fontSize:14, fontWeight:700, color:timerColor, minWidth:28, textAlign:"center" }}>{timeLeft}s</div>}
          <div style={{ fontSize:13, color:C.muted }}>{cur+1}/{questions.length}</div>
        </div>
      </div>
 
      {/* Timer bar */}
      {mode==="ranked" && !revealed && (
        <div style={{ ...S.bar, marginBottom:10 }}>
          <div style={{ ...S.barFill(timeLeft/RANKED_TIMER*100, timerColor), transition:"width 1s linear" }} />
        </div>
      )}
 
      {/* Tab switch warning */}
      {showWarn && mode==="ranked" && (
        <div style={{ background:"rgba(239,68,68,0.12)", border:"1px solid rgba(239,68,68,0.3)", borderRadius:10, padding:"8px 12px", marginBottom:12, fontSize:12, color:"#FCA5A5", display:"flex", justifyContent:"space-between" }}>
          ⚠️ Tab switch detected and logged!
          <button onClick={() => setShowWarn(false)} style={{ background:"none", border:"none", color:"#FCA5A5", cursor:"pointer" }}>✕</button>
        </div>
      )}
 
      {/* Streak */}
      {streak >= 3 && revealed && (
        <div style={{ textAlign:"center", fontSize:streakFlash?18:14, color:C.yellow, marginBottom:8, fontWeight:700 }}>
          {streakFlash ? `🔥🔥 ${streak} STREAK! 🔥🔥` : `🔥 ${streak} in a row!`}
        </div>
      )}
 
      {/* Progress bar */}
      <div style={{ ...S.bar, marginBottom:20 }}><div style={S.barFill(pct, modeColor)} /></div>
 
      {/* Question */}
      <div style={{ fontSize:17, fontWeight:600, lineHeight:1.55, marginBottom:20, color:C.text }}>{q.q}</div>
 
      {/* Options */}
      <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:14 }}>
        {q.shuffledOptions.map((opt,i) => (
          <button key={i} style={S.opt(getOptState(opt))} onClick={() => choose(opt.originalIndex)}>
            <span style={{ opacity:0.45, marginRight:8, fontSize:12 }}>{["A","B","C","D"][i]}</span>
            {opt.text}
            {revealed && opt.originalIndex===q.answer                              && <span style={{ float:"right" }}>✓</span>}
            {revealed && opt.originalIndex===locked && locked!==q.answer           && <span style={{ float:"right" }}>✗</span>}
          </button>
        ))}
      </div>
 
      {!revealed ? (
        <>
          <button style={{ ...S.btn("primary"), width:"100%", opacity:selected!==null?1:0.4 }} disabled={selected===null} onClick={confirm}>Submit Answer</button>
          {selected!==null && <div style={{ textAlign:"center", fontSize:12, color:C.muted, marginTop:8 }}>Change your mind? Tap another option first.</div>}
        </>
      ) : (
        <button style={{ ...S.btn("primary"), width:"100%" }} onClick={next}>{cur+1>=questions.length?"See Results":"Next →"}</button>
      )}
    </div>
  );
}
 
// ─── RESULTS ─────────────────────────────────────────────────────────────────
function ResultsScreen({ mode, results, tabSwitches, player, onSaveAndHome, onReview }) {
  const correct = results.filter(r => r.correct).length;
  const pct     = Math.round(correct/results.length*100);
  let newElo = player.elo||1000, eloChange = 0;
  if (mode==="assessment") { newElo=calcInitialElo(results); eloChange=newElo-1000; }
  else if (mode==="ranked") {
    results.forEach(r => { const c=calcEloChange(newElo,r.difficulty,r.correct); newElo+=c; eloChange+=c; });
    newElo=Math.max(400,Math.min(2400,newElo)); eloChange=newElo-player.elo;
  }
  const rank = getRank(mode==="assessment"||mode==="ranked" ? newElo : player.elo||1000);
  return (
    <div style={S.card}>
      <div style={{ textAlign:"center", marginBottom:20 }}>
        <div style={{ fontSize:48 }}>{pct>=80?"🏆":pct>=60?"🎯":pct>=40?"📚":"💪"}</div>
        <div style={{ fontSize:28, fontWeight:700, marginTop:8 }}>{correct}/{results.length}</div>
        <div style={{ fontSize:14, color:C.muted }}>{pct}% correct</div>
      </div>
      {(mode==="assessment"||mode==="ranked") && (
        <div style={{ background:"rgba(124,58,237,0.12)", border:"1px solid rgba(124,58,237,0.25)", borderRadius:12, padding:16, marginBottom:16, textAlign:"center" }}>
          {mode==="assessment" ? (<>
            <div style={{ fontSize:13, color:C.muted, marginBottom:4 }}>Your Starting Elo</div>
            <div style={{ fontSize:36, fontWeight:700, color:C.purple }}>{newElo}</div>
            <div style={{ fontSize:14, color:rank.color, marginTop:4 }}>{rank.icon} {rank.label}</div>
          </>) : (<>
            <div style={{ fontSize:13, color:C.muted, marginBottom:4 }}>Elo Change</div>
            <div style={{ fontSize:36, fontWeight:700, color:eloChange>=0?C.green:C.red }}>{eloChange>=0?"+":""}{eloChange}</div>
            <div style={{ fontSize:13, color:C.muted }}>{player.elo} → {newElo} · {rank.icon} {rank.label}</div>
          </>)}
        </div>
      )}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:14 }}>
        <Stat label="Correct"  value={correct}              color={C.green} />
        <Stat label="Wrong"    value={results.length-correct} color={C.red} />
        <Stat label="Accuracy" value={`${pct}%`} />
      </div>
      {mode==="ranked" && tabSwitches>0 && (
        <div style={{ background:"rgba(239,68,68,0.1)", border:"1px solid rgba(239,68,68,0.25)", borderRadius:10, padding:"8px 12px", marginBottom:14, fontSize:12, color:"#FCA5A5" }}>
          ⚠️ {tabSwitches} tab switch{tabSwitches>1?"es":""} detected — logged on your result.
        </div>
      )}
      <button style={{ ...S.btn("primary"), width:"100%", marginBottom:8 }} onClick={() => onSaveAndHome(newElo, mode, results)}>Save & Return Home</button>
      <button style={{ ...S.btn("ghost"),   width:"100%" }}                 onClick={() => onReview(results)}>📋 Review Answers</button>
    </div>
  );
}
 
// ─── REVIEW SCREEN ───────────────────────────────────────────────────────────
function ReviewScreen({ results, onBack }) {
  const [flagged,   setFlagged]   = useState({});
  const [flagNote,  setFlagNote]  = useState({});
  const [submitted, setSubmitted] = useState({});
 
  const submitFlag = async (r) => {
    await saveFlag({ questionId:r.id, question:r.originalQ?.q, correctAnswer:r.originalQ?.options[r.originalQ?.answer], note:flagNote[r.id]||"", timestamp:new Date().toISOString() });
    setSubmitted(s => ({ ...s, [r.id]:true }));
    setFlagged(f => ({ ...f, [r.id]:false }));
  };
 
  return (
    <div style={S.card}>
      <BackBtn onClick={onBack} />
      <div style={{ fontSize:20, fontWeight:700, marginBottom:4 }}>📋 Answer Review</div>
      <div style={{ fontSize:13, color:C.muted, marginBottom:20 }}>Review every question. Flag anything that looks wrong.</div>
      {results.map((r, i) => {
        const q = r.originalQ; if (!q) return null;
        const correctText = q.options[q.answer];
        return (
          <div key={r.id} style={{ background:r.correct?"rgba(52,211,153,0.06)":"rgba(239,68,68,0.06)", border:`1px solid ${r.correct?"rgba(52,211,153,0.2)":"rgba(239,68,68,0.2)"}`, borderRadius:12, padding:14, marginBottom:12 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
              <div style={{ fontSize:12, color:C.muted }}>{i+1}. {catFromId(r.id)}</div>
              <div style={{ display:"flex", gap:6 }}>
                <Pill color={r.difficulty==="easy"?C.green:r.difficulty==="medium"?C.yellow:C.red}>{r.difficulty}</Pill>
                <Pill color={r.correct?C.green:C.red}>{r.correct?"✓ Correct":r.timedOut?"⏱ Timed Out":"✗ Wrong"}</Pill>
              </div>
            </div>
            <div style={{ fontSize:14, fontWeight:600, marginBottom:10, lineHeight:1.4 }}>{q.q}</div>
            <div style={{ fontSize:13, color:C.green }}>✓ Correct answer: {correctText}</div>
            {submitted[r.id] ? (
              <div style={{ fontSize:12, color:C.green, marginTop:8 }}>✓ Flag submitted — thank you for the feedback!</div>
            ) : flagged[r.id] ? (
              <div style={{ marginTop:10 }}>
                <textarea placeholder="Optional: describe the issue (e.g. answer seems wrong because...)" value={flagNote[r.id]||""} onChange={e => setFlagNote(n => ({ ...n, [r.id]:e.target.value }))} style={{ ...S.input, fontSize:13, minHeight:60, resize:"vertical", marginBottom:8 }} />
                <div style={{ display:"flex", gap:8 }}>
                  <button style={{ ...S.btn("danger"), flex:1 }} onClick={() => submitFlag(r)}>Submit Flag</button>
                  <button style={{ ...S.btn("ghost"),  flex:1 }} onClick={() => setFlagged(f => ({ ...f, [r.id]:false }))}>Cancel</button>
                </div>
              </div>
            ) : (
              <button style={{ ...S.btn("ghost"), marginTop:8, padding:"5px 12px", fontSize:12 }} onClick={() => setFlagged(f => ({ ...f, [r.id]:true }))}>🚩 Flag this question</button>
            )}
          </div>
        );
      })}
    </div>
  );
}
 
// ─── PROFILE SCREEN ──────────────────────────────────────────────────────────
function ProfileScreen({ player, onBack }) {
  const rank    = getRank(player.elo || 1000);
  const history = player.eloHistory || [];
  const bests   = player.personalBests || {};
  const chartH  = 80, chartW = 300;
  const pts     = history.length > 1 ? history : [];
  let path = "";
  if (pts.length > 1) {
    const minE = Math.min(...pts.map(p => p.elo)) - 20;
    const maxE = Math.max(...pts.map(p => p.elo)) + 20;
    path = pts.map((p, i) => {
      const x = (i / (pts.length-1)) * chartW;
      const y = chartH - ((p.elo - minE) / (maxE - minE)) * chartH;
      return `${i===0?"M":"L"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  }
  return (
    <div style={S.card}>
      <BackBtn onClick={onBack} />
      <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:20 }}>
        <div style={{ width:52, height:52, borderRadius:"50%", background:`${rank.color}33`, border:`2px solid ${rank.color}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:24 }}>{rank.icon}</div>
        <div>
          <div style={{ fontSize:18, fontWeight:700 }}>{player.username}</div>
          <div style={{ fontSize:13, color:rank.color }}>{rank.label} · {player.elo || "Unranked"}</div>
        </div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:20 }}>
        <Stat label="Elo"          value={player.elo || "—"} />
        <Stat label="Ranked Games" value={player.games || 0} />
        <Stat label="Daily Streak" value={`🔥${player.dailyStreak||0}`} color={C.yellow} />
      </div>
 
      {/* Elo History Graph */}
      <div style={{ marginBottom:20 }}>
        <div style={{ fontSize:13, fontWeight:600, color:C.muted, marginBottom:10 }}>ELO HISTORY</div>
        {pts.length > 1 ? (
          <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:10, padding:12 }}>
            <svg viewBox={`0 0 ${chartW} ${chartH}`} style={{ width:"100%", height:chartH }}>
              <defs>
                <linearGradient id="eloGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={C.purple} stopOpacity="0.3" />
                  <stop offset="100%" stopColor={C.purple} stopOpacity="0"   />
                </linearGradient>
              </defs>
              {path && <>
                <path d={path + ` L${chartW},${chartH} L0,${chartH} Z`} fill="url(#eloGrad)" />
                <path d={path} fill="none" stroke={C.purple} strokeWidth="2" strokeLinecap="round" />
                {pts.map((p, i) => {
                  const minE = Math.min(...pts.map(x=>x.elo))-20, maxE = Math.max(...pts.map(x=>x.elo))+20;
                  const x = (i/(pts.length-1))*chartW, y = chartH-((p.elo-minE)/(maxE-minE))*chartH;
                  return <circle key={i} cx={x} cy={y} r="3" fill={C.purple} />;
                })}
              </>}
            </svg>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:C.muted, marginTop:4 }}>
              <span>{pts[0]?.date}</span>
              <span>Latest: {pts[pts.length-1]?.elo}</span>
            </div>
          </div>
        ) : (
          <div style={{ color:C.muted, fontSize:13, textAlign:"center", padding:16 }}>Play ranked games to build your Elo history graph.</div>
        )}
      </div>
 
      {/* Personal Bests */}
      <div>
        <div style={{ fontSize:13, fontWeight:600, color:C.muted, marginBottom:10 }}>PERSONAL BESTS</div>
        {Object.keys(bests).length === 0 ? (
          <div style={{ color:C.muted, fontSize:13, textAlign:"center", padding:16 }}>Complete games to set personal bests.</div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {Object.entries(bests).map(([mode, data]) => (
              <div key={mode} style={{ display:"flex", justifyContent:"space-between", padding:"10px 14px", background:"rgba(255,255,255,0.04)", borderRadius:10 }}>
                <div>
                  <div style={{ fontWeight:600, fontSize:14 }}>{mode==="ranked"?"🏆 Ranked":mode==="quick"?"⚡ Quick Play":mode==="daily"?"📅 Daily":"📋 Assessment"}</div>
                  <div style={{ fontSize:12, color:C.muted }}>{data.date}</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontWeight:700, color:C.purple }}>{data.score}/{data.total}</div>
                  <div style={{ fontSize:12, color:C.muted }}>{data.pct}%</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
 
// ─── LEADERBOARD ─────────────────────────────────────────────────────────────
function LeaderboardScreen({ players, onBack }) {
  const [tab,   setTab]   = useState("ranked");
  const [daily, setDaily] = useState([]);
  useEffect(() => { loadDailyScores().then(setDaily); }, []);
  const sorted = Object.values(players).filter(p => p.assessed).sort((a,b) => b.elo-a.elo);
  const today  = new Date().toLocaleDateString("en-US", { month:"short", day:"numeric" });
  const medal  = (i) => i<3 ? ["🥇","🥈","🥉"][i] : i+1;
  const medalColor = (i) => i===0?"#FFD700":i===1?"#C0C0C0":i===2?"#CD7F32":C.muted;
  return (
    <div style={S.card}>
      <BackBtn onClick={onBack} />
      <div style={{ fontSize:20, fontWeight:700, marginBottom:16 }}>📊 Leaderboard</div>
      <div style={{ display:"flex", gap:6, marginBottom:20, background:"rgba(255,255,255,0.04)", borderRadius:10, padding:4 }}>
        {[["ranked","🏆 Ranked Elo"],["daily",`📅 Daily (${today})`]].map(([k,lbl]) => (
          <button key={k} onClick={() => setTab(k)} style={{ flex:1, padding:"8px 10px", borderRadius:8, border:"none", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:600, background:tab===k?"linear-gradient(135deg,#7C3AED,#A855F7)":"transparent", color:tab===k?"#fff":C.muted }}>
            {lbl}
          </button>
        ))}
      </div>
      {tab==="ranked" && (
        <>
          {sorted.length===0 && <div style={{ color:C.muted, textAlign:"center", padding:24 }}>No ranked players yet.</div>}
          {sorted.map((p,i) => { const r=getRank(p.elo); return (
            <div key={p.username} style={{ display:"flex", gap:12, alignItems:"center", padding:"11px 0", borderBottom:`1px solid ${C.border}` }}>
              <div style={{ width:28, textAlign:"center", fontSize:16, fontWeight:700, color:medalColor(i) }}>{medal(i)}</div>
              <div style={{ flex:1 }}><div style={{ fontWeight:600 }}>{p.username}</div><div style={{ fontSize:12, color:r.color }}>{r.icon} {r.label}</div></div>
              <div style={{ textAlign:"right" }}><div style={{ fontWeight:700, color:C.purple }}>{p.elo}</div><div style={{ fontSize:11, color:C.muted }}>{p.games||0} games</div></div>
            </div>
          );})}
        </>
      )}
      {tab==="daily" && (
        <>
          <div style={{ fontSize:12, color:C.muted, marginBottom:14 }}>Today's 20-question challenge · resets at midnight</div>
          {daily.length===0 && <div style={{ color:C.muted, textAlign:"center", padding:24 }}>No scores yet. Be the first!</div>}
          {daily.map((s,i) => (
            <div key={s.username} style={{ display:"flex", gap:12, alignItems:"center", padding:"11px 0", borderBottom:`1px solid ${C.border}` }}>
              <div style={{ width:28, textAlign:"center", fontSize:16, fontWeight:700, color:medalColor(i) }}>{medal(i)}</div>
              <div style={{ flex:1, fontWeight:600 }}>{s.username}</div>
              <div style={{ textAlign:"right" }}><div style={{ fontWeight:700, color:C.blue }}>{s.score}/{s.total}</div><div style={{ fontSize:11, color:C.muted }}>{s.pct}%</div></div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
 
// ─── DAILY SCREEN ─────────────────────────────────────────────────────────────
function DailyScreen({ player, onBack, onComplete }) {
  const [phase,     setPhase]     = useState("intro");
  const [questions]               = useState(getDailyQuestions);
  const [daily,     setDaily]     = useState([]);
  const [results,   setResults]   = useState([]);
  useEffect(() => { loadDailyScores().then(setDaily); }, []);
 
  const handleComplete = async (res) => {
    const correct = res.filter(r => r.correct).length;
    await saveDailyScore(player.username, correct, res.length);
    setResults(res);
    setDaily(await loadDailyScores());
    setPhase("scores");
    onComplete(res);          // bubble up so App can update personal bests & streak
  };
 
  if (phase==="game") return <GameScreen questions={questions} mode="daily" onComplete={handleComplete} />;
 
  const today   = new Date().toLocaleDateString("en-US", { weekday:"long", month:"long", day:"numeric" });
  const correct = results.filter(r => r.correct).length;
  return (
    <div style={S.card}>
      <BackBtn onClick={onBack} />
      <div style={{ fontSize:20, fontWeight:700, marginBottom:4 }}>📅 Daily Challenge</div>
      <div style={{ fontSize:13, color:C.muted, marginBottom:20 }}>{today}</div>
      {phase==="scores" && (
        <div style={{ background:"rgba(96,165,250,0.12)", border:"1px solid rgba(96,165,250,0.25)", borderRadius:12, padding:16, marginBottom:16, textAlign:"center" }}>
          <div style={{ fontSize:13, color:C.muted }}>Your Score</div>
          <div style={{ fontSize:36, fontWeight:700, color:C.blue }}>{correct}/{results.length}</div>
          <div style={{ fontSize:13, color:C.muted }}>{Math.round(correct/results.length*100)}%</div>
        </div>
      )}
      <div style={{ fontSize:13, fontWeight:600, color:C.muted, marginBottom:12 }}>TODAY'S LEADERBOARD</div>
      {daily.length===0 && <div style={{ color:C.muted, fontSize:13, marginBottom:16 }}>No scores yet. Be the first!</div>}
      {daily.map((s,i) => (
        <div key={s.username} style={{ display:"flex", gap:12, alignItems:"center", padding:"10px 0", borderBottom:`1px solid ${C.border}` }}>
          <div style={{ width:24, textAlign:"center", fontSize:14, fontWeight:700, color:i===0?"#FFD700":i===1?"#C0C0C0":i===2?"#CD7F32":C.muted }}>{i<3?["🥇","🥈","🥉"][i]:i+1}</div>
          <div style={{ flex:1, fontWeight:s.username===player.username?700:400, color:s.username===player.username?C.blue:C.text }}>{s.username}</div>
          <div style={{ fontWeight:700, color:C.blue }}>{s.score}/{s.total}</div>
          <div style={{ fontSize:12, color:C.muted, width:36, textAlign:"right" }}>{s.pct}%</div>
        </div>
      ))}
      {phase==="intro" && <button style={{ ...S.btn("primary"), width:"100%", marginTop:20 }} onClick={() => setPhase("game")}>Play Today's Challenge (20 questions)</button>}
    </div>
  );
}
 
// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [screen,         setScreen]         = useState("welcome");
  const [player,         setPlayer]         = useState(null);
  const [players,        setPlayers]        = useState({});
  const [questions,      setQuestions]      = useState([]);
  const [gameMode,       setGameMode]       = useState(null);
  const [gameResults,    setGameResults]    = useState([]);
  const [gameTabSwitches,setGameTabSwitches]= useState(0);
  const [reviewResults,  setReviewResults]  = useState([]);
  const [seenIds,        setSeenIds]        = useState(new Set());
 
  const refresh = async () => { const ps = await loadPlayers(); setPlayers(ps); return ps; };
 
  const handleLogin = async (username, existing, ps) => {
    setPlayers(ps);
    const p = ps[username] || { username, elo:null, assessed:false, games:0, wins:0, dailyStreak:0, lastDaily:null, eloHistory:[], personalBests:{} };
    setPlayer(p); setScreen("home");
  };
 
  const handleStart = (mode) => {
    if (mode==="assessment") {
      const qs = pickAssessment();
      setSeenIds(new Set(qs.map(q => q.id)));
      setQuestions(qs); setGameMode("assessment"); setScreen("game");
    } else if (mode==="ranked") setScreen("ranked-setup");
    else if (mode==="quick")    setScreen("quick-setup");
  };
 
  const startRanked = (count) => {
    const qs = adaptivePick(count, player.elo||1000, seenIds);
    setSeenIds(s => new Set([...s, ...qs.map(q => q.id)]));
    setQuestions(qs); setGameMode("ranked"); setScreen("game");
  };
 
  const startQuick = ({ cat, diff, count }) => {
    const qs = pickQuick(count, cat, diff, seenIds);
    setSeenIds(s => new Set([...s, ...qs.map(q => q.id)]));
    setQuestions(qs); setGameMode("quick"); setScreen("game");
  };
 
  const handleGameComplete = (results, tabs=0) => {
    setGameResults(results); setGameTabSwitches(tabs); setScreen("results");
  };
 
  const persistPlayer = async (updatedPlayer) => {
    const ps = await loadPlayers();
    ps[updatedPlayer.username] = updatedPlayer;
    await savePlayers(ps);
    setPlayer(updatedPlayer); setPlayers(ps);
  };
 
  const handleSaveAndHome = async (newElo, mode, results) => {
    const ps  = await loadPlayers();
    const p   = { ...(ps[player.username] || player) };
    const correct = results.filter(r => r.correct).length;
    const pct = Math.round(correct/results.length*100);
    const today = todayKey();
 
    // personal bests
    if (!p.personalBests) p.personalBests = {};
    const pb = p.personalBests[mode];
    if (!pb || pct > pb.pct) p.personalBests[mode] = { score:correct, total:results.length, pct, date:today };
 
    if (mode==="assessment") {
      p.elo=newElo; p.assessed=true;
      p.eloHistory=[{ elo:newElo, date:today }];
    } else if (mode==="ranked") {
      p.elo=newElo; p.games=(p.games||0)+1;
      if (correct/results.length>=0.6) p.wins=(p.wins||0)+1;
      if (!p.eloHistory) p.eloHistory=[];
      p.eloHistory.push({ elo:newElo, date:today });
      if (p.eloHistory.length>30) p.eloHistory=p.eloHistory.slice(-30);
    }
    await persistPlayer(p); setScreen("home");
  };
 
  const handleDailyComplete = async (results) => {
    // update streak & personal best
    const ps  = await loadPlayers();
    const p   = { ...(ps[player.username] || player) };
    const correct = results.filter(r => r.correct).length;
    const pct = Math.round(correct/results.length*100);
    const today = todayKey();
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate()-1);
    const yKey = yesterday.toISOString().slice(0,10);
    p.dailyStreak = (p.lastDaily===yKey||p.lastDaily===today) ? (p.dailyStreak||0)+(p.lastDaily===today?0:1) : 1;
    p.lastDaily   = today;
    if (!p.personalBests) p.personalBests={};
    const pb = p.personalBests["daily"];
    if (!pb || pct>pb.pct) p.personalBests["daily"]={ score:correct, total:results.length, pct, date:today };
    await persistPlayer(p);
  };
 
  return (
    <div style={S.app}>
      <div style={{ width:"100%", maxWidth:560 }}>
        {screen==="welcome"      && <WelcomeScreen    onLogin={handleLogin} />}
        {screen==="home"         && <HomeScreen       player={player} onStart={handleStart} onLeaderboard={() => { refresh(); setScreen("leaderboard"); }} onDaily={() => setScreen("daily")} onProfile={() => setScreen("profile")} />}
        {screen==="ranked-setup" && <RankedSetupScreen onStart={startRanked} onBack={() => setScreen("home")} />}
        {screen==="quick-setup"  && <QuickSetupScreen  onStart={startQuick}  onBack={() => setScreen("home")} />}
        {screen==="game"         && <GameScreen        questions={questions} mode={gameMode} onComplete={handleGameComplete} />}
        {screen==="results"      && <ResultsScreen     mode={gameMode} results={gameResults} tabSwitches={gameTabSwitches} player={player} onSaveAndHome={handleSaveAndHome} onReview={(r) => { setReviewResults(r); setScreen("review"); }} />}
        {screen==="review"       && <ReviewScreen      results={reviewResults} onBack={() => setScreen("results")} />}
        {screen==="leaderboard"  && <LeaderboardScreen players={players} onBack={() => setScreen("home")} />}
        {screen==="daily"        && <DailyScreen       player={player} onBack={() => setScreen("home")} onComplete={handleDailyComplete} />}
        {screen==="profile"      && <ProfileScreen     player={player} onBack={() => setScreen("home")} />}
      </div>
    </div>
  );
}