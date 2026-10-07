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
  const startOf = g => era(g).starts[g.start];

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
    for (const x of c.titles) if (x[0] <= ad) t = x;
    return { title: t[1], address: t[2] };
  };
  const TIER_NAME = { 1: "第一档", 2: "第二档", 3: "第三档" };

  function cardText(name, ad) {
    const c = card(name);
    if (!c) return `- ${name}`;
    const t = titleAt(name, ad);
    const ab = c.abilities ? Object.entries(c.abilities).map(([k, v]) => k + v).join("、") : "";
    const parts = [
      `- ${name}〔${c.faction}〕${t.title}，称"${t.address}"。`,
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
    const core = [ev.player, ...ev.delegates, "孙权", "曹操"];
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

  // 只把尚未了结的原著事件交给推演核对；已发生、变形发生的只列名字，省提示词
  const isDone = x => x && (x.status === "已发生" || x.status === "变形发生");
  const openCanon = g => {
    const cs = g.chapters[g.chapters.length - 1].state.canon || {};
    return era(g).canonEvents.filter(c => !isDone(cs[c.id]));
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
    return `原著事件池（逐条核对前提：前提仍在，倾向于照原著或变形发生；前提不成立，就不得照搬，至多以弱化的形式发生）：
${done.length ? `已了结：${done.map(c => `${c.name}（${cs[c.id].status}）`).join("、")}。\n` : ""}待核对：
${open.map(c => `- [${c.id}] ${c.name}（${c.ref}）。前提：${c.pre}。原著结果：${c.result}。当前：${cs[c.id] ? cs[c.id].status + (cs[c.id].note ? "，" + cs[c.id].note : "") : "未到时"}`).join("\n") || "（无）"}`;
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
    const ev = era(g);
    return `你是《异章：${ev.name}》的世界推演者。这是以《三国演义》${ev.ref}为基线的反事实推演。${ev.player}（玩家）身在${ev.seat}，每回发出一道命令（也可以不发令）。你只负责推演事实，不写小说；另有说书人会把你定下的事写成文字。全部用中文书写，不得夹杂英文字母或任何外文。

推演原则：
0. 以《三国演义》（毛宗岗本）为准：人物性格、事件、地理、兵力与年代以演义为基线；演义没写到的，才用史书补充；两者冲突时以演义为准。人物按人物卡行事。
1. 千里之外，${ev.player}无法事事遥控。前方将帅按"方略与授权"自行处置：授权"便宜行事"者，依自己的性情、所知消息和方略当机立断（进退、调兵、守城、应对使者）；授权"遇事请示"者，遇大事先遣使请示，其间只能固守待命，可能贻误战机。自决的结果取决于此人的才能与性格。前方自行做出的重要决定写入 autonomous。
2. 行程以驿程表为准。命令的送达日期已由驿程表算定（见"军令驿程"），必须照此：送达之前，前方不会照它行事；送达之回要写出接令的情形。接令者也可能拖延、曲解或抗命。其他人马（包括敌军）的移动也按驿程表估算，不得快于表中所列。
3. 每个人物按自己的目标、性情和此刻所知行事，不迎合玩家，也不得违背立场底线。原著事件有"惯性"：其前提仍在，就倾向于照原著或变形发生；前提已被改变，就不得强行发生。每回在 canon 中逐条报告原著事件池与背景大事的状态。
4. 公正而不刁难（本局基调另有规定的，以基调为准）：及时、合理、切中要害的决断应当见效，得力将帅的自决也应常常有效；坏结果来自人物性格、信息滞后与对手谋略，而非无端厄运。胜负、伤亡、得失要与兵力、粮草、城防、地利、时机、人心相称。按演义的笔法，第一档名将临阵几乎无人能当；他们落败，要有中计、伏兵、泄密、断粮、军心离散或众寡悬殊这类明确的原因，并在事件里写出来。
5. 前后一致：先核对事件记录与当前局势再推演。人物不能瞬移；兵力不能凭空出现或重复调用；死者不能再出场；已失的城池和兵马不能再作筹码。粮草按日消耗，每回更新各部 grain；粮尽必有后果（逃散、哗变、被迫出战或撤退）。硬攻坚城旷日持久；城池易手须写明门是怎么开的。
6. 敌方主动：每回先替各方（${ev.rivals}）谋划（写入 plans），按其目标与所知行动，再写事件。得知援军将至，他们会设法抢在援军到达之前发动，或截击援军，而不是放弃；只有计谋暴露或代价明显过高时才延后或改图，并写明原因。双方情报都有延迟，也会误判；玩家一方可以用计诱其误判。
7. 本回时间推进约${ev.turnSpan[0]}日至${ev.turnSpan[1] === 30 ? "一月" : ev.turnSpan[1] + "日"}，写出其间四至八个关键事件，按时间先后。每个事件写清谁、在哪、做什么、为什么（依其所知的动机）、结果，以及${ev.player}在本回末是否已得知（known）。
8. 为说书人定下一至三条伏笔（foreshadow）：line 是可以写进正文的一个具体细节或反常之处，不点破；truth 是它暗示的真相。
9. 全局约在${cnBig(ev.maxTurns - 1)}至${cnBig(ev.maxTurns)}回内收束（时间约到${ev.endBy}），每回都要让局势有实质推进，不要原地相持；一旦出现决定性结局（${ev.decisive}），本回即为终章。

谋士进言与决断选项：
10. 先写 assessment，冷静判断${ev.player}此刻的处境：哪些城池、兵马、人物、筹码还在手里，对方此刻想要什么、凭什么会听。
11. 再写 counsel：${ev.player}身边的谋士各自进言，二至三条，各用其口吻，按人物卡的进言风格与才智。只有此刻身在${ev.seat}的人能当面进言（how 写"面陈"）；身在外地者只能以书信进言，how 写明发信的时间与地点，信件按驿程表在路上耽搁，所言只能依据他发信时所知。谋士之间可以意见相左。
12. choices 建立在处境判断与谋士进言之上：三个选项方向彼此不同，各有代价，尽量各对应一位谋士的主张（counsel 的 choice 写对应选项的序号，从1起），至少一项是明眼人在此局面下会认真考虑、确有成功希望的路（不必点明）。选项要具体：派谁、去哪、做什么、派信使、轻兵还是大军。只依据${ev.player}此刻所知。不得违背立场底线；对方已背盟得手时，外交选项要写清以何换何、为何对方可能接受。若演义中${ev.player}此时确有对应的做法，在该选项加 "canon": true。`;
  }

  function simFormat(g) {
    const ev = era(g);
    const placesEx = JSON.stringify(ev.starts.canon.state.places);
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
说明：plans 至少写每个对手势力一条。canon 逐条报告"待核对"的原著事件与背景大事，id 只能取：${ids.join("、") || "（无，写 []）"}。places 必须包含上面全部地名，值只能是"刘""孙""曹""争"（争=正在交战或归属未定）。forces 列玩家一方各部及其已知的敌军，兵力用约数，grain 写存粮可支多久。figures 列八至十二名关键人物，已死者 where 写"已故"。gauges 为0到100的整数：${Object.entries(ev.gauges).map(([k, v]) => `${k}=${v[1]}`).join("，")}。autonomous 没有则写 []。choices 正好三项。
若本回为终章：ending 写 {"title":"四到八字的结局名","summary":"一百字以内的结局","vs_canon":"与原著相比的关键分歧，一百字以内","turning_points":["全局中改变走向的两到四个关键决断或自决，各三十字以内"]}，counsel 与 choices 写 []。`;
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
每项写：part（这一项做什么，二十字以内）、from（命令或兵马从哪里出发，通常是${ev.seat}）、to（送达或抵达之地；传令给某人，就取此人此刻所在之地）、tier（只传令写"信使"；派数百至两三千精兵、轻骑、轻舟写"轻兵"；派上万人或带辎重的兵马写"大军"）。派兵的同时附带传令的，只写兵马一项。
人物此刻所在：${(st.figures || []).map(f => `${f.name}在${f.where}`).join("；")}
命令：${decision}
只输出一个 JSON 数组，例如 [{"part":"令关羽撤围回守江陵","from":"${ev.seat}","to":"樊城","tier":"信使"}]`;
  };

  E.parseRoutes = function (g, raw) {
    const ev = era(g), nodes = routeNodes(ev);
    const t = String(raw || "").replace(/```(json)?/g, "");
    const a = t.indexOf("["), b = t.lastIndexOf("]");
    if (a < 0 || b < a) return [];
    try {
      const node = x => nodes.find(n => String(x || "").includes(n)) || null;
      return JSON.parse(t.slice(a, b + 1)).filter(r => r && r.part).map(r => ({
        part: String(r.part), from: node(r.from) || ev.seat, to: node(r.to),
        tier: TIERS.find(x => String(r.tier || "").includes(x)) || "信使"
      }));
    } catch (e) { return []; }
  };

  // 新的军令表：沿用尚未送达的旧令，加上本回新令（发出日 = 当前回末）
  E.scheduleOrders = function (g, routes) {
    const ev = era(g), st = g.chapters[g.chapters.length - 1].state;
    const now = parseDate(st.date, yearOf(st.date));
    const fresh = routes.map(r => {
      const days = now == null || !r.to ? null : travelDays(ev, r.from, r.to, r.tier);
      return { ...r, sent: now, arrive: days == null ? null : now + days + (MUSTER[r.tier] || 0) };
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
    const last = n >= ev.maxTurns ? "\n本回必须为终章，给出 ending。" : n >= ev.maxTurns - 1 ? "\n局势已近收束，本回要把各条线推向决战或定局。" : "";
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
授权：${ev.delegates.map(d => `${d}：${g.policy.powers[d] || "便宜行事"}`).join("；")}（授权只在此人身处前方时有效；方略与授权的改动随本回信使送达后才生效）

【${ev.player}本回的命令】
${decision}

【军令驿程】（由驿程表算定，必须遵守；本回时间段内送达的，要写出接令情形）
${(orders || []).map(orderLine).join("\n") || "（无在途军令）"}

请推演第${cn(n)}回，本回时间推进约${ev.turnSpan[0]}日至${ev.turnSpan[1]}日${span}。${last}

${simFormat(g)}`;
  };

  const LATIN = E.LATIN = /[A-Za-z]/;
  // 收集所有字符串值里夹杂的外文词（不看 JSON 的键名）
  const latinWords = v => typeof v === "string" ? (v.match(/[A-Za-z]{2,}/g) || [])
    : Array.isArray(v) ? v.flatMap(latinWords) : v && typeof v === "object" ? Object.values(v).flatMap(latinWords) : [];
  // 刘备的立场底线：不联曹、不降。违背的选项直接去掉。
  const STANCE_BREACH = /联曹|降曹|附曹|投曹|归曹|结好曹|通好曹|与曹[操魏]?(?:议和|结盟|联手|修好|讲和)|称臣于[曹魏]|向[曹魏][^，。]{0,4}称臣|降吴|降魏/;

  E.parseSim = function (g, raw, orders) {
    const ev = era(g);
    const t = String(raw || "").replace(/```(json)?/g, "");
    const a = t.indexOf("{"), b = t.lastIndexOf("}");
    if (a < 0 || b < a) throw { code: "no_state" };
    const s = JSON.parse(t.slice(a, b + 1));
    const prev = g.chapters[g.chapters.length - 1].state;
    const places = { ...prev.places };
    for (const [k, v] of Object.entries(s.places || {})) if (k in ev.places && ["刘", "孙", "曹", "争"].includes(v)) places[k] = v;
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
    if (!s.events.length) throw { code: "no_state" };
    s.date = s.date || prev.date;
    s.canon = mergeCanon(prev.canon, s.canon, allCanonIds(g), g.chapters.length + 1);
    const all = Array.isArray(s.choices) ? s.choices.filter(c => c && c.label) : [];
    const ok = all.filter(c => !STANCE_BREACH.test(c.label + (c.detail || "")));
    s.choices = ok.slice(0, 3);
    s.dropped = all.length - ok.length;
    if (!s.ending && !s.choices.length) throw { code: "no_choices" };
    // 选项删去后，进言对应的序号按原序号重新映射
    s.counsel = s.counsel.map(c => ({ ...c, choice: s.choices.indexOf(all[(Number(c.choice) || 0) - 1]) + 1 }));
    // 在途军令由代码按驿程表结算，不用模型自报
    const now = parseDate(s.date, yearOf(prev.date));
    const list = orders || prev.orders || [];
    s.orders = list.filter(o => o.arrive != null && (now == null || o.arrive > now));
    s.delivered = list.filter(o => o.arrive != null && now != null && o.arrive <= now);
    s.in_transit = s.orders.map(o => ({ order: o.part, eta: `${fmtDate(o.arrive)}${o.tier === "信使" ? "送达" : "抵"}${o.to}（${o.tier}）` }));
    s.latin = latinWords(s).length;
    return s;
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
