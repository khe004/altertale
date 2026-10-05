import {Model, Session, evaluate} from './engine.mjs';
const $ = id => document.getElementById(id);
const setText = (id, text) => { $(id).textContent = text; };
const names = {Shu:'刘备集团', Wu:'孙权集团', Wei:'曹操集团'};
const locations = {Jingzhou:'荆州', Yizhou:'益州', Xiangfan:'襄樊', Wu_custody:'吴军营中'};
const factLabels = {supplies:'粮秣', shu_resources:'可用资源', rear_troops:'后方兵力', front_troops:'前线兵力', reserve_troops:'预备兵力', lost_troops:'损失 / 失控', wei_pressure:'前线压力', siege_progress:'攻城进度', jingzhou_owner:'荆州控制', fortified:'后方戒备', truce:'暂时停战', guan_yu_status:'关羽状态', campaign_finished:'北伐结束', retreat_ordered:'撤军令'};
const actionCopy = {
  launch_campaign:['准许北伐','调三单位后方兵力、三单位预备兵力赴襄樊，先取樊城。'],
  press_attack:['继续攻城','向樊城施压，推进攻城进度。粮秣也将进一步消耗。'],
  reinforce_rear:['增援荆州','从益州预备队调两单位兵力，补强荆州后方。'],
  fortify_rear:['加强戒备','投入资源加强后方守备，增添一道防线。'],
  offer_truce:['议和江东','向孙权提出暂缓争端。是否接受，要由他作出判断。'],
  order_withdrawal:['下令撤军','放弃本次北伐，命关羽撤回荆州。后方失守时，归路可能已断。'],
};
const scenes = {
  launch_campaign:['关羽挥师北上','北伐令送抵荆州。关羽调集兵马，向襄樊进军；荆州留守的兵力也随之减少。'],
  press_attack:['樊城攻势未歇','关羽继续投入粮秣，催动攻城。战线向前推进，军中的储备却不能不计。'],
  reinforce_rear:['援军调赴荆州','益州预备队奉命东行，补入荆州守军。前线仍在作战，后方已经添了支撑。'],
  fortify_rear:['后方加紧戒备','守军加强协同与戒备。投入的资源化为一重防线，但吴魏的意图仍须留心。'],
  offer_truce:['使者渡江','暂缓争端的提议送往江东。军令已经发出，回音尚须等待。'],
  order_withdrawal:['撤军令已发','你命关羽罢兵南返。荆州若仍在掌握之中，大军便有归处。'],
  raid_jingzhou:['荆州失守','吴军趁后方兵力薄弱袭取荆州。留守兵马损失，关羽的后方与补给遭受重创。'],
  accept_truce:['江东暂息兵戈','孙权接受暂时停战。荆州争端暂被搁置，北伐的前线压力仍须应对。'],
  relieve_fancheng:['魏军驰援樊城','魏军增援襄樊，关羽受到更强的牵制。补给也在这场对峙中继续消耗。'],
  cut_supply:['粮道告急','魏军压迫补给线，粮秣再度减少。能否继续攻城，已经与归路同样紧迫。'],
  withdraw_to_jingzhou:['关羽撤回荆州','前线部队撤回后方，关羽得以收兵。樊城未下，但荆州与归来的将士仍在。'],
  capture_guan_yu:['归路已断','荆州失守，粮秣枯竭。关羽部队溃散，被吴军俘获；这次北伐至此结束。'],
  take_fancheng:['樊城攻克','攻城进展终于越过守军的防线。粮秣与压力仍在可承受的范围内，关羽攻克樊城。'],
};
let model, session, visibleEntries = [], latestEntries = [], pendingScenario, selectedView = 'current';
let busy = false;
function displayValue(key, value) {
  if (key === 'jingzhou_owner') return names[value] || value;
  if (key === 'guan_yu_status') return {active:'征战中', retreated:'已撤回', captured:'被俘'}[value] || value;
  if (typeof value === 'boolean') return value ? '是' : '否';
  return value ?? '尚不知';
}
function visibleEvent(event) {
  if (event.status !== 'executed') return null;
  const action = model.action(event.action), learned = event.learned.liu_bei || {};
  if (!action.observers.includes('liu_bei')) {
    if (!Object.keys(learned).length) return null;
    return {day:event.day,title:'前线报告',text:'前线压力发生变化。现有军报尚未揭示对方的完整部署。',changes:learned};
  }
  const [title, text] = scenes[event.action] || [event.label, '军情已经更新。'];
  return {day:event.day,title,text,changes:learned};
}
function appendChanges(container, changes) {
  container.replaceChildren();
  for (const [key, change] of Object.entries(changes)) {
    if (!(key in factLabels)) continue;
    const tag = document.createElement('span'); tag.className = 'change-tag';
    tag.textContent = `${factLabels[key]} ${displayValue(key, change.before)} → ${displayValue(key, change.after)}`;
    container.append(tag);
  }
}
function drawLog(container, entries) {
  container.replaceChildren();
  for (const entry of entries) {
    const article = document.createElement('article'); article.className = 'log-entry';
    const top = document.createElement('div'); top.className = 'log-top';
    const title = document.createElement('strong'); title.textContent = entry.title;
    const day = document.createElement('span'); day.textContent = `第 ${entry.day} 日`; top.append(title, day);
    const text = document.createElement('p'); text.textContent = entry.text; article.append(top, text);
    const changes = Object.entries(entry.changes).filter(([key]) => key in factLabels);
    if (changes.length) {
      const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = '军情变化';
      const body = document.createElement('p'); body.textContent = changes.map(([key, c]) => `${factLabels[key]}：${displayValue(key, c.before)} → ${displayValue(key, c.after)}`).join('；');
      details.append(summary,body); article.append(details);
    }
    container.append(article);
  }
}
function endingCopy() {
  const reason = session.stopReason, f = session.beliefs.liu_bei;
  if (reason === 'retreated') return ['荆州仍在，关羽归来', `北伐在第 ${f.day} 日结束。你保住了荆州与归来的兵马。换一个部署或换一道军令，再看故事如何演化。`];
  if (reason === 'captured') return ['荆州失守，关羽被俘', `第 ${f.day} 日，归路与粮道俱断。此局在被俘处结束。下一局，可以试着先补强后方，或及早收兵。`];
  if (reason === 'fancheng_taken') return ['樊城既下，北伐告捷', `第 ${f.day} 日，关羽攻克樊城。${f.jingzhou_owner === 'Shu' ? '荆州仍在你的掌握之中。' : '后方的荆州已经失守，前线的胜利也有代价。'}`];
  return ['时日已尽，此卷暂歇', '战役已达到试玩的时日上限。另起一局，试试不同的进退。'];
}
function render() {
  const f = session.beliefs.liu_bei, ended = !!session.stopReason;
  setText('day-value', f.day); setText('jingzhou-owner', names[f.jingzhou_owner]);
  setText('guan-yu-status', f.guan_yu_status === 'active' ? (f.campaign_active ? '襄樊 · 征战中' : '荆州 · 待命') : displayValue('guan_yu_status', f.guan_yu_status));
  setText('zhuge-location', locations[f.zhuge_liang_location]);
  for (const [id,key] of Object.entries({'supplies-value':'supplies','resources-value':'shu_resources','front-value':'front_troops','rear-value':'rear_troops','reserve-value':'reserve_troops','lost-value':'lost_troops'})) setText(id, f[key]);
  $('supplies-bar').style.width = `${Math.max(0, Math.min(100, f.supplies / 12 * 100))}%`;
  $('resources-bar').style.width = `${Math.max(0, Math.min(100, f.shu_resources / 6 * 100))}%`;
  setText('coordination-value', `${f.rear_coordination} · ${f.rear_coordination ? '军师统筹' : '常规协同'}`);
  setText('pressure-value', `${f.wei_pressure} · ${f.wei_pressure >= 4 ? '重压' : f.wei_pressure ? '交战中' : '尚未交战'}`);
  setText('phase-label', ended ? '此局已定' : f.campaign_active ? '北伐进行中' : '北伐未发');
  setText('story-title', ended ? '一局荆州，已留回响' : f.campaign_active ? '前线未定，后方须守' : '先定进退，再图荆襄');
  setText('map-jingzhou-caption', f.jingzhou_owner === 'Wu' ? '吴军占领' : f.zhuge_liang_location === 'Jingzhou' ? (f.campaign_active ? '诸葛亮留守' : '诸葛亮 · 关羽') : (f.campaign_active ? '留守部队' : '关羽'));
  setText('map-front-caption', f.fancheng_taken ? '已攻克' : f.campaign_active ? '关羽 · 曹仁' : '曹仁');
  $('north-route').classList.toggle('active', f.campaign_active);
  $('wu-route').classList.toggle('active', f.jingzhou_owner === 'Wu');
  document.querySelector('.jingzhou-node').classList.toggle('lost', f.jingzhou_owner === 'Wu');
  document.querySelectorAll('[data-scenario]').forEach(button => button.setAttribute('aria-pressed', button.dataset.scenario === session.scenario));
  setText('deployment-note', session.scenario === 'zhuge' ? '诸葛亮已提前留守荆州，益州的参谋力量相应减弱。' : '诸葛亮在益州，关羽镇守荆州。北伐将抽调后方兵力。');
  setText('decision-step', ended ? '此局已结束' : `第 ${session.decisions.length + 1} 道军令`);
  setText('decision-title', ended ? '再看另一种可能' : '此刻何为');
  setText('decision-context', ended ? endingCopy()[1] : !f.campaign_active ? '关羽请命进取。前线与后方的兵力，需要一并考虑。' : f.jingzhou_owner === 'Wu' ? '荆州已失守。粮秣告急，撤军的归路可能已经中断。' : f.wei_pressure >= 3 ? '魏军压迫前线，粮秣日渐减少。荆州虽在，进退也须及时。' : '攻势已起。继续进取，或为荆州的后方再留一分余地。');
  $('action-list').replaceChildren();
  for (const [index, action] of session.available().entries()) {
    const button = document.createElement('button'); button.type = 'button'; button.className = `action-card${index === 0 ? ' primary' : ''}`; button.dataset.action = action.id;
    const title = document.createElement('span'); title.className = 'action-title';
    const label = document.createElement('span'); label.textContent = actionCopy[action.id][0]; const arrow = document.createElement('span'); arrow.textContent = '→'; arrow.setAttribute('aria-hidden','true'); title.append(label, arrow);
    const description = document.createElement('span'); description.className = 'action-description'; description.textContent = actionCopy[action.id][1];
    const cost = document.createElement('span'); cost.className = 'action-cost';
    const costs = action.effects.filter(e => ['supplies','shu_resources'].includes(e.fact) && e.operation === 'add' && evaluate(e.value,f,model.parameters) < 0).map(e => `${factLabels[e.fact]} ${evaluate(e.value,f,model.parameters)}`);
    cost.textContent = [`军令耗时 ${action.days} 日`, ...costs].join(' · '); button.append(title,description,cost);
    button.addEventListener('click', () => choose(action.id)); $('action-list').append(button);
  }
  if (ended) { const button = document.createElement('button'); button.className = 'gold-button'; button.textContent = '另起一局'; button.addEventListener('click',()=>askRestart(session.scenario)); $('action-list').append(button); }
  const noChoices = !ended && !session.available().length;
  if (noChoices) { const p = document.createElement('p'); p.textContent = '当前没有可执行的军令。可以保存本局纪事，再从另一种部署开始。'; $('action-list').append(p); }
  setText('decision-note', ended ? '同一个起点，不同的选择会改变这一卷。' : '军令之后，吴、魏还会各自行动，总耗时会继续增加。');
  $('ending').hidden = !ended;
  if (ended) { const [title,text] = endingCopy(); setText('ending-title',title); setText('ending-text',text); }
  setText('entry-count',visibleEntries.length); setText('round-count',session.decisions.length ? `已下 ${session.decisions.length} 道军令` : '尚未下令');
  $('initial-report').hidden = visibleEntries.length > 0; $('empty-chronicle').hidden = visibleEntries.length > 0;
  drawLog($('recent-log'), [...latestEntries].reverse()); drawLog($('full-log'), visibleEntries);
  if (latestEntries.length) {
    const latest = latestEntries.at(-1); setText('scene-eyebrow',`军报 · 第 ${latest.day} 日`); setText('scene-title',latest.title); setText('scene-text',latest.text); appendChanges($('latest-changes'),latest.changes);
  } else { setText('scene-eyebrow','军议 · 成都'); setText('scene-title','关羽请命北伐'); setText('scene-text','樊城横在北进之路上。关羽请命率军北伐，荆州兵马即将调动。你必须在进取与守成之间，作出自己的判断。'); $('latest-changes').replaceChildren(); }
}
function showError(error) { $('error-message').hidden = false; $('error-message').textContent = `军令未能完成：${error.message}。请重开此局再试。`; }
function setMobilePanel(panel) {
  $('game').dataset.mobilePanel = panel;
  document.querySelectorAll('[data-mobile-panel]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.mobilePanel === panel));
}
function choose(id) {
  if (busy) throw new Error('上一道军令尚未结算');
  busy = true;
  try {
    const events = session.step(id);
    latestEntries = events.map(visibleEvent).filter(Boolean); visibleEntries.push(...latestEntries); render();
    setView('current'); setMobilePanel('story');
    if (matchMedia('(max-width: 940px)').matches) $('story-panel').scrollIntoView({block:'start',behavior:'smooth'});
    return playerState();
  } catch (error) { showError(error); throw error; } finally { busy = false; }
}
function start(scenario) {
  session = new Session(model, scenario); visibleEntries=[]; latestEntries=[]; $('error-message').hidden=true; setView('current'); setMobilePanel('strategy'); render();
}
function askRestart(scenario) {
  if (!session.decisions.length) {start(scenario); return;}
  pendingScenario=scenario; $('restart-dialog').showModal();
}
function setView(view) {
  selectedView=view; $('current-view').hidden=view!=='current'; $('chronicle-view').hidden=view!=='chronicle';
  document.querySelectorAll('[data-view]').forEach(button=>button.setAttribute('aria-pressed',button.dataset.view===view));
}
function playerState() {
  return {scenario:session.scenario, facts:structuredClone(session.beliefs.liu_bei), decisions:[...session.decisions], available:session.available().map(a=>({id:a.id,label:actionCopy[a.id][0],days:a.days})), stop_reason:session.stopReason, reports:visibleEntries.map(({day,title,text})=>({day,title,text}))};
}
async function save() {
  $('save-button').disabled=true;
  try {
    const trace = await session.trace(), url = URL.createObjectURL(new Blob([JSON.stringify(trace,null,2)+'\n'],{type:'application/json'}));
    const anchor=document.createElement('a'); anchor.href=url; anchor.download=`altertale-jingzhou-${session.scenario}-day${session.facts.day}.json`; anchor.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  } catch(error) {showError(error);} finally {$('save-button').disabled=false;}
}
function registerWebMCP() {
  const context = navigator.modelContext || document.modelContext;
  if (!context?.registerTool) return;
  const response = value => ({content:[{type:'text',text:JSON.stringify(value)}]});
  const tools = [
    {name:'get_jingzhou_state',description:'读取本局荆州试玩中刘备已知的军情、战报与可用军令。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:async()=>response(playerState())},
    {name:'choose_strategy',description:'在当前荆州试玩中下一道军令，推进时日并结算吴魏行动。只能选择当前可用军令。',inputSchema:{type:'object',properties:{action:{type:'string',enum:model.actions.filter(a=>a.kind==='player').map(a=>a.id)}},required:['action'],additionalProperties:false},execute:async input=>response(choose(input.action))},
    {name:'start_jingzhou_game',description:'结束当前局并重新开始荆州试玩，清空当前军令与战报。',inputSchema:{type:'object',properties:{scenario:{type:'string',enum:['baseline','zhuge']}},required:['scenario'],additionalProperties:false},execute:async input=>{if(!['baseline','zhuge'].includes(input.scenario))throw new Error('未知开局');start(input.scenario);return response(playerState());}}
  ];
  for (const tool of tools) context.registerTool(tool);
  addEventListener('pagehide',()=>{if(context.unregisterTool) for(const tool of tools) context.unregisterTool(tool.name);},{once:true});
}
try {
  const response = await fetch('./jingzhou.json'); if (!response.ok) throw new Error('无法载入荆州规则');
  model = new Model(await response.json()); start('zhuge'); $('loading').hidden=true; $('game').hidden=false;
  document.querySelectorAll('[data-scenario]').forEach(button=>button.addEventListener('click',()=>{if(button.dataset.scenario!==session.scenario) askRestart(button.dataset.scenario);}));
  document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>setView(button.dataset.view)));
  document.querySelectorAll('[data-mobile-panel]').forEach(button=>button.addEventListener('click',()=>setMobilePanel(button.dataset.mobilePanel)));
  $('help-button').addEventListener('click',()=>$('help-dialog').showModal());
  for (const id of ['restart-button','ending-restart']) $(id).addEventListener('click',()=>askRestart(session.scenario));
  $('restart-cancel').addEventListener('click',()=>$('restart-dialog').close());
  $('restart-confirm').addEventListener('click',()=>{$('restart-dialog').close();start(pendingScenario);});
  $('save-button').addEventListener('click',save);
  try {registerWebMCP();} catch(error) {console.warn('浏览器工具注册不可用',error.message);}
} catch(error) {$('loading').hidden=true;showError(error);}
