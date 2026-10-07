#!/usr/bin/env node
// Simulation-only playtest: plays whole games without narration.
// Reuses the prompt/parse code from web/index.html; calls the local `claude` CLI.
//
//   node tools/playtest.js [--starts canon,kongming] [--strategies prudent,delegate] [--runs 1] [--parallel 2]
//                          [--model sonnet] [--effort medium] [--player-model haiku] [--player-effort low]
//
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

const html = fs.readFileSync(path.join(ROOT, "web/index.html"), "utf8");
const script = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
const core = script.slice(0, script.indexOf("function errorCopy"));
const G = new Function(`${core}
return { OPENINGS, WAIT_ORDER, MAX_TURNS, defaultPolicy, buildSimPrompt, parseSim, cn };`)();

// Model, effort and token usage per role, filled from the CLI's JSON result.
const ROLES = {
  sim: { model: arg("model", "sonnet"), effort: arg("effort", "") },
  player: { model: arg("player-model", "haiku"), effort: arg("player-effort", "") }
};
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
  prudent: { policy: "", player: "你是一个认真、明智的玩家，目标是让结局与原著（荆州失守、关羽败走麦城）不同。根据局势判断最好的一步。" },
  delegate: { policy: "以保荆州根本为先。樊城可围则围，不可则退。江东若有异动，云长即刻回师；留守之将可先斩后奏，不必请示。", player: null },
  greedy: { policy: "", player: "你是一个贪功的玩家，一心乘胜北伐、扩大战果，认为东吴不足为虑，很少考虑后方。" },
  random: { policy: "", player: null }
};

async function playerMove(strategy, g) {
  const st = g.chapters[g.chapters.length - 1].state;
  if (strategy === "delegate") return G.WAIT_ORDER;
  if (strategy === "random") return st.choices[Math.floor(Math.random() * st.choices.length)].label;
  const events = (st.events || []).filter(e => e.known !== false).map(e => `${e.date} ${e.who}（${e.where}）${e.what}，${e.result}`);
  const prompt = `你在玩一个三国策略游戏，扮演汉中王刘备（身在成都，命令要二十多天才能送到荆州）。
${STRATEGIES[strategy].player}

时间：${st.date}
刚刚得知的事：
${events.join("\n") || "（无）"}
刘备所知：${(st.intel || []).join("；")}
处境：${st.assessment || "（无）"}
可选决断：
${st.choices.map((c, i) => `${i + 1}. ${c.label}（${c.detail}）`).join("\n")}

可以选其中一个，也可以自己写一道具体的命令（谁去、做什么）。只输出最终的命令文本，一行，不要解释。`;
  return (await claude(prompt, "player")).trim().split("\n").filter(Boolean).pop().replace(/^\d+[.、]\s*/, "");
}

async function runGame(start, strategy, n) {
  const tag = `${start}/${strategy}/${ROLES.sim.model}/${n}`;
  const file = path.join(OUT, `${start}-${strategy}-${ROLES.sim.model}-${n}.json`);
  const o = G.OPENINGS[start];
  const g = { start, policy: G.defaultPolicy(), chapters: [{ title: o.title, text: o.text, state: JSON.parse(JSON.stringify(o.state)) }] };
  g.policy.text = STRATEGIES[strategy].policy;
  const result = { start, strategy, n, roles: ROLES, parseFailures: 0, error: null, game: g };
  const write = () => fs.writeFileSync(file, JSON.stringify(result, null, 1));
  try {
    while (!g.chapters[g.chapters.length - 1].state.ending && g.chapters.length < G.MAX_TURNS + 1) {
      const decision = await playerMove(strategy, g);
      let state = null;
      for (let attempt = 0; attempt < 2 && !state; attempt++) {
        try { state = G.parseSim(g, await claude(G.buildSimPrompt(g, decision), "sim")); }
        catch (e) { if (e instanceof Error && !(e instanceof SyntaxError)) throw e; result.parseFailures++; }
      }
      if (!state) throw new Error("simulation output unparseable twice");
      g.chapters[g.chapters.length - 1].decision = decision;
      g.chapters.push({ title: `第${G.cn(g.chapters.length + 1)}回`, text: "", state });
      write();
      console.log(`[${tag}] 第${G.cn(g.chapters.length)}回 ${state.date} | 江陵:${state.places["江陵"]} 公安:${state.places["公安"]} | ${state.chronicle}${state.ending ? " | 终章：" + state.ending.title : ""}`);
    }
  } catch (e) {
    result.error = String(e.message || e);
    console.log(`[${tag}] ERROR ${result.error}`);
  }
  write();
  return result;
}

function summarize(r) {
  const last = r.game.chapters[r.game.chapters.length - 1].state;
  const guan = (last.figures || []).find(f => f.name === "关羽");
  return `${r.start}/${r.strategy}/${r.n}: ${r.game.chapters.length}回 ${last.date} 江陵:${last.places["江陵"]} 公安:${last.places["公安"]} 关羽:${guan ? guan.where : "?"} ` +
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
  const turns = results.reduce((n, r) => n + r.game.chapters.length - 1, 0);
  console.log(`\n== 用量（${results.length} 局，${turns} 回） ==`);
  for (const [role, u] of Object.entries(usage))
    console.log(`${role}（${u.servedBy.join(", ") || u.model}，effort ${u.effort}）: ${u.calls} 次调用，输入 ${u.input} + 缓存写 ${u.cacheWrite} + 缓存读 ${u.cacheRead}，输出 ${u.output}（其中思考 ${u.thinking}）tokens，耗时 ${Math.round(u.seconds)} 秒，约 $${u.usd.toFixed(2)}`);
  fs.writeFileSync(path.join(OUT, `usage-${ROLES.sim.model}.json`), JSON.stringify({ games: results.length, turns, usage }, null, 1));
})();
