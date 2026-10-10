// 东西两线（半模板时代，原著中没有这一段）：刘备守住江陵，却与孙权交恶，东拒东吴、北防曹魏。
// 沿用荆州之战的地图、驿程与人物，加长沙、武昌两地；没有原著节拍，开局由过渡按上一局的结局推演生成。
// 入口：荆州之战江陵在而公安失或孙刘决裂；复荆州未全复或决裂；夷陵复夺江陵而孙刘仍战。
(function (AT) {
  const base = AT.eras.jingzhou;
  const figureGone = (s, name) => {
    const f = (s.figures || []).find(x => x.name === name);
    return !!f && /已故|遇害|身亡|战死|被杀|殉|驾崩/.test(`${f.where}${f.note || ""}`);
  };
  const liubeiGone = s => ((s.ending && s.ending.handoff) || {})["刘备"] === "驾崩" || figureGone(s, "刘备");
  const lostJiangling = s => (s.places || {})["江陵"] !== "刘";
  const fromFujingzhou = g => (g.past || []).some(p => p.era === "fujingzhou");

  const places = { ...base.places, "长沙": [300, 234], "武昌": [346, 196] };
  const ref = JSON.parse(JSON.stringify(base.starts.canon.state));
  Object.assign(ref, {
    date: "建安二十五年三月",
    places: { ...ref.places, "樊城": "曹", "襄阳": "曹", "麦城": "刘", "江陵": "刘", "公安": "孙", "陆口": "孙", "长沙": "孙", "武昌": "孙", "建业": "孙" },
    figures: [
      { name: "刘备", where: "成都", note: "汉中王" },
      { name: "诸葛亮", where: "成都", note: "军师将军" },
      { name: "关羽", where: "江陵", note: "坚守江陵，恨吴背盟" },
      { name: "关平", where: "江陵", note: "随父守城" },
      { name: "赵云", where: "江陵", note: "协守江陵" },
      { name: "糜芳", where: "江陵", note: "惶恐待罪" },
      { name: "曹丕", where: "洛阳", note: "新嗣魏王" },
      { name: "曹仁", where: "樊城", note: "屯兵观望" },
      { name: "孙权", where: "武昌", note: "西移武昌，督战荆州" },
      { name: "吕蒙", where: "公安", note: "病重" },
      { name: "陆逊", where: "公安", note: "代吕蒙督军" }
    ],
    gauges: { "东线": 40, "北线": 55, "孙刘": 10 },
    forces: [
      { name: "江陵守军", where: "江陵", troops: "约二万", grain: "可支约三月", note: "关羽、赵云", known: true },
      { name: "益州援军", where: "秭归", troops: "约一万", grain: "需逆江转运", note: "可东出", known: true },
      { name: "上庸军", where: "上庸", troops: "约五千", grain: "仅够自守", note: "刘封、孟达", known: true },
      { name: "公安吴军", where: "公安", troops: "约二万", grain: "足", note: "陆逊、潘璋", known: true },
      { name: "吴国水军", where: "陆口", troops: "约一万", grain: "足", note: "控扼江面", known: true },
      { name: "樊城魏军", where: "樊城", troops: "约二万", grain: "足", note: "曹仁、徐晃", known: true }
    ],
    events: [
      { date: "建安二十四年冬", who: "吕蒙", where: "公安", what: "白衣渡江，士仁献公安", why: "孙权欲取荆州", result: "公安入吴，江陵告急", known: true },
      { date: "建安二十五年正月", who: "关羽", where: "江陵", what: "回军死守江陵，吴军屡攻不下", why: "根本之地", result: "江陵尚在，孙刘交恶", known: true },
      { date: "建安二十五年正月", who: "曹操", where: "洛阳", what: "头风病逝", why: "年老病重", result: "曹丕嗣魏王位", known: true }
    ],
    intel: ["公安已失，江陵被吴军三面窥伺", "吴水军控扼江面，粮船往来艰难", "曹仁屯樊城观望，未敢南下", "曹操新丧，曹丕嗣位"],
    hidden: ["孙权已遣使往洛阳，欲向魏称臣以免两面受敌", "陆逊料江陵难以力取，欲断其江上粮道，困而图之"],
    foreshadow: [],
    plans: [
      { side: "孙权、陆逊", goal: "取荆州全境", plan: "陆逊屯公安，水军断江陵粮道；遣使结魏", status: "已发动", knows: "江陵兵约二万，粮赖江运" },
      { side: "曹丕、曹仁", goal: "坐观吴蜀相争", plan: "曹仁屯樊城不动，待江陵疲敝再议", status: "筹备", knows: "吴蜀交兵于江陵、公安之间" }
    ],
    canon: {}, orders: [], choices: [], counsel: [], assessment: ""
  });

  AT.eras.dongxi = {
    ...Object.fromEntries(["capital", "rivers", "mountains", "reportPlaces", "delegates", "player", "seat"].map(k => [k, base[k]])),
    id: "dongxi",
    name: "东西两线",
    title: "天命未定·东西两线",
    template: true,
    ref: "原著中没有这一段（江陵未失而孙刘交恶）",
    tagline: "江陵守住了，孙刘却已反目。东有东吴的水军，北有曹魏的大军，荆州夹在中间。",
    intro: "荆州没有全丢，江陵还在你手里。可孙权已经翻脸，吴军占着江面；曹丕新立，曹仁在樊城等着捡便宜。是先打东吴，还是让地求和，再图北伐？",
    playerTitle: "大王",
    orderExample: "例：关羽坚守江陵，赵云率五千护粮船；遣使武昌，许以长沙相换，请孙权归还公安、复盟共讨曹丕。",
    policyExample: "例：以保江陵为先，不北攻襄樊；东吴若来议和，可让长沙，公安必须归还。",
    window: "建安二十五年起，约两年",
    maxTurns: 8,
    turnSpan: [20, 60],
    endBy: "约两年之内",
    decisive: "如孙刘议和复盟、荆州复全；或江陵失守；或打到东吴割地求和；或刘备身死",
    rivals: "孙权与陆逊、吕蒙、朱然、潘璋，曹丕与曹仁、徐晃",
    baseline: "原著此时荆州已全部失守，关羽父子被杀；刘备称帝后伐吴，夷陵大败",
    lossLine: "比原著更糟：刘备身死；或秭归、白帝、上庸失守，益州门户洞开；或大军覆没",
    handoff: { "孙刘": ["盟", "和", "破"], "刘备": ["在世", "驾崩"] },
    mapTitle: "荆州东西两线",
    gauges: { "东线": ["东吴战线", "对东吴的攻守优势"], "北线": ["襄樊防线", "北面防备曹魏的稳固程度"], "孙刘": ["孙刘之好", "孙刘两家的关系"] },
    factions: { "刘": "--shu", "孙": "--wu", "曹": "--wei", "争": "--war" },
    factionNames: { "刘": "刘备", "孙": "孙权", "曹": "曹丕", "争": "交战" },
    cast: [...base.cast.filter(n => n !== "曹操" && n !== "于禁"), "曹丕", "庞统"],
    places,
    routes: [
      ...base.routes,
      ["公安", "长沙", [3, 5, 10], [3, 5, 10], "南下湘水"],
      ["陆口", "长沙", [2, 3, 6], [2, 3, 6], "陆路"],
      ["陆口", "武昌", [2, 3, 5], [3, 4, 7], "长江顺流东下；西上为逆流"],
      ["武昌", "建业", [5, 8, 20], [8, 12, 28], "长江"]
    ],
    setting: `这是原著中没有的一段：吕蒙白衣渡江取了公安（或孙刘已经决裂），但江陵没有丢，刘备一方仍据有江陵，北有曹魏的樊城、襄阳，东有东吴的公安、陆口。孙权已经撕破脸，要的是荆州全境；曹丕新立，乐见吴蜀相争。
地理沿用荆州之战：江陵是大城坚城，与公安隔江相望；长江自西而东，吴人东来是逆流，刘军东下是顺流，但吴国水军强，控扼江面；从益州东援要出三峡，粮船顺流易下、逆流难上。北面樊城、襄阳在曹魏手中，曹仁、徐晃屯兵。长沙在公安以南的湘水一带，是南三郡的门户，也是两家谈判的筹码；孙权已西移武昌督战。
三方的动向（推演时按此行事，写进各方 plans）：
- 东吴：志在荆州全境。陆逊沉着，善断粮道、困而不攻；吴国水军强，江上往来、江陵的粮运都受其威胁；陆上野战不如刘军精锐。孙权怕两面受敌，刘军逼得越紧，他越会向曹丕称臣、借魏自固；刘备若肯以地换和、给他台阶，他也可能复盟，因为他同样防着曹魏。
- 曹魏：曹丕先求坐稳，坐观成败。刘军被东吴拖住、江陵空虚，曹仁就会从樊城南下捡便宜；刘军在东线占上风，曹丕就会受孙权称臣、封他吴王，让两家继续互耗。
- 刘备：两线兵力有限，不可能同时强攻两面。可以先东后北（打到孙权求和），可以以地换和（让长沙或重划湘水之界，换孙权复盟），也可以守东攻北（最险）。和与战的条件要合乎双方的实力和利害：东吴不会无端交还公安，除非战场上吃了亏、或怕魏乘虚。
- 城池易手须写明门是怎么开的；坚城强攻旷日持久。
人物：关羽恨东吴背盟，主战，未必肯让地；孔明在成都，主张东和孙权、北拒曹操（隆中对旧策）；赵云识大体。张飞、庞统等是否在荆州，看上一局。`,
    canonEvents: [],
    // 世界线分支（按顺序取第一条成立的）
    next: [
      { final: true, label: "刘备驾崩", text: "刘备于两线交兵之中病逝。刘备线到此完结。", when: s => liubeiGone(s) },
      { era: "beifa", label: "两路北伐", gap: "孙刘复盟之后", note: "荆州复全，孙刘议和复盟，可依隆中对两路北伐", when: s => AT.jingzhouSafe(s) },
      { era: "yiling", label: "夷陵", gap: "荆州失守之后", note: "江陵失守，关羽身死，刘备欲东征复仇", when: s => lostJiangling(s) && figureGone(s, "关羽") },
      { final: true, label: "荆州再失", text: "江陵得而复失，荆州终归东吴。刘备退保益州，天下三分之势已定，刘备线到此完结。", when: (s, g) => lostJiangling(s) && fromFujingzhou(g) },
      { era: "fujingzhou", label: "复荆州", gap: "荆州失守之后", note: "江陵失守而关羽未死，刘备欲夺回荆州", when: s => lostJiangling(s) },
      { final: true, label: "荆襄相持", text: "江陵与东吴、曹魏两面相持，北伐无从谈起。天下三分之势已定，刘备线到此完结。", when: () => true }
    ],
    starts: {
      sample: {
        label: "江陵孤守（参考）",
        blurb: "参考开局：公安已失，江陵尚在，孙刘交恶。实际开局由上一局的结局推演生成。",
        setup: "【起点：江陵孤守（参考）】\n吕蒙取了公安，关羽回守江陵，孙刘反目；曹操新丧，曹仁屯樊城观望。",
        tone: "",
        title: "",
        text: "",
        state: ref
      }
    }
  };
})(globalThis.AT = globalThis.AT || {});
