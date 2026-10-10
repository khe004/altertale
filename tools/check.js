#!/usr/bin/env node
// 离线检查（不调模型，零成本）：改完代码先跑这个，再决定要不要花钱跑 playtest。
//
//   node tools/check.js            检查时代配置 + 重放 tools/fixtures 与 playtest-out 里的全部对局
//   node tools/check.js 存档.json  另外重放指定的存档（网页导出的也可以）
//
// 1. 时代配置：地名与驿程一致、人物卡齐全、原著节拍与事件池对得上、节拍数不超过回数上限。
// 2. 重放对局：每一回都重新生成推演、说书、驿程提示词（不应报错），重新解析当回的推演结果，
//    并用当前的复核规则检查（人物瞬移、坐镇离任、俘虏脱身），列出命中处，供人工判断是真问题还是误报。
// 3. 时代衔接：照原著打完的样本应当照原著快进，自由推演打完的样本应当走推演过渡。
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
globalThis.AT = {};
for (const f of ["data/characters.js", "data/background.js", "data/eras/ruchuan.js", "data/eras/hanzhong.js", "data/eras/jingzhou.js", "data/eras/fujingzhou.js", "data/eras/beifa.js", "data/eras/yiling.js", "data/eras/dongxi.js", "engine.js"]) require(path.join(ROOT, "web", f));
const E = AT.engine;

let errors = 0;
const fail = msg => { errors++; console.log("  ✗ " + msg); };

console.log("== 时代配置 ==");
for (const [id, ev] of Object.entries(AT.eras)) {
  const nodes = E.routeNodes(ev), ids = new Set(ev.canonEvents.map(c => c.id));
  for (const p of Object.keys(ev.places)) if (!nodes.includes(p)) fail(`${id}：地名 ${p} 不在驿程表里`);
  for (const n of nodes) if (!(n in ev.places)) fail(`${id}：驿程表的 ${n} 不在地图上`);
  for (const n of ev.cast) if (!AT.characters[n]) fail(`${id}：${n} 没有人物卡`);
  for (const b of ev.canonPath || []) for (const x of b.fulfills) if (!ids.has(x)) fail(`${id}：节拍里的事件 ${x} 不在事件池`);
  for (const c of ev.canonEvents) for (const x of c.after || []) if (!ids.has(x)) fail(`${id}：${c.id} 的前置 ${x} 不在事件池`);
  if (ev.canonPath && ev.canonPath.length > ev.maxTurns) fail(`${id}：节拍 ${ev.canonPath.length} 个，多于回数上限 ${ev.maxTurns}`);
  for (const b of !ev.next ? [] : Array.isArray(ev.next) ? ev.next : [ev.next]) if (!b.pending && !b.final && !AT.eras[b.era]) fail(`${id}：分支 ${b.label} 指向的时代 ${b.era} 不存在`);
  for (const [k, s] of Object.entries(ev.starts)) {
    for (const f of s.state.figures) if (f.where && !nodes.some(n => String(f.where).startsWith(n)) && /^[^\s]+$/.test(f.where) && !/已故/.test(f.where)) { /* 地图外的地点（如江陵、邺城）允许 */ }
    if (s.rails && ev.canonPath && !s.state.choices.some(c => c.canon && c.label === ev.canonPath[0].label) && !ev.canonPath[0].wait)
      fail(`${id}/${k}：开局的 ★ 选项与第一拍的原著做法不一致`);
  }
  console.log(`  ${id}：${Object.keys(ev.places).length} 地，${ev.canonEvents.length} 条原著事件，${(ev.canonPath || []).length} 拍`);
}

// 收集要重放的对局：样本、测试输出（含连打的前几个时代）、命令行指定的存档
const files = [
  ...fs.readdirSync(path.join(__dirname, "fixtures")).map(f => path.join(__dirname, "fixtures", f)),
  ...(fs.existsSync(path.join(ROOT, "playtest-out")) ? fs.readdirSync(path.join(ROOT, "playtest-out")).filter(f => /^(ruchuan|hanzhong|jingzhou).*\.json$/.test(f)).map(f => path.join(ROOT, "playtest-out", f)) : []),
  ...process.argv.slice(2)
].filter(f => f.endsWith(".json"));

