// 孔明线共用的分支规则：寿数是总时钟，各章的结局决定下一章打什么。
// - 孔明在哪一章病逝（寿数耗尽），那一章的终局就是星落，按地盘分档收尾（三分之局）。
// - 陇右在手（天水、南安、陇西至少两郡）而寿数尚足：转入"关中之战"，可以一轮一轮打下去；陇右丢了：走原著的再出祁山、五丈原。
// - 寿数将尽（三十以下）：转入五丈原收尾。
(function (AT) {
  const p = s => s.places || {};
  const longyou = s => ["天水", "南安", "陇西"].filter(k => p(s)[k] === "刘").length;
  const life = s => Number((s.gauges || {})["寿数"]);
  const kongmingGone = s => (s.figures || []).some(f => f.name === "诸葛亮" && /已故|死|殁/.test(String(f.where || "") + String(f.note || "").slice(0, 4))) || life(s) <= 0;
  AT.km = {
    longyou, life, kongmingGone,
    lifeLeft: s => !Number.isFinite(life(s)) || life(s) > 30,
    // 三分之局按地盘分档：陇右、关中西部在手的，是蜀汉据有雍凉的三分；全失的，是原著式的困守一隅
    finals: [
      { final: true, label: "三分之局（据有雍凉）", text: "孔明身后，蜀汉据有陇右诸郡，又在渭滨、陈仓一线站住了脚，屯田养马，羌胡归附，与魏隔着陇山、渭水对峙。蒋琬、费祎守成，姜维继其志，魏人再不敢以益州为偏隅。这是蜀汉能打出的最好的三分之局。蜀汉线到此完结。",
        when: s => longyou(s) === 3 && ["陈仓", "北原", "五丈原", "郿"].some(k => p(s)[k] === "刘") },
      { final: true, label: "三分之局（据有陇右）", text: "孔明身后，陇右诸郡仍在蜀汉手里，屯田积谷，羌胡归附，汉中以北多了一道屏障；只是关中终未能入，魏仍据长安。蒋琬、费祎守成，姜维以陇右为本，日后北伐不必再走千里栈道。三分之局已定，蜀汉比原著多了一份根基。蜀汉线到此完结。",
        when: s => longyou(s) >= 2 },
      { final: true, label: "三分之局", text: "孔明身后，蜀汉再无人能举全国之力北伐，困守益州一隅，三分之局已定。蜀汉线到此完结。", when: () => true }
    ]
  };
  // 孔明病逝时的终局分支（排在各章 next 的最前，取长安的胜局之后）
  AT.km.deathFinals = AT.km.finals.map(b => ({ ...b, when: s => kongmingGone(s) && b.when(s) }));
})(globalThis.AT = globalThis.AT || {});
