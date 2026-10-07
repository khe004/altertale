// 背景大事：主要由刘备之外的因素决定，多数分支里都会发生，各带前提，可以提前、推迟或失效。
// year/month 为公元年与农历月；when 是给推演看的原著时间。
(function (AT) {
  AT.background = [
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