console.log(`\n== 重放 ${files.length} 个对局 ==`);
let turns = 0, hits = 0;
for (const file of files) {
  let game;
  try { game = JSON.parse(fs.readFileSync(file, "utf8")).game; } catch (e) { fail(`${path.basename(file)}：读不出来`); continue; }
  if (!game || !game.chapters) continue;
  for (const seg of [...(game.past || []), game]) {
    if (!AT.eras[seg.era]) continue;
    for (let i = 1; i < seg.chapters.length; i++) {
      turns++;
      const h = { ...seg, rail: seg.rail !== false || (seg.railOff != null && i < seg.railOff), chapters: seg.chapters.slice(0, i) }, st = seg.chapters[i].state, dec = seg.chapters[i - 1].decision || E.WAIT_ORDER;
      try {
        E.buildSimPrompt(h, dec, []);
        E.buildRoutePrompt(h, dec);
        E.buildNarratePrompt({ ...seg, chapters: seg.chapters.slice(0, i + 1) }, i);
        if (st.choices && st.choices.length) E.parseSim(h, JSON.stringify(st), []);
      } catch (e) { fail(`${path.basename(file)} ${E.era(seg).name}第${E.cn(i + 1)}回：${e.message || JSON.stringify(e)}`); continue; }
      const p = E.checkSim(h, st, dec);
      if (p.length) { hits++; console.log(`  · ${path.basename(file)} ${E.era(seg).name}第${E.cn(i + 1)}回：${p.join("；")}`); }
    }
  }
}
console.log(`  共 ${turns} 回，复核命中 ${hits} 回（逐条看是真问题还是误报）`);

// 回目与结尾诗句字数（只看写成了文字的回）
for (const file of files) {
  let game; try { game = JSON.parse(fs.readFileSync(file, "utf8")).game; } catch (e) { continue; }
  if (!game || !game.chapters) continue;
  for (const seg of [...(game.past || []), game]) for (const c of seg.chapters || []) {
    if (!c.text) continue;
    const p = E.storyFormatProblems(c.title, c.text);
    if (p.length) console.log(`  · ${path.basename(file)} ${c.title}：${p.join("；")}`);
  }
}

// 承接开局：上一时代末的人物位置要延续，换了地方的要在其间大事里交代
for (const file of files) {
  let game; try { game = JSON.parse(fs.readFileSync(file, "utf8")).game; } catch (e) { continue; }
  if (!game || !game.past || !game.past.length) continue;
  const segs = [...game.past, game];
  for (let i = 1; i < segs.length; i++) {
    if (segs[i].start !== "inherited" || !AT.eras[segs[i - 1].era]) continue;
    const s0 = segs[i].chapters[0].state;
    const p = E.checkTransition(segs[i - 1], JSON.stringify({ setup: segs[i].inherited && segs[i].inherited.setup, years: s0.years, state: s0 }));
    if (p.length) console.log(`  · ${path.basename(file)} ${AT.eras[segs[i].era].name}承接开局：${p.join("；")}`);
  }
}

console.log("\n== 时代衔接 ==");
for (const f of fs.readdirSync(path.join(__dirname, "fixtures"))) {
  const g = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", f), "utf8")).game;
  const want = /canon-end/.test(f), got = !!E.canonTransition(g);
  if (!E.nextEra(g)) { const b = E.nextBranch(g); console.log(`  ${f}：${b ? (b.final ? `终局「${b.label}」` : `下一段「${b.label}」尚未写成`) : "没有下一时代"}`); continue; }
  if (want !== got) fail(`${f}：应当${want ? "照原著快进" : "走推演过渡"}，实际${got ? "照原著快进" : "走推演过渡"}`);
  else console.log(`  ${f}：${got ? "照原著快进" : "推演过渡"} → ${E.nextEra(g).label}`);
  if (got) {
    const c = JSON.parse(JSON.stringify(g));
    E.applyCanonTransition(c);
    if (!c.chapters[0].text || !E.railBeat(c)) fail(`${f}：快进后没有接上下一时代的原著开局`);
  } else {
    const p = E.buildTransitionPrompt(JSON.parse(JSON.stringify(g)));
    if (!p.includes(E.nextEra(g).era.name)) fail(`${f}：过渡提示词里没有下一时代`);
  }
}

console.log(errors ? `\n${errors} 处错误` : "\n全部通过");
process.exit(errors ? 1 : 0);
