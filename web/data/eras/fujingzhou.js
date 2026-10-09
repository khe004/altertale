// 复荆州（通用模板时代，原著中没有这一段）：荆州失守而关羽未死，刘备欲夺回荆州。
// 地图、驿程、人物沿用荆州之战；开局由过渡推演按上一局的结局生成，这里只写驱动力、胜负与参考开局。
(function (AT) {
  AT.eras = AT.eras || {};
  const base = AT.eras.jingzhou;
  const ref = JSON.parse(JSON.stringify(base.starts.canon.state));
  Object.assign(ref, {
    date: "建安二十五年正月",
    places: { ...ref.places, "江陵": "孙", "公安": "孙", "麦城": "孙" },
    events: [{ date: "建安二十四年冬", who: "吕蒙", where: "江陵", what: "白衣渡江，取江陵、公安", why: "乘关羽北伐", result: "荆州失守，关羽退走", known: true }],
    choices: [], counsel: [], canon: {}, foreshadow: [], hidden: [], intel: []
  });
  AT.eras.fujingzhou = {
    // 沿用荆州之战的地图与人物
    ...Object.fromEntries(["places", "capital", "rivers", "mountains", "routes", "factions", "factionNames", "reportPlaces", "cast", "delegates", "gauges", "playerTitle", "player", "seat", "mapTitle"].map(k => [k, base[k]])),
    id: "fujingzhou",
    name: "复荆州",
    title: "异章·复荆州",
    template: true,
    ref: "原著中没有这一段（荆州失守而关羽未死）",
    tagline: "荆州失守，关羽却活着回来了。是夺回荆州，还是另图他策？",
    intro: "荆州已落入孙权之手，关羽败而未死。刘备要夺回荆州，东吴据江陵坚守，曹魏在北观望。",
    orderExample: "例：令关羽、张飞出秭归，水陆并进夺回公安；遣使许都，离间孙曹。",
    policyExample: "例：以夺回江陵为先，不得深入江东；与东吴可战可和，但江陵必须归还。",
    window: "建安二十五年至章武二年",
    maxTurns: 6,
    turnSpan: [20, 60],
    endBy: "章武二年",
    decisive: "如刘备夺回江陵；或议和划界、罢兵；或大败退回峡口；或刘备身死",
    rivals: "孙权与陆逊、吕蒙、朱然、潘璋，曹丕",
    baseline: "原著此时关羽已死，刘备为复仇伐吴，章武二年夷陵大败，次年托孤白帝；荆州终未夺回",
    lossLine: "刘备身死；或益州门户（白帝、秭归）失守；或大军覆没",
    setting: `这是原著中没有的一段：吕蒙白衣渡江取了江陵、公安，关羽却没有死在麦城，带残部退回了蜀中或上庸一带。东吴据有荆州，孙权一面向曹丕称臣以防魏，一面厚待关羽部下的家眷收买人心；关羽羞愤，誓夺荆州。
地理沿用荆州之战：自峡口顺江而下极快，逆流极慢；江陵是大城坚城，公安次之。东吴水军强，陆逊、朱然善守。曹丕在北观望，乐见孙刘相争，但若一方大胜，又会出手。
驱动力：刘备夺回荆州（复仇与地盘），孙权保住荆州全境（长江之险），曹魏坐收渔利。关羽活着，伐吴就不只是复仇，也有了能打水战、熟悉荆州的主将；张飞、黄忠是否健在，看上一局。`,
    canonEvents: [],
    handoff: { "孙刘": ["盟", "和", "破"] },
    next: [
      { era: "beifa", label: "两路北伐", gap: "夺回荆州之后", note: "荆州复归，孙刘未决裂，可依隆中对两路北伐", when: s => AT.jingzhouSafe(s) },
      { pending: true, label: "东西两线（尚未写成）", when: () => true }
    ],
    starts: {
      sample: {
        label: "荆州新失（参考）",
        blurb: "参考开局：荆州新失，关羽退回峡口。实际开局由上一局的结局推演生成。",
        setup: "【起点：荆州新失（参考）】\n关羽失江陵、公安，退守秭归；东吴据荆州。",
        tone: "",
        title: "",
        text: "",
        state: ref
      }
    }
  };
})(globalThis.AT = globalThis.AT || {});
