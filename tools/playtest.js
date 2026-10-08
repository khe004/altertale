#!/usr/bin/env node
// Simulation-only playtest: plays whole games without narration.
// Loads the same character pool, era config and engine as web/index.html; calls the local `claude` CLI.
//
//   node tools/playtest.js [--era jingzhou] [--starts canon,kongming] [--strategies prudent,delegate] [--runs 1] [--parallel 2]
//                          [--model sonnet] [--effort medium] [--player-model haiku] [--player-effort low]
//
// 回归测试：node tools/playtest.js --era ruchuan --starts canon --strategies canon --player-model sonnet
// Each game is written to playtest-out/<start>-<strategy>-<n>.json; a summary prints at the end.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "playtest-out");
const arg = (name, def) => {
  const i = process.argv.indexOf("--" + name);
  return i > 0 ? process.argv[i + 1] : def;
};

// 加载与网页相同的人物池、时代配置与引擎
globalThis.AT = {};
for (const f of ["data/characters.js", "data/background.js", "data/eras/ruchuan.js", "data/eras/jingzhou.js", "engine.js"]) require(path.join(ROOT, "web", f));
const E = AT.engine;
const ERA = arg("era", "jingzhou");

// Model, effort and token usage per role, filled from the CLI's JSON result.
const ROLES = {
  sim: { model: arg("model", "sonnet"), effort: arg("effort", "") },
  route: { model: arg("route-model", "haiku"), effort: arg("route-effort", "low") },
  repair: { model: arg("model", "sonnet"), effort: arg("effort", "") },
  transition: { model: arg("model", "sonnet"), effort: arg("effort", "") },
  player: { model: arg("player-model", "haiku"), effort: arg("player-effort", "") }
};
const SIM_TAG = ROLES.sim.model + (ROLES.sim.effort ? "-" + ROLES.sim.effort : "");
const usage = {};
function track(role, r) {
  const u = usage[role] || (usage[role] = {
    model: ROLES[role].model, effort: ROLES[role].effort || "（CLI 默认）", servedBy: [],
    calls: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, thinking: 0, seconds: 0, usd: 0
  });
  const t = r.usage || {};
  for (const [id, m] of Object.entries(r.modelUsage || {})) {
    if (!u.servedBy.includes(id)) u.servedBy.push(id);
    u.thinking += m.thinkingTokens || 0;
  }
  u.seconds += (r.duration_ms || 0) / 1000;
  u.calls++;
  u.input += t.input_tokens || 0;
  u.cacheWrite += t.cache_creation_input_tokens || 0;
  u.cacheRead += t.cache_read_input_tokens || 0;
  u.output += t.output_tokens || 0;
  u.usd += r.total_cost_usd || 0;
}

function claude(prompt, role) {
  const { model, effort } = ROLES[role];
  const args = ["-p", "--model", model, "--tools", "", "--output-format", "json"];
  if (effort) args.push("--effort", effort);
  return new Promise((resolve, reject) => {
    const p = spawn("claude", args, { cwd: OUT });
    let out = "", err = "";
    p.stdout.on("data", d => (out += d));
    p.stderr.on("data", d => (err += d));
    p.on("close", code => {
      if (code !== 0) return reject(new Error(err.trim() || "exit " + code));
      try {
        const r = JSON.parse(out);
        track(role, r);
        resolve(r.result || "");
      } catch (e) { reject(new Error("bad CLI output: " + out.slice(0, 200))); }
    });
    p.stdin.end(prompt);
  });
}

const STRATEGIES = {
  prudent: { policy: "", player: "你是一个认真、明智的玩家，目标是打得比原著更好、更快。根据局势判断最好的一步。" },
  // 脚本：前几回依次下 --script 给的命令（用 | 分隔），之后按 prudent 打
  script: { policy: "", player: null },
  delegate: { policy: "以保荆州根本为先。樊城可围则围，不可则退。江东若有异动，云长即刻回师；留守之将可先斩后奏，不必请示。", player: null },
  greedy: { policy: "", player: "你是一个贪功的玩家，一心乘胜北伐、扩大战果，认为东吴不足为虑，很少考虑后方。" },
  // 回归测试：有标 canon 的选项就选它；没有就照演义中玩家此时的实际作为下令（演义里此时没有动作就不另发令）
  canon: { policy: "", player: "你只按《三国演义》（毛宗岗本）行事：此刻演义中刘备实际做了什么，就下什么命令（可以不在选项里），哪怕不是最优。若演义中刘备此时没有另发命令，或他此时还不知道前方的变故，只输出 WAIT。" },
  single: { policy: "", player: "你是一个认真的普通玩家，目标是让结局与原著不同，但每回只能从给出的选项里选一个。" },
  random: { policy: "", player: null }
};

