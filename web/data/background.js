// 背景大事：主要由刘备之外的因素决定，多数分支里都会发生，各带前提，可以提前、推迟或失效。
// year/month 为公元年与农历月；when 是给推演看的原著时间。
(function (AT) {
  AT.background = [
    // ── 入川期 ──
    { id: "xunyu_dies", name: "荀彧之死", year: 212, month: 10, when: "建安十七年冬", ref: "第六十一回",
      pre: "荀彧反对曹操称公", result: "曹操朝中再无阻力" },
    { id: "ruxu", name: "濡须口之战", year: 213, month: 1, when: "建安十八年正月", ref: "第六十一回",
      pre: "曹操东征孙权", result: "孙曹在东线对峙，双方兵力被牵制，孙权一时无力西顾" },
    { id: "weigong", name: "曹操进位魏公", year: 213, month: 5, when: "建安十八年五月", ref: "第六十一回",
      pre: "曹操威权日盛，无人能阻", result: "曹操加九锡，一步步走向代汉" },
    { id: "machao_zhanglu", name: "马超失冀城，投奔张鲁", year: 213, month: 9, when: "建安十八年至十九年", ref: "第六十四回",
      pre: "马超渭南兵败后在陇上再起，又被杨阜等击败", result: "马超依附张鲁，成为'马超归降'的前提" },
    { id: "fuhou", name: "伏皇后被杀", year: 214, month: 11, when: "建安十九年冬", ref: "第六十六回",
      pre: "曹操专权，伏皇后密谋除曹事泄", result: "刘备讨曹的大义名分更足" },
    // ── 汉中期 ──
    { id: "weiwang", name: "曹操进位魏王", year: 216, month: 5, when: "建安二十一年五月", ref: "第六十八回",
      pre: "曹操威权日盛，无人能阻", result: "曹操称魏王，与日后刘备称汉中王相对" },
    { id: "lusu_dies", name: "鲁肃病卒，吕蒙代之", year: 217, month: 6, when: "建安二十二年", ref: "史书补充",
      pre: "自然病卒，可提前或推迟数月", result: "吕蒙代掌陆口，东吴对荆州由讨要转向偷袭" },
    // ── 荆州之后 ──
    { id: "caocao_dies", name: "曹操病逝", year: 220, month: 1, when: "建安二十五年正月", ref: "第七十八回",
      pre: "头风年老；可因局势（如大败、惊惧）提前，或因顺遂推迟一两月，但不会凭空消失", result: "曹丕继魏王位" },
    { id: "caopi_usurps", name: "曹丕代汉", year: 220, month: 10, when: "建安二十五年冬", ref: "第八十回",
      pre: "曹操已死，曹氏掌握朝廷", result: "汉帝被废，魏立" },
    { id: "liubei_emperor", name: "刘备称帝", year: 221, month: 4, when: "章武元年", ref: "第八十回",
      pre: "汉帝被废；刘备拥有足够的地盘与名分", result: "国号仍为汉" },
    { id: "sunquan_wuwang", name: "孙权受封吴王", year: 221, month: 8, when: "章武元年", ref: "第八十二回",
      pre: "孙权向魏称臣；孙刘交好时可能不会发生", result: "孙权名义上臣服于魏" },
    { id: "fazheng_dies", name: "法正病逝", year: 220, month: 6, when: "建安二十五年", ref: "史书补充",
      pre: "自然死亡", result: "刘备失一奇谋之士" }
  ];
})(globalThis.AT = globalThis.AT || {});
