// AlterTale 推演引擎：纯逻辑，不碰页面。网页和 tools/playtest.js 共用。
// 依赖 AT.characters（人物池）、AT.background（背景大事）、AT.eras（时代配置）。
(function (AT) {
  const E = AT.engine = {};

  /* ───────── 数字与日期 ───────── */

  const NUMS = "一二三四五六七八九十";
  const cn = E.cn = n => n <= 10 ? NUMS[n - 1] : n < 20 ? "十" + NUMS[n - 11] : String(n);
  const cnBig = n => n <= 10 ? NUMS[n - 1] : (n >= 20 ? NUMS[Math.floor(n / 10) - 1] : "") + "十" + (n % 10 ? NUMS[n % 10 - 1] : "");
  const CN_D = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
  function cnNum(s) {
    if (s === "正") return 1;
    if (s === "冬") return 11;
    if (s === "腊") return 12;
    if (!s.includes("十")) return CN_D[s] || 0;
    const [a, b] = s.split("十");
    return (a ? CN_D[a] : 1) * 10 + (b ? CN_D[b] : 0);
  }
  // 建安纪年，每月按三十日、每旬十日计；返回自建安二十四年正月初一起的日数
  const parseDate = E.parseDate = function (str, year) {
    const m = /(?:建安([一二三四五六七八九十]+)年)?\s*闰?([正冬腊一二三四五六七八九十]+)月\s*(上旬|中旬|下旬|初|中|末|底)?/.exec(str || "");
    if (!m) return null;
    const y = m[1] ? cnNum(m[1]) : year;
    const mo = cnNum(m[2]);
    if (!y || !mo) return null;
    const d = { "上旬": 5, "初": 5, "中旬": 15, "中": 15, "下旬": 25, "末": 28, "底": 28 }[m[3]] ?? 15;
    return (y - 24) * 360 + (mo - 1) * 30 + d;
  };
  const fmtDate = E.fmtDate = function (n) {
    const y = 24 + Math.floor(n / 360), r = n - (y - 24) * 360, mo = Math.floor(r / 30) + 1, d = r - (mo - 1) * 30;
    return `建安${cnBig(y)}年${mo === 1 ? "正" : cnBig(mo)}月${d <= 10 ? "上旬" : d <= 20 ? "中旬" : "下旬"}`;
  };
  const yearOf = E.yearOf = str => { const m = /建安([一二三四五六七八九十]+)年/.exec(str || ""); return m ? cnNum(m[1]) : 24; };
  const adOf = str => 195 + yearOf(str);

  /* ───────── 时代与开局 ───────── */

  E.WAIT_ORDER = "不另发令，由前方依方略与授权自行处置";
  E.POWERS = { "便宜行事": "可自行决定进退、调兵、守城与应对使者", "遇事请示": "大事须遣使回成都请示，其间固守待命" };
  const era = E.era = g => AT.eras[(g && g.era) || "jingzhou"];
  E.defaultPolicy = ev => ({ text: "", powers: Object.fromEntries((ev || AT.eras.jingzhou).delegates.map(d => [d, "便宜行事"])) });
  // 承接上一时代的开局没有预写，存在 g.inherited 里
  const startOf = E.startOf = g => g.start === "inherited" ? g.inherited : era(g).starts[g.start];
  const factionsOf = ev => ev.factions || { "刘": "--shu", "孙": "--wu", "曹": "--wei", "争": "--war" };
  // 玩家所在地随刘备移动：取人物表里刘备的所在，落在驿程节点上才算
  const seatOf = E.seatOf = g => {
    const ev = era(g), st = g.chapters[g.chapters.length - 1].state;
    const f = (st.figures || []).find(x => x.name === ev.player);
    return (f && routeNodes(ev).find(n => String(f.where).includes(n))) || ev.seat;
  };

  E.newGame = function (eraId, startId) {
    const ev = AT.eras[eraId], o = ev.starts[startId];
    return { era: eraId, start: startId, policy: E.defaultPolicy(ev), chapters: [{ title: o.title, text: o.text, state: JSON.parse(JSON.stringify(o.state)) }] };
  };

  /* ───────── 驿程 ───────── */

  const TIERS = E.TIERS = ["信使", "轻兵", "大军"];
  const MUSTER = { "大军": 10 };
  const routeNodes = E.routeNodes = ev => [...new Set(ev.routes.flatMap(r => [r[0], r[1]]))];

  const travelDays = E.travelDays = function (ev, from, to, tier) {
    const t = TIERS.indexOf(tier), nodes = routeNodes(ev);
    if (t < 0 || !nodes.includes(from) || !nodes.includes(to)) return null;
    const dist = { [from]: 0 }, done = new Set();
    for (;;) {
      let u = null;
      for (const n of nodes) if (!done.has(n) && dist[n] != null && (u == null || dist[n] < dist[u])) u = n;
      if (u == null) return null;
      if (u === to) return dist[u];
      done.add(u);
      for (const [a, b, f, r] of ev.routes) {
        const step = a === u ? [b, f[t]] : b === u ? [a, r[t]] : null;
        if (step && (dist[step[0]] == null || dist[u] + step[1] < dist[step[0]])) dist[step[0]] = dist[u] + step[1];
      }
    }
  };

  const travelText = ev => `驿程表（天数依次为 信使 / 轻兵精锐 / 大军；大军出发前另需集结约十日。信使只能传令；轻兵是数百至两三千人的精骑或轻舟，少带辎重，能战而难久战；大军上万、带粮草辎重）：
${ev.routes.map(([a, b, f, r, note]) => `- ${a}→${b}：${f.join(" / ")} 日；${b}→${a}：${r.join(" / ")} 日（${note}）`).join("\n")}
未列出的两地，按上表各段相加。`;

  /* ───────── 人物池 ───────── */

  const card = name => AT.characters[name];
  const titleAt = E.titleAt = function (name, ad) {
    const c = card(name);
    if (!c) return null;
    let t = c.titles[0];
    let faction = c.faction;
    for (const x of c.titles) if (x[0] <= ad) { t = x; if (x[3]) faction = x[3]; }
    return { title: t[1], address: t[2], faction };
  };
  const TIER_NAME = { 1: "第一档", 2: "第二档", 3: "第三档" };

  function cardText(name, ad) {
    const c = card(name);
    if (!c) return `- ${name}`;
    const t = titleAt(name, ad);
    const ab = c.abilities ? Object.entries(c.abilities).map(([k, v]) => k + v).join("、") : "";
    const parts = [
      `- ${name}〔${t.faction}〕${t.title}，称"${t.address}"。`,
      c.kin ? `${c.kin}。` : "",
      c.martial ? `武力${TIER_NAME[c.martial]}。` : "",
      ab ? `${ab}。` : "",
      c.personality ? `性格：${c.personality}。` : "",
      c.goals ? `所求：${c.goals}。` : "",
      c.floor ? `底线：${c.floor}。` : "",
      c.advice ? `进言风格：${c.advice}。` : "",
      (c.relations || []).length ? `关系：${c.relations.join("；")}。` : "",
      c.notes ? `附注：${c.notes}。` : "",
      c.death ? `原著死于${c.death.year}年${c.death.place || ""}（${c.death.cause}${c.death.note ? "：" + c.death.note : ""}）。` : ""
    ];
    return parts.join("");
  }

  // 与当前局势相关的人物：玩家、授权将领、各方之主，以及在局势、近两回事件、命令、方略、起点里出现过的人
  function relevantCast(g, extra) {
    const ev = era(g), st = g.chapters[g.chapters.length - 1].state;
    const text = [JSON.stringify({ f: st.figures, fo: st.forces, p: st.plans, c: st.counsel }),
      ...g.chapters.slice(-2).map(c => JSON.stringify(c.state.events || [])),
      g.policy ? g.policy.text : "", startOf(g).setup, extra || ""].join("");
    const core = [ev.player, ...ev.delegates, ...Object.values(ev.factionNames || {}), "孙权", "曹操"];
    return ev.cast.filter(n => core.includes(n) || text.includes(n));
  }

  const castText = (g, ad, extra) => {
    const ev = era(g), on = relevantCast(g, extra), off = ev.cast.filter(n => !on.includes(n));
    return `人物卡（${ad}年时的官爵与称谓；人物言行、才智与武艺一律按《三国演义》，不按史书；称谓必须合乎当年，不得用后来的封号、官职与谥号）：
${on.map(n => cardText(n, ad)).join("\n")}${off.length ? `\n其他可能登场的人物（按演义设定，用到时照其人物卡的身份行事）：${off.map(n => `${n}（${titleAt(n, ad).title}）`).join("、")}` : ""}`;
  };

  function titleTable(ev, ad, only) {
    return ev.cast.filter(card).filter(n => !only || only(n)).map(n => {
      const c = card(n), t = titleAt(n, ad);
      return `- ${n}：${t.title}，称"${t.address}"${c.kin ? "；" + c.kin : ""}`;
    }).join("\n");
  }

  function duelText(ev) {
    const tiers = [1, 2, 3].map(k => `${TIER_NAME[k]}：${ev.cast.filter(n => card(n) && card(n).martial === k).join("、")}`).join("。");
    return `武力分档与单挑（阵前斗将）：
- ${tiers}。谋士和文臣不单挑。
- 单挑胜负按武力分档：同档可战数十合到上百合不分胜负；高档对低档，数合到十数合内取胜或逼退。第一档名将不能在单挑中输给低档武将；带伤、力竭、中暗箭等例外须写明原因。
- 可以按演义笔法安排单挑，尤其是名将阵前相遇时，作为事件写入。单挑结果影响士气，但不单独决定战役胜负：带兵作战另按兵力、计谋、地利、粮草和军心计算。`;
  }

  const floorsText = ev => `各方立场底线（任何推演与选项都不得违背）：
${ev.cast.filter(n => card(n) && card(n).floor).map(n => `- ${n}：${card(n).floor}`).join("\n")}`;

  /* ───────── 原著事件池与背景大事 ───────── */

  const CANON_FINAL = ["已发生", "变形发生", "失效"];
  E.CANON_STATUS = ["已发生", "变形发生", "失效", "未到时"];

  // 只把尚未了结、且已临近的原著事件交给推演核对；已了结的（含失效）只列名字，省提示词，也不再把局势往回拉。
  // after：前置事件；前置尚未发生时，此事还远，只列名字，不要求核对
  const isDone = x => x && CANON_FINAL.includes(x.status);
  const happened = x => x && (x.status === "已发生" || x.status === "变形发生");
  const isNear = (c, cs) => (c.after || []).every(id => happened(cs[id]));
  const openCanon = g => {
    const cs = g.chapters[g.chapters.length - 1].state.canon || {};
    return era(g).canonEvents.filter(c => !isDone(cs[c.id]) && isNear(c, cs));
  };
  // 背景大事只取原著时间在开局之后、当前之后约四个月内、尚未了结的；开局以前的视为已经发生
  const bgDay = b => (b.year - 219) * 360 + (b.month - 1) * 30 + 15;
  const openBackground = g => {
    const st = g.chapters[g.chapters.length - 1].state, cs = st.canon || {};
    const now = parseDate(st.date, yearOf(st.date)) ?? 0;
    const o = g.chapters[0].state.date, from = parseDate(o, yearOf(o)) ?? 0;
    return (AT.background || []).filter(b => !isDone(cs[b.id]) && bgDay(b) >= from && bgDay(b) <= now + 120);
  };

  function canonText(g) {
    const ev = era(g), cs = g.chapters[g.chapters.length - 1].state.canon || {};
    const done = ev.canonEvents.filter(c => isDone(cs[c.id]));
    const open = openCanon(g);
    const far = ev.canonEvents.filter(c => !isDone(cs[c.id]) && !isNear(c, cs));
    return `原著事件池：这是${ev.player}照原著行事时的默认走向，不是必经之路。逐条核对前提：前提仍在，倾向于照原著或变形发生；前提不成立，就不得照搬，至多以弱化的形式发生。${ev.player}的选择绕开了某事（没有走那条路、那个人已不在那里、那座城已经不必打），此事就写"失效"，依赖它的后续也随之改写；不得为了让原著事件发生而设阻、拖延，把局势拉回原路。"若绕开"是此事不发生时的可能走向，供参考。
${done.length ? `已了结（不再核对）：${done.map(c => `${c.name}（${cs[c.id].status}）`).join("、")}。\n` : ""}待核对：
${open.map(c => `- [${c.id}] ${c.name}（${c.ref}）。前提：${c.pre}。原著结果：${c.result}。${c.bypass ? `若绕开：${c.bypass}。` : ""}当前：${cs[c.id] ? cs[c.id].status + (cs[c.id].note ? "，" + cs[c.id].note : "") : "未到时"}`).join("\n") || "（无）"}${far.length ? `\n尚远（前置之事未发生，本回不必核对）：${far.map(c => c.name).join("、")}` : ""}`;
  }

  function backgroundText(g) {
    const cs = g.chapters[g.chapters.length - 1].state.canon || {};
    const items = openBackground(g);
    if (!items.length) return "";
    return `背景大事（主要不由刘备决定，多数情况下会发生；各有前提，可以提前、推迟或失效）：
${items.map(b => `- [${b.id}] ${b.name}（原著${b.when}，${b.ref}）。前提：${b.pre}。结果：${b.result}。当前：${cs[b.id] ? cs[b.id].status : "未到时"}`).join("\n")}`;
  }

  // 本回要报告状态的条目
  const canonIds = g => [...openCanon(g).map(c => c.id), ...openBackground(g).map(b => b.id)];
  const allCanonIds = g => [...era(g).canonEvents.map(c => c.id), ...(AT.background || []).map(b => b.id)];

  function mergeCanon(prev, list, ids, chapter) {
    const out = JSON.parse(JSON.stringify(prev || {}));
    for (const x of Array.isArray(list) ? list : []) {
      if (!x || !ids.includes(x.id) || !E.CANON_STATUS.includes(x.status)) continue;
      const old = out[x.id];
      if (old && old.status === x.status) { if (x.note) old.note = x.note; continue; }
      out[x.id] = { status: x.status, note: String(x.note || ""), chapter };
    }
    return out;
  }

  // 战报用：每条原著事件与背景大事的最终状态
  E.canonSummary = function (g) {
    const ev = era(g), cs = g.chapters[g.chapters.length - 1].state.canon || {};
    const rows = [...ev.canonEvents.map(c => ({ ...c, kind: "原著" })), ...(AT.background || []).filter(b => cs[b.id]).map(b => ({ ...b, kind: "背景" }))];
    return rows.map(c => ({ id: c.id, name: c.name, ref: c.ref, kind: c.kind, ...(cs[c.id] || { status: "未到时", note: "" }) }));
  };

  /* ───────── 规则与格式 ───────── */

  function simRules(g) {
    const ev = era(g), seat = seatOf(g);
    return `你是《异章：${ev.name}》的世界推演者。这是以《三国演义》${ev.ref}为基线的反事实推演。${ev.player}（玩家）此刻身在${seat}，每回发出一道命令（也可以不发令）。你只负责推演事实，不写小说；另有说书人会把你定下的事写成文字。全部用中文书写，不得夹杂英文字母或任何外文。

推演原则：
0. 以《三国演义》（毛宗岗本）为准：人物性格、事件、地理、兵力与年代以演义为基线；演义没写到的，才用史书补充；两者冲突时以演义为准。人物按人物卡行事。
1. 千里之外，${ev.player}无法事事遥控。前方将帅按"方略与授权"自行处置：授权"便宜行事"者，依自己的性情、所知消息和方略当机立断（进退、调兵、守城、应对使者）；授权"遇事请示"者，遇大事先遣使请示，其间只能固守待命，可能贻误战机。自决的结果取决于此人的才能与性格。前方自行做出的重要决定写入 autonomous。"便宜行事"只限本人辖区之内；坐镇一方者（见"坐镇"）离开驻地、率兵出境、改变全局部署（例如孔明离荆州入川），必须奉${ev.player}之令，除非驻地已失或主公危在旦夕而音信不通，并要在 autonomous 里写明缘故。写信请命、请召而未获答复，视为未准，只能备兵待命。
2. 行程以驿程表为准。命令的送达日期已由驿程表算定（见"军令驿程"），必须照此：送达之前，前方不会照它行事；送达之回要写出接令的情形。接令者也可能拖延、曲解或抗命。其他人马（包括敌军）的移动也按驿程表估算，不得快于表中所列。
3. 每个人物按自己的目标、性情和此刻所知行事，不迎合玩家，也不得违背立场底线。原著事件有"惯性"：其前提仍在，就倾向于照原著或变形发生；前提已被改变，就不得强行发生；前提里含有"召""遣"等命令的，玩家没有下这道令，该事件就不会发生（可写成"未到时"或"失效"）。每回在 canon 中逐条报告原著事件池与背景大事的状态。
4. 公正而不刁难（本局基调另有规定的，以基调为准）：及时、合理、切中要害的决断应当见效，得力将帅的自决也应常常有效；坏结果来自人物性格、信息滞后与对手谋略，而非无端厄运。胜负、伤亡、得失要与兵力、粮草、城防、地利、时机、人心相称。按演义的笔法，第一档名将临阵几乎无人能当；他们落败，要有中计、伏兵、泄密、断粮、军心离散或众寡悬殊这类明确的原因，并在事件里写出来。
5. 前后一致：先核对事件记录与当前局势再推演。人物不能瞬移；兵力不能凭空出现或重复调用；死者不能再出场；已失的城池和兵马不能再作筹码。粮草按日消耗，每回更新各部 grain；粮尽必有后果（逃散、哗变、被迫出战或撤退）。硬攻坚城旷日持久；城池易手须写明门是怎么开的。
6. 敌方主动：每回先替各方（${ev.rivals}）谋划（写入 plans），按其目标与所知行动，再写事件。得知援军将至，他们会设法抢在援军到达之前发动，或截击援军，而不是放弃；只有计谋暴露或代价明显过高时才延后或改图，并写明原因。双方情报都有延迟，也会误判；玩家一方可以用计诱其误判。
7. 每回推演到下一个需要${ev.player}亲自决断的时刻为止：一场仗分出胜负、局面出现转折、有人来请命，或者久无变化。奇袭急进可能只有十来日，相持可以数月；限在${ev.turnSpan[0]}日至${ev.turnSpan[1]}日之间。局势只是照旧延续（围城、对垒、行军）而${ev.player}无事可决时，不要停下，继续推进到真正的转折。相持不得连续两回原样延续：按粮草、援兵、人心和对方的耐心推出变化，如城破、出降、解围、撤兵、议和或一方转攻他处。写出其间三至八个关键事件，按时间先后。每个事件写清谁、在哪、做什么、为什么（依其所知的动机）、结果，以及${ev.player}在本回末是否已得知（known）。
8. 为说书人定下一至三条伏笔（foreshadow）：line 是可以写进正文的一个具体细节或反常之处，不点破；truth 是它暗示的真相。
9. 回数不设目标，最多${cnBig(ev.maxTurns)}回。原著的时间表只是参照，不是进度：${ev.player}走得快，局势就快，不得为了凑回数或贴近原著时间而拖延、添设阻碍；也不要原地相持。一旦出现决定性结局（${ev.decisive}），本回即为终章，哪怕这才是第二回。原著的结局是：${ev.baseline || "（见原著）"}（约在${ev.endBy}）。败局线：${ev.lossLine || "比原著更差"}；一旦触及败局线，本回即为终章，ending.type 写"败局"；其余终章写"成局"。

谋士进言与决断选项：
10. 先写 assessment，冷静判断${ev.player}此刻的处境：哪些城池、兵马、人物、筹码还在手里，对方此刻想要什么、凭什么会听。
11. 再写 counsel：${ev.player}身边的谋士各自进言，二至三条，各用其口吻，按人物卡的进言风格与才智。只有此刻与${ev.player}同在${seat}的人能当面进言（how 写"面陈"）；身在外地者只能以书信进言，how 写明发信的时间与地点，信件按驿程表在路上耽搁，所言只能依据他发信时所知。谋士之间可以意见相左。
12. choices 建立在处境判断与谋士进言之上：三个选项方向彼此不同，各有代价，尽量各对应一位谋士的主张（counsel 的 choice 写对应选项的序号，从1起），至少一项是明眼人在此局面下会认真考虑、确有成功希望的路（不必点明）。谋士献的是险计、急计（如奇袭、直取）时，选项照原样保留它的锋芒，不得缩成稳妥的小动作；${ev.player}选了它，按兵力、时机、内应、人心与对方的准备如实判定成败，不预设失败。选项要具体：派谁、去哪、做什么、派信使、轻兵还是大军。只依据${ev.player}此刻所知。不得违背立场底线；对方已背盟得手时，外交选项要写清以何换何、为何对方可能接受。若演义中${ev.player}此时确有对应的做法，在该选项加 "canon": true。`;
  }

  function simFormat(g) {
    const ev = era(g);
    const placesEx = JSON.stringify(Object.values(ev.starts)[0].state.places);
    const fk = Object.keys(factionsOf(ev)).map(k => `"${k}"`).join("");
    const gaugesEx = JSON.stringify(Object.fromEntries(Object.keys(ev.gauges).map(k => [k, 50])));
    const ids = canonIds(g);
    return `只输出一个 JSON 对象，不要任何其他文字，不加代码块标记。字段如下：
{
  "date": "本回末的时间，如 建安二十四年九月下旬",
  "plans": [{"side":"某方","goal":"目标，二十字以内","plan":"当前谋划，四十字以内","status":"筹备|待发|已发动|改图|搁置","knows":"他们此刻掌握的玩家一方情报，可含误判，三十字以内"}],
  "events": [{"date":"九月中旬","who":"人物","where":"地点","what":"做了什么，四十字以内","why":"动机，三十字以内","result":"结果，三十字以内","known":true}],
  "canon": [{"id":"${ids[0] || "无"}","status":"已发生|变形发生|失效|未到时","note":"变形或失效的原因，三十字以内"}],
  "autonomous": [{"who":"人物","did":"未奉命令而自行做出的决定及结果，四十字以内"}],
  "places": ${placesEx},
  "forces": [{"name":"某部","where":"地点","troops":"约数","grain":"可支约二十日","note":"十二字以内"}],
  "figures": [{"name":"人物","where":"地点","note":"十二字以内的现状"}],
  "gauges": ${gaugesEx},
  "intel": ["${ev.player}此刻确知或听闻之事，三至六条"],
  "hidden": ["${ev.player}尚不知道的暗线，二至五条"],
  "foreshadow": [{"line":"伏笔细节，三十字以内","truth":"真相，四十字以内"}],
  "chronicle": "本回纪要，一句，三十字以内",
  "assessment": "${ev.player}此刻的处境与手中筹码，六十字以内",
  "counsel": [{"who":"谋士","how":"面陈","says":"进言内容，五十字以内","choice":1}],
  "choices": [{"label":"决断，二十字以内","detail":"考量与代价，四十字以内"}],
  "ending": null
}
说明：plans 至少写每个对手势力一条。canon 逐条报告"待核对"的原著事件与背景大事，id 只能取：${ids.join("、") || "（无，写 []）"}。places 必须包含上面全部地名，值只能是${fk}之一（${Object.entries(ev.factionNames || {}).map(([k, v]) => `${k}=${v}`).join("，") || "争=正在交战或归属未定"}；争=正在交战或归属未定）。forces 列玩家一方各部及其已知的敌军，兵力用约数，grain 写存粮可支多久。figures 列八至十二名关键人物，已死者 where 写"已故"。gauges 为0到100的整数：${Object.entries(ev.gauges).map(([k, v]) => `${k}=${v[1]}`).join("，")}。autonomous 没有则写 []。choices 正好三项。
若本回为终章：ending 写 {"type":"成局或败局","title":"四到八字的结局名","summary":"一百字以内的结局","vs_canon":"与原著相比的关键分歧，一百字以内","turning_points":["全局中改变走向的两到四个关键决断或自决，各三十字以内"]}，counsel 与 choices 写 []。`;
  }

  function narrateRules(g, ad, material) {
    const ev = era(g);
    return `你是《异章：${ev.name}》的说书人。推演者已经定下本回发生的事，你把它写成一回章回小说。

1. 文风仿毛宗岗本《三国演义》：半文半白，章回体，回目为对仗的两句。正文要有场面、人物对白与细节，节奏紧凑，约七百到一千字。可以在结尾用"正是：……"两句诗收束，或以"未知……且看下文分解"作结。回目中的人物用姓名、字、尊称或当时的职务（如"关云长""关公""吕子明""孔明""汉中王""吕都督"，职务须合乎当年），不得截取单字（如"云""蒙""亮"）。结尾诗句与回目不得重复前几回已用过的字句。全部用中文，不得夹杂英文字母或任何外文，不得出现现代词汇或"玩家""系统""选项"等字样。
2. 只写已定之事：不得增加改变局势的新事件，不得改动任何事件的结果、时间、地点和人物去向；可以补充场面、对白、心理与细节。
3. known 为 false 的事件，${ev.player}一方并不知道：可以"却说……"切去写一个侧影，但不点破其谋。
4. 把每条伏笔的 line 化作正文中一个具体可辨的细节，不点破 truth。
5. 结尾落到${ev.player}需要再作决断的时刻：把谋士进言写成朝堂上的一幕（远方来信则写拆书而读），但不替${ev.player}做决定。
6. 人物言行按演义设定。事件里有单挑的，按演义笔法写出兵器、回合与阵前气势。
7. 称谓与官爵必须合乎${ad}年当时，遵守下面的称谓表，不得用后来的封号、官职与谥号。

称谓表（本回涉及的人物）：
${titleTable(ev, ad, n => n === ev.player || (material || "").includes(n))}`;
  }

  /* ───────── 驿程：把命令拆成要送出的各项，由驿程表算定送达日期 ───────── */

  E.buildRoutePrompt = function (g, decision) {
    const ev = era(g), st = g.chapters[g.chapters.length - 1].state;
    return `把${ev.player}的这道命令拆成需要送出或派出的各项。全部用中文。
地点只能从这些里选：${routeNodes(ev).join("、")}。
每项写：part（这一项做什么，二十字以内）、from（命令或兵马从哪里出发，通常是${seatOf(g)}）、to（送达或抵达之地；传令给某人，就取此人此刻所在之地）、tier（只传令写"信使"；派数百至两三千精兵、轻骑、轻舟写"轻兵"；派上万人或带辎重的兵马写"大军"）。派兵的同时附带传令的，只写兵马一项。
人物此刻所在：${(st.figures || []).map(f => `${f.name}在${f.where}`).join("；")}
命令：${decision}
只输出一个 JSON 数组，例如 [{"part":"令某将移兵某地","from":"${seatOf(g)}","to":"${routeNodes(ev)[0]}","tier":"信使"}]`;
  };

  E.parseRoutes = function (g, raw) {
    const ev = era(g), nodes = routeNodes(ev);
    const t = String(raw || "").replace(/```(json)?/g, "");
    const a = t.indexOf("["), b = t.lastIndexOf("]");
    if (a < 0 || b < a) return [];
    try {
      const node = x => nodes.find(n => String(x || "").includes(n)) || null;
      return JSON.parse(t.slice(a, b + 1)).filter(r => r && r.part).map(r => ({
        part: String(r.part), from: node(r.from) || seatOf(g), to: node(r.to),
        tier: TIERS.find(x => String(r.tier || "").includes(x)) || "信使"
      }));
    } catch (e) { return []; }
  };

  // 新的军令表：沿用尚未送达的旧令，加上本回新令（发出日 = 当前回末）
  E.scheduleOrders = function (g, routes) {
    const ev = era(g), st = g.chapters[g.chapters.length - 1].state;
    const now = parseDate(st.date, yearOf(st.date));
    const seat = seatOf(g);
    const fresh = routes.map(r => {
      const days = now == null || !r.to ? null : travelDays(ev, r.from, r.to, r.tier);
      // 兵马不在玩家身边时，要先等命令由信使送到出发地
      const relay = r.tier !== "信使" && r.from !== seat ? travelDays(ev, seat, r.from, "信使") || 0 : 0;
      return { ...r, sent: now, arrive: days == null ? null : now + relay + days + (MUSTER[r.tier] || 0) };
    });
    return [...(st.orders || []), ...fresh];
  };

  const orderLine = E.orderLine = o => `「${o.part}」${o.tier}自${o.from}${o.to ? "往" + o.to : ""}，${o.sent != null ? fmtDate(o.sent) + "发出，" : ""}${o.arrive != null ? `约${fmtDate(o.arrive)}${o.tier === "信使" ? "送达" : "抵达"}` : "日程按常理估算"}`;

  /* ───────── 推演：只出事实 ───────── */

  const evLine = e => `[${e.date || ""}] ${e.who || ""}@${e.where || ""}：${e.what || ""}${e.result ? " → " + e.result : ""}${e.known === false ? "（玩家不知）" : ""}`;

  E.buildSimPrompt = function (g, decision, orders) {
    const ev = era(g), so = startOf(g);
    const n = g.chapters.length + 1;
    const cur = g.chapters[g.chapters.length - 1].state;
    const st = { ...cur };
    for (const k of ["events", "foreshadow", "autonomous", "chronicle", "assessment", "choices", "counsel", "orders", "in_transit", "latin", "dropped", "delivered", "canon"]) delete st[k];
    const log = g.chapters.map((c, i) => `第${cn(i + 1)}回（${c.state.date}）\n${(c.state.events || []).map(evLine).join("\n") || c.state.chronicle || ""}${c.decision ? `\n${ev.player}命令：${c.decision}` : ""}`).join("\n\n");
    const last = n >= ev.maxTurns ? "\n本回必须为终章，给出 ending。终章按此刻实际的兵力和已下达的命令收束，不得为了收束而调来未奉命的人马；没有打完的仗可以以相持、对峙或局势未定作结。" : "";
    const now = parseDate(cur.date, yearOf(cur.date));
    const span = now == null ? "" : `（即推演到约${fmtDate(now + ev.turnSpan[0])}至${fmtDate(now + ev.turnSpan[1])}）`;
    const ad = adOf(cur.date);
    return `${simRules(g)}

【时代背景】
${ev.setting}

【驿程】
${travelText(ev)}

【人物】
${castText(g, ad, decision)}

${duelText(ev)}

${floorsText(ev)}

【原著与背景】
${canonText(g)}

${backgroundText(g)}

【起点】
${so.setup}

${so.tone || ""}

【事件记录】
${log}

【当前局势】（plans 为各方上回的谋划）
${JSON.stringify(st)}

【方略与授权】
方略：${g.policy.text.trim() || "（未另立方略）"}
授权：${ev.delegates.map(d => `${d}：${g.policy.powers[d] || "便宜行事"}`).join("；")}（授权只在此人身处前方时有效；方略与授权的改动随本回信使送达后才生效）${Object.keys(postsOf(g)).length ? `\n坐镇：${Object.entries(postsOf(g)).map(([k, v]) => `${k}镇${v.join("、")}`).join("；")}（未奉${ev.player}之令不得离开）` : ""}

【${ev.player}本回的命令】
${decision}

【军令驿程】（由驿程表算定，必须遵守；本回时间段内送达的，要写出接令情形）
${(orders || []).map(orderLine).join("\n") || "（无在途军令）"}

请推演第${cn(n)}回，推演到下一个需要${ev.player}决断的时刻，在${ev.turnSpan[0]}日至${ev.turnSpan[1]}日之间${span}。${last}

${simFormat(g)}`;
  };

  const LATIN = E.LATIN = /[A-Za-z]/;
  // 收集所有字符串值里夹杂的外文词（不看 JSON 的键名）
  const latinWords = v => typeof v === "string" ? (v.match(/[A-Za-z]{2,}/g) || [])
    : Array.isArray(v) ? v.flatMap(latinWords) : v && typeof v === "object" ? Object.values(v).flatMap(latinWords) : [];
  // 刘备的立场底线：不联曹、不降。违背的选项直接去掉。
  const STANCE_BREACH = /联曹|降曹|附曹|投曹|归曹|结好曹|通好曹|与曹[操魏]?(?:议和|结盟|联手|修好|讲和)|称臣于[曹魏]|向[曹魏][^，。]{0,4}称臣|降吴|降魏/;

  // 把模型给出的局势补全、校验（地名、势力、数值、选项底线），prev 是上一回的局势
  function normalize(g, s, prev) {
    const ev = era(g), fk = Object.keys(factionsOf(ev));
    const places = { ...prev.places };
    for (const [k, v] of Object.entries(s.places || {})) if (k in ev.places && fk.includes(v)) places[k] = v;
    s.places = places;
    const gauges = { ...prev.gauges };
    for (const k of Object.keys(ev.gauges)) {
      const v = Number((s.gauges || {})[k]);
      if (Number.isFinite(v)) gauges[k] = Math.max(0, Math.min(100, Math.round(v)));
    }
    s.gauges = gauges;
    if (!Array.isArray(s.figures) || !s.figures.length) s.figures = prev.figures;
    if (!Array.isArray(s.forces) || !s.forces.length) s.forces = prev.forces || [];
    if (!Array.isArray(s.plans) || !s.plans.length) s.plans = prev.plans || [];
    for (const k of ["events", "intel", "hidden", "foreshadow", "autonomous", "counsel"]) s[k] = Array.isArray(s[k]) ? s[k] : [];
    s.date = s.date || prev.date;
    const all = Array.isArray(s.choices) ? s.choices.filter(c => c && c.label) : [];
    const ok = all.filter(c => !STANCE_BREACH.test(c.label + (c.detail || "")));
    s.choices = ok.slice(0, 3);
    s.dropped = all.length - ok.length;
    // 选项删去后，进言对应的序号按原序号重新映射
    s.counsel = s.counsel.map(c => ({ ...c, choice: s.choices.indexOf(all[(Number(c.choice) || 0) - 1]) + 1 }));
    if (s.ending && !s.ending.type) s.ending.type = "成局";
    return s;
  }

  const parseJSON = raw => {
    const t = String(raw || "").replace(/```(json)?/g, "");
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a < 0 || b < a) throw { code: "no_state" };
    return JSON.parse(t.slice(a, b + 1));
  };

  E.parseSim = function (g, raw, orders) {
    const prev = g.chapters[g.chapters.length - 1].state;
    const s = normalize(g, parseJSON(raw), prev);
    if (!s.events.length) throw { code: "no_state" };
    if (!s.ending && !s.choices.length) throw { code: "no_choices" };
    s.canon = mergeCanon(prev.canon, s.canon, allCanonIds(g), g.chapters.length + 1);
    // 在途军令由代码按驿程表结算，不用模型自报
    const now = parseDate(s.date, yearOf(prev.date));
    const list = orders || prev.orders || [];
    s.orders = list.filter(o => o.arrive != null && (now == null || o.arrive > now));
    s.delivered = list.filter(o => o.arrive != null && now != null && o.arrive <= now);
    s.in_transit = s.orders.map(o => ({ order: o.part, eta: `${fmtDate(o.arrive)}${o.tier === "信使" ? "送达" : "抵"}${o.to}（${o.tier}）` }));
    s.latin = latinWords(s).length;
    return s;
  };

  /* ───────── 推演复核：人物不能瞬移，坐镇者不能未奉命离任 ───────── */

  const GENERIC = new Set(["军师", "主公", "丞相", "大王", "陛下", "君侯", "皇叔"]);
  const aliases = name => { const c = card(name); return [name, ...(c ? c.titles.flatMap(t => String(t[2]).split("、")) : [])].filter(a => a && !GENERIC.has(a)); };
  // 坐镇者此刻仍在驻地，才受约束；奉命调走之后不再算
  const postsOf = g => {
    const all = startOf(g).posts || era(g).posts || {}, figs = g.chapters[g.chapters.length - 1].state.figures || [];
    return Object.fromEntries(Object.entries(all).filter(([k, v]) => { const f = figs.find(x => x.name === k); return f && v.some(n => String(f.where).startsWith(n)); }));
  };

  E.checkSim = function (g, s, decision) {
    const ev = era(g), prev = g.chapters[g.chapters.length - 1].state, problems = [];
    const nodes = routeNodes(ev), at = w => nodes.find(n => w && String(w).startsWith(n));
    const t0 = parseDate(prev.date, yearOf(prev.date)), t1 = parseDate(s.date, yearOf(prev.date));
    const days = t0 != null && t1 != null ? t1 - t0 : null;
    const before = Object.fromEntries((prev.figures || []).map(f => [f.name, at(f.where)]));
    const said = [g.policy && g.policy.text, ...g.chapters.map(c => c.decision), decision].filter(Boolean).join("\n");
    const posts = postsOf(g);
    for (const f of s.figures || []) {
      const a = before[f.name], b = at(f.where);
      if (!a || !b || a === b) continue;
      const need = travelDays(ev, a, b, "信使");
      if (days != null && need != null && need > days) problems.push(`${f.name}从${a}到${b}最快也要${need}日，本回只过了${days}日，到不了`);
      const post = posts[f.name];
      if (post && post.includes(a) && !post.includes(b) && !aliases(f.name).some(x => said.includes(x)))
        problems.push(`${f.name}坐镇${post.join("、")}，${ev.player}从未下令调他，他却离任到了${b}`);
    }
    return problems;
  };

  E.buildRepairPrompt = (prompt, problems) => `${prompt}

【复核】你上一稿推演有以下不合理之处：
${problems.map(p => "- " + p).join("\n")}
请改正后重新推演本回，按同样的格式输出完整 JSON。未奉命的人留在原地（可以写信、备兵待命）；赶不到的人还在路上；依赖他们的事件随之改写。`;

  /* ───────── 过渡：一个时代成局之后，快进到下一个时代的冲突爆发 ───────── */

  const DRIVERS = `驱动力（持续存在的几股力量；条件满足时爆发成冲突，可以比原著早或晚，可以变形、攻守互换，但不会因玩家打得好而凭空消失）：
- 刘备取益州：刘备欲跨有荆益。原著：建安十六至十九年入川取成都。
- 曹操争汉中：曹操欲保关中、威胁益州；汉中在张鲁或刘备手中且曹操东线无大战时发动。原著：建安二十年曹操取汉中，二十四年刘备夺之。若刘备先取汉中，曹操仍会来攻，攻守互换。
- 孙权取荆州全境：孙权欲据长江之险；荆州空虚、边界之争激化、东吴主力不被合肥牵制时发动。原著：建安二十年讨三郡、湘水划界；二十四年白衣渡江。鲁肃在世（至建安二十二年）偏向讨地议和，鲁肃死后吕蒙得势，偏向偷袭。
- 曹魏保襄樊：刘备军逼近襄樊时，曹仁坚守、曹操遣援。水淹七军须秋雨、汉水暴涨。
- 刘备北伐：益州、汉中稳定、荆州在手时，刘备欲兴复汉室。原著：建安二十四年关羽北伐襄樊；隆中对设想"荆州之军向宛洛，益州之众出秦川"。
- 刘备伐吴：关羽死、荆州失时，复仇之心驱使刘备伐吴（原著夷陵之战）。`;

  E.nextEra = function (g) {
    const ev = era(g), st = g.chapters[g.chapters.length - 1].state;
    if (!st.ending || st.ending.type === "败局" || !ev.next || !AT.eras[ev.next.era]) return null;
    return { id: ev.next.era, label: ev.next.label, gap: ev.next.gap, era: AT.eras[ev.next.era] };
  };

  E.buildTransitionPrompt = function (g) {
    const ev = era(g), nx = AT.eras[ev.next.era], ref = Object.values(nx.starts)[0];
    const tg = { era: nx.id, start: Object.keys(nx.starts)[0], chapters: [{ state: ref.state }], policy: E.defaultPolicy(nx) };
    const st = g.chapters[g.chapters.length - 1].state;
    const from = parseDate(st.date, yearOf(st.date)) ?? 0, to = parseDate(ref.state.date, yearOf(ref.state.date)) ?? from;
    const bg = (AT.background || []).filter(b => bgDay(b) > from && bgDay(b) <= to + 120);
    const names = new Set([...(st.figures || []).map(f => f.name), ...(ref.state.figures || []).map(f => f.name)]);
    const ad = adOf(ref.state.date);
    const cast = nx.cast.filter(n => names.has(n));
    const summary = E.canonSummary(g).map(r => `${r.name}：${r.status}${r.note ? "（" + r.note + "）" : ""}`).join("；");
    const log = g.chapters.map((c, i) => `第${cn(i + 1)}回（${c.state.date}）：${c.state.chronicle || ""}`).join("\n");
    return `你是《异章》的世界推演者，负责在两个时代之间快进。全部用中文书写，不得夹杂英文字母或任何外文。人物言行、才智与武艺一律按《三国演义》（毛宗岗本）与人物卡；演义没写到的，才用史书补充。

【上一时代：${ev.name}（${ev.ref}）】
原著结局：${ev.baseline}
本局纪要：
${log}
本局结局：${st.ending.title}。${st.ending.summary}
原著对照：${summary}
本局末的局势：${JSON.stringify({ date: st.date, places: st.places, figures: st.figures, forces: st.forces, gauges: st.gauges, plans: st.plans, hidden: st.hidden })}

【下一时代：${nx.name}（${nx.ref}）】
原著中这个时代的背景：
${nx.setting}
原著开局局势（仅供参照，本局要按上一时代的结局改写）：${JSON.stringify(ref.state)}
原著中这个时代的原著事件：${nx.canonEvents.map(c => `[${c.id}] ${c.name}（前提：${c.pre}）`).join("；")}

${DRIVERS}

【其间的背景大事】
${bg.map(b => `- [${b.id}] ${b.name}（原著${b.when}）。前提：${b.pre}。结果：${b.result}`).join("\n") || "（无）"}

【人物】
${cast.map(n => cardText(n, ad)).join("\n")}

快进规则：
1. 从上一时代末推演到下一时代的冲突爆发（原著空档：${ev.next.gap}）。其间各方按目标、人物卡与驱动力行动，背景大事依前提发生、提前、推迟或失效。尚未开放成可玩时代的冲突（如汉中之争），在快进中概述其经过与结果，合乎因果，不展开。
2. 比原著好的局面不会让冲突消失：驱动力会让下一时代的冲突提前、推迟、变形或攻守互换；开局时间可以与原著不同。上一时代留下的人物与恩怨（谁活着、谁在哪、谁欠谁）必须延续。
3. 若快进中出现比原著更差的结局（如益州得而复失、刘备身死），写 ending（type 为"败局"），不进入下一时代。
4. 写出下一时代开局的完整局势，并给刘备第一回的处境判断、谋士进言与三个选项（规则同平日推演：选项具体、方向不同、至少一项确有希望、不违背立场底线；若演义中刘备此时确有对应的做法，在该选项加 "canon": true）。canon 字段报告下一时代原著事件池中已在快进期间发生、变形或失效的条目。

只输出一个 JSON 对象，不要任何其他文字，不加代码块标记：
{
  "label": "四到八字的起点名",
  "setup": "本局开局与原著开局的不同之处及其由来，二百字以内",
  "years": [{"when": "建安某年某月", "what": "其间大事，四十字以内"}],
  "ending": null,
  "state": 下一时代开局的局势，格式如下
}
years 写六至十二条，按时间先后。state 的格式：
${simFormat(tg)}`;
  };

  // 应用过渡：成功则把当前时代收进 g.past，换成下一时代的开局；返回 "next" 或 "lost"
  E.applyTransition = function (g, raw) {
    const ev = era(g), nx = AT.eras[ev.next.era], ref = Object.values(nx.starts)[0];
    const o = parseJSON(raw);
    const years = (Array.isArray(o.years) ? o.years : []).filter(y => y && y.what);
    const yEvents = years.map(y => ({ date: String(y.when || ""), who: "", where: "", what: String(y.what), result: "", known: true }));
    const last = g.chapters[g.chapters.length - 1];
    if (o.ending) {
      g.chapters.push({ title: `第${cn(g.chapters.length + 1)}回`, text: "", state: { ...last.state, events: yEvents, ending: { ...o.ending, type: "败局" }, choices: [], counsel: [] } });
      return "lost";
    }
    const tg = { era: nx.id, start: "inherited", chapters: [{ state: ref.state }], policy: E.defaultPolicy(nx) };
    const s = normalize(tg, o.state || {}, JSON.parse(JSON.stringify(ref.state)));
    if (!s.choices.length) throw { code: "no_choices" };
    s.events = s.events.length ? s.events : yEvents;
    s.years = years;
    s.canon = mergeCanon({}, s.canon, allCanonIds(tg), 1);
    s.orders = []; s.delivered = []; s.in_transit = [];
    (g.past = g.past || []).push({ era: g.era, start: g.start, inherited: g.inherited, chapters: g.chapters, policy: g.policy });
    g.era = nx.id;
    g.start = "inherited";
    g.inherited = { label: o.label || "承接上局", blurb: "", setup: `【起点：承接《${ev.name}》】\n${o.setup || ""}`, tone: "" };
    g.policy = E.defaultPolicy(nx);
    g.chapters = [{ title: "第一回", text: "", state: s }];
    return "next";
  };

  /* ───────── 说书：把已定之事写成文字 ───────── */

  E.buildNarratePrompt = function (g, i) {
    const ev = era(g), so = startOf(g);
    const s = g.chapters[i].state, prev = g.chapters[i - 1];
    const tail = prev && prev.text ? prev.text.split(/\n+/).filter(Boolean).slice(-2).join("\n") : "";
    const material = JSON.stringify([s.events, s.autonomous, s.counsel, s.foreshadow, s.delivered]) + ((prev && prev.text) || "").slice(-300);
    return `${narrateRules(g, adOf(s.date), material)}

${so.tone || ""}

【前几回已用过的回目与结尾诗句】（不得重复，也不要化用相同字句）
${g.chapters.slice(0, i).filter(c => c.text).map(c => `${c.title}${(c.text.split(/\n+/).filter(Boolean).filter(x => /^正是/.test(x.trim())).pop() || "") ? "　" + c.text.split(/\n+/).filter(Boolean).filter(x => /^正是/.test(x.trim())).pop().trim() : ""}`).join("\n") || "（无）"}

【上一回结尾】
${tail || "（无）"}

【${ev.player}上一回的命令】
${(prev && prev.decision) || "（无）"}

【本回时间】${s.date}

【本回已定之事】（按时间先后）
${JSON.stringify(s.events)}

【前方自决】
${JSON.stringify(s.autonomous)}

【本回送达的军令】
${(s.delivered || []).map(orderLine).join("\n") || "（无）"}

【必须埋下的伏笔】
${JSON.stringify(s.foreshadow)}

【本回结尾${ev.player}面对的局面】
${s.assessment || s.chronicle || ""}${s.ending ? `\n本回为终章，结局：${s.ending.title}。${s.ending.summary}` : ""}

【谋士进言】（写成结尾朝堂上的一幕或拆读来信）
${(s.counsel || []).map(c => `${c.who}（${c.how}）：${c.says}`).join("\n") || "（无）"}

请写第${cn(i + 1)}回。第一行写回目，形如"第${cn(i + 1)}回　七字或八字上句　七字或八字下句"，空一行后写正文，段落之间空一行。只输出回目和正文。`;
  };

  E.splitStory = function (raw) {
    const lines = String(raw).trim().split("\n");
    const title = (lines.shift() || "").replace(/^#+\s*/, "").trim();
    return { title, text: lines.join("\n").trim() };
  };

  // 夹杂外文的段落交给快速档改写成中文，其余原样保留
  E.buildLatinFixPrompt = paras => `下面几段章回小说的文字里夹杂了英文单词。把英文改成合乎上下文的中文（半文半白），其余一字不改。逐段输出，段与段之间单独一行写 =====，不要任何其他文字。

${paras.join("\n=====\n")}`;
})(globalThis.AT = globalThis.AT || {});