async function playerMove(strategy, g) {
  const st = g.chapters[g.chapters.length - 1].state;
  if (strategy === "delegate") return E.WAIT_ORDER;
  // 原著回归：有标 canon 的选项就选它，否则由模拟玩家照演义下令
  if (strategy === "canon") {
    if (E.waitIsCanon(g)) return E.WAIT_ORDER;
    const c = (st.choices || []).find(x => x.canon); if (c) return c.label;
  }
  if (strategy === "random") return st.choices[Math.floor(Math.random() * st.choices.length)].label;
  if (strategy === "script") {
    const script = arg("script", "").split("|").filter(Boolean), k = g.chapters.length - 1;
    if (k < script.length) return script[k];
    strategy = "prudent";
  }
  const single = strategy === "single";
  const events = (st.events || []).filter(e => e.known !== false).map(e => `${e.date} ${e.who}（${e.where}）${e.what}，${e.result}`);
  const ev = E.era(g);
  const prompt = `你在玩一个三国策略游戏，扮演${ev.player}（${ev.playerTitle}，此刻身在${E.seatOf(g)}；${ev.name}：${ev.tagline}）。
${STRATEGIES[strategy].player}

时间：${st.date}
刚刚得知的事：
${events.join("\n") || "（无）"}
刘备所知：${(st.intel || []).join("；")}
处境：${st.assessment || "（无）"}
谋士进言：
${(st.counsel || []).map(c => `${c.who}（${c.how}）：${c.says}`).join("\n") || "（无）"}
可选决断：
${st.choices.map((c, i) => `${i + 1}. ${c.label}（${c.detail}）`).join("\n")}

${single ? "只能从上面选一个，只输出它的序号。" : "可以选其中一个，也可以自己写一道具体的命令（谁去、做什么）。只输出最终的命令文本，一行，不要解释。"}`;
  const out = (await claude(prompt, "player")).trim();
  if (strategy === "canon" && /WAIT/.test(out)) return E.WAIT_ORDER;
  if (single) {
    const k = Number((out.match(/\d/) || ["1"])[0]) - 1;
    return (st.choices[k] || st.choices[0]).label;
  }
  return out.split("\n").filter(Boolean).pop().replace(/^\d+[.、]\s*/, "");
}

// 打一个时代；--continue 时，成局后过渡到下一时代接着打
async function playEra(g, strategy, tag, result, write) {
  while (!g.chapters[g.chapters.length - 1].state.ending && g.chapters.length < E.era(g).maxTurns + 1) {
    const decision = await playerMove(strategy, g);
    const raw = decision === E.WAIT_ORDER ? "" : await claude(E.buildRoutePrompt(g, decision), "route");
    const routes = raw ? E.parseRoutes(g, raw) : [];
    const onRail = !!E.railBeat(g);
    E.applyRail(g, decision, E.parseCanonVerdict(raw));
    if (onRail && !E.railBeat(g)) console.log(`[${tag}] 第${E.cn(g.chapters.length)}回的命令偏离原著，转入自由推演`);
    const orders = E.scheduleOrders(g, routes);
    let state = null;
    for (let attempt = 0; attempt < 2 && !state; attempt++) {
      try { state = E.parseSim(g, await claude(E.buildSimPrompt(g, decision, orders), "sim"), orders); }
      catch (e) { if (e instanceof Error && !(e instanceof SyntaxError)) throw e; result.parseFailures++; }
    }
    if (!state) throw new Error("simulation output unparseable twice");
    const problems = E.checkSim(g, state, decision);
    if (problems.length) {
      console.log(`[${tag}] 复核：${problems.join("；")}`);
      try {
        const s2 = E.parseSim(g, await claude(E.buildRepairPrompt(E.buildSimPrompt(g, decision, orders), problems), "repair"), orders);
        s2.repaired = problems;
        s2.unresolved = E.checkSim(g, s2, decision);
        state = s2;
      } catch (e) { if (e instanceof Error && !(e instanceof SyntaxError)) throw e; state.unresolved = problems; }
    }
    g.chapters[g.chapters.length - 1].decision = decision;
    g.chapters.push({ title: `第${E.cn(g.chapters.length + 1)}回`, text: "", state });
    write();
    const keys = E.era(g).reportPlaces.map(k => `${k}:${state.places[k]}`).join(" ");
    console.log(`[${tag}] ${E.era(g).name}第${E.cn(g.chapters.length)}回${E.railBeat(g) || (onRail && g.rail !== false) ? "（原著轨）" : ""} ${state.date} | ${keys} | 送达${state.delivered.length} 在途${state.orders.length} 删选项${state.dropped} 外文${state.latin} | ${state.chronicle}${state.ending ? ` | ${state.ending.type || "终章"}：${state.ending.title}` : ""}`);
  }
}

async function runGame(start, strategy, n) {
  const label = strategy + (arg("label") ? "-" + arg("label") : "");
  const tag = `${ERA}/${start}/${label}/${SIM_TAG}/${n}`;
  const file = path.join(OUT, `${ERA}-${start}-${label}-${SIM_TAG}-${n}.json`);
  // --resume：从同名存档接着打（被中断的测试）
  const old = process.argv.includes("--resume") && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).game : null;
  const g = old || E.newGame(ERA, start);
  if (!old) g.policy.text = STRATEGIES[strategy].policy;
  const result = { era: ERA, start, strategy, n, roles: ROLES, parseFailures: 0, error: null, game: g };
  const write = () => fs.writeFileSync(file, JSON.stringify(result, null, 1));
  try {
    await playEra(g, strategy, tag, result, write);
    if (process.argv.includes("--continue") && E.nextEra(g)) {
      const outcome = E.applyTransition(g, await claude(E.buildTransitionPrompt(g), "transition"));
      write();
      const s0 = g.chapters[0].state;
      console.log(`[${tag}] 过渡：${outcome === "next" ? `进入${E.era(g).name}「${E.startOf(g).label}」，${s0.date}` : "快进中出现败局"}`);
      if (outcome === "next") {
        for (const y of s0.years || []) console.log(`    ${y.when} ${y.what}`);
        console.log(`    起点：${E.startOf(g).setup.replace(/\n/g, " ")}`);
        await playEra(g, strategy, tag, result, write);
      }
    }
  } catch (e) {
    result.error = String(e.message || e);
    console.log(`[${tag}] ERROR ${result.error}`);
  }
  write();
  return result;
}

// 原著回归：照演义打下去，这些原著事件应当发生（已发生或变形发生）
const REGRESSION = { jingzhou: ["baiyi", "shiren", "mifang", "maicheng", "qinsha"], ruchuan: ["yanghuai", "pangtong", "kongming_in", "zhangren", "liuzhang"] };

function canonReport(r) {
  // 连玩时 game.past 里是先前的时代，逐个时代列出原著对照；回归只看起始时代
  const segs = [...(r.game.past || []), r.game];
  return segs.map((seg, k) => {
    const rows = E.canonSummary(seg);
    const lines = rows.map(x => `  ${x.status.padEnd(4, "　")} ${x.name}${x.chapter ? `（第${E.cn(x.chapter)}回）` : ""}${x.note ? "：" + x.note : ""}`);
    let verdict = "";
    if (r.strategy === "canon" && k === 0) {
      const want = REGRESSION[seg.era] || [];
      const miss = want.filter(id => !["已发生", "变形发生"].includes((rows.find(x => x.id === id) || {}).status));
      verdict = miss.length ? `  回归未通过，未发生：${miss.map(id => rows.find(x => x.id === id).name).join("、")}` : "  回归通过：原著主干事件都已发生";
    }
    return `  《${E.era(seg).name}》\n` + lines.join("\n") + (verdict ? "\n" + verdict : "");
  }).join("\n");
}

function summarize(r) {
  const last = r.game.chapters[r.game.chapters.length - 1].state;
  const keys = E.era(r.game).reportPlaces.map(k => `${k}:${last.places[k]}`).join(" ");
  return `${r.start}/${r.strategy}/${r.n}: ${E.era(r.game).name} ${r.game.chapters.length}回 ${last.date} ${keys} ` +
    (last.ending ? `终章「${last.ending.title}」${last.ending.summary}` : r.error ? `出错：${r.error}` : "未到终章");
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const jobs = [];
  for (const start of arg("starts", "canon,kongming").split(","))
    for (const strategy of arg("strategies", "prudent").split(","))
      for (let n = 1; n <= +arg("runs", "1"); n++) jobs.push(() => runGame(start, strategy, n));
  const results = [];
  const queue = jobs.slice();
  await Promise.all(Array.from({ length: +arg("parallel", "2") }, async () => {
    while (queue.length) results.push(await queue.shift()());
  }));
  console.log("\n== 汇总 ==\n" + results.map(summarize).join("\n"));
  for (const r of results) console.log(`\n== 原著对照：${r.start}/${r.strategy}/${r.n} ==\n${canonReport(r)}`);
  const turns = results.reduce((n, r) => n + [...(r.game.past || []), r.game].reduce((m, seg) => m + seg.chapters.length - 1, 0), 0);
  console.log(`\n== 用量（${results.length} 局，${turns} 回） ==`);
  for (const [role, u] of Object.entries(usage))
    console.log(`${role}（${u.servedBy.join(", ") || u.model}，effort ${u.effort}）: ${u.calls} 次调用，输入 ${u.input} + 缓存写 ${u.cacheWrite} + 缓存读 ${u.cacheRead}，输出 ${u.output}（其中思考 ${u.thinking}）tokens，耗时 ${Math.round(u.seconds)} 秒，约 $${u.usd.toFixed(2)}`);
  fs.writeFileSync(path.join(OUT, `usage-${SIM_TAG}.json`), JSON.stringify({ games: results.length, turns, usage }, null, 1));
})();
