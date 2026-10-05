// Browser runner for the same declarative model used by the Python CLI.
const copy = value => structuredClone(value);
export function evaluate(expression, facts, parameters) {
  if (expression === null || typeof expression !== 'object') return expression;
  if ('fact' in expression) return facts[expression.fact] ?? null;
  if ('parameter' in expression) return parameters[expression.parameter];
  if ('sum' in expression) {
    const values = expression.sum.map(term => evaluate(term, facts, parameters));
    return values.some(value => value === null) ? null : values.reduce((a, b) => a + b, 0);
  }
  throw new Error('无法识别模型表达式');
}
export function conditionResult(condition, facts, parameters) {
  const [left, operation, right] = condition;
  const a = evaluate(left, facts, parameters), b = evaluate(right, facts, parameters);
  if (a === null || b === null) return false;
  switch (operation) {
    case 'eq': return a === b; case 'ne': return a !== b;
    case 'ge': return a >= b; case 'gt': return a > b;
    case 'le': return a <= b; case 'lt': return a < b;
    default: throw new Error('无法识别模型条件');
  }
}
function referencedFacts(value, names = new Set()) {
  if (value && typeof value === 'object') {
    if (!Array.isArray(value) && Object.keys(value).length === 1 && 'fact' in value) names.add(value.fact);
    else Object.values(value).forEach(item => referencedFacts(item, names));
  }
  return names;
}
export class Model {
  constructor(data) { this.data = copy(data); }
  get parameters() { return this.data.parameters; }
  get actions() { return this.data.actions; }
  action(id) {
    const action = this.actions.find(action => action.id === id);
    if (!action) throw new Error('未知军令');
    return action;
  }
  checks(action, facts) {
    return action.requires.map(condition => ({condition: copy(condition), passed: conditionResult(condition, facts, this.parameters)}));
  }
  validate(facts) {
    const specs = this.data.facts;
    if (Object.keys(facts).length !== Object.keys(specs).length || Object.keys(specs).some(key => !(key in facts))) throw new Error('模型事实不完整');
    for (const [key, spec] of Object.entries(specs)) {
      const value = facts[key];
      const validType = spec.type === 'int' ? Number.isInteger(value) : typeof value === ({bool: 'boolean', str: 'string'})[spec.type];
      if (!validType || ('min' in spec && value < spec.min) || ('max' in spec && value > spec.max) || (spec.values && !spec.values.includes(value))) throw new Error(`军情数值无效：${key}`);
    }
    for (const rule of this.data.invariants) {
      if (rule.when && !conditionResult(rule.when, facts, this.parameters)) continue;
      if (!conditionResult(rule.condition, facts, this.parameters)) throw new Error(rule.description);
    }
  }
  transition(action, facts, partial = false) {
    const after = copy(facts);
    for (const effect of action.effects) {
      const value = evaluate(effect.value, facts, this.parameters);
      if (value === null && !partial) throw new Error('军令缺少必要信息');
      if (effect.operation === 'set') after[effect.fact] = value;
      else if (effect.operation === 'add') after[effect.fact] = (facts[effect.fact] == null || value === null) ? null : facts[effect.fact] + value;
      else throw new Error('无法识别模型效果');
    }
    after.day = facts.day + action.days;
    return after;
  }
  utility(actor, facts) {
    return this.data.actors[actor].goals.reduce((total, goal) => total + ((goal.requires || [goal.condition]).every(c => conditionResult(c, facts, this.parameters)) ? goal.weight : 0), 0);
  }
  plan(actor, beliefs, depth = 2) {
    const initialScore = this.utility(actor, beliefs);
    const candidates = this.actions.filter(a => a.actor === actor && a.kind === 'npc');
    let best = null;
    const search = (view, path, remaining) => {
      const gain = this.utility(actor, view) - initialScore;
      if (path.length && gain > 0 && (!best || gain > best.gain || (gain === best.gain && path.length < best.plan.length))) best = {plan: path, gain, utility_before: initialScore};
      if (!remaining) return;
      for (const action of candidates) if (this.checks(action, view).every(c => c.passed)) search(this.transition(action, view, true), [...path, action.id], remaining - 1);
    };
    search(copy(beliefs), [], depth);
    return best;
  }
}
export class Session {
  constructor(model, scenario) {
    this.model = new Model(model.data);
    if (!(scenario in model.data.scenarios)) throw new Error('未知开局');
    this.scenario = scenario;
    this.facts = Object.fromEntries(Object.entries(this.model.data.facts).map(([key, spec]) => [key, copy(spec.initial)]));
    Object.assign(this.facts, this.model.data.scenarios[scenario].overrides);
    this.model.validate(this.facts);
    this.beliefs = Object.fromEntries(Object.entries(this.model.data.actors).map(([actor, definition]) => [actor, Object.fromEntries(definition.initial_knowledge.map(key => [key, copy(this.facts[key])]))]));
    this.initial = {facts: copy(this.facts), beliefs: copy(this.beliefs)};
    this.events = []; this.decisions = [];
  }
  get stopReason() {
    if (this.facts.campaign_finished) return this.facts.fancheng_taken ? 'fancheng_taken' : this.facts.guan_yu_status;
    return this.facts.day >= this.model.parameters.horizon_days ? 'horizon' : null;
  }
  available() {
    return this.stopReason ? [] : this.model.actions.filter(a => a.kind === 'player' && this.model.checks(a, this.beliefs.liu_bei).every(c => c.passed));
  }
  observe(action, executed) {
    const learned = {}, visibility = executed ? copy(action.reveals || {}) : {};
    if (!executed) visibility[action.actor] = [...referencedFacts(action.requires)].sort();
    if (executed) for (const actor of action.observers) visibility[actor] = [...(visibility[actor] || []), ...action.effects.map(e => e.fact)];
    for (const [actor, keys] of Object.entries(visibility)) {
      const updates = {};
      for (const key of new Set(keys)) {
        const value = copy(this.facts[key]);
        if (!(key in this.beliefs[actor]) || this.beliefs[actor][key] !== value) updates[key] = {before: this.beliefs[actor][key] ?? null, after: value};
        this.beliefs[actor][key] = value;
      }
      if (Object.keys(updates).length) learned[actor] = updates;
    }
    for (const beliefs of Object.values(this.beliefs)) beliefs.day = this.facts.day;
    return learned;
  }
  execute(action, planning = null) {
    const checks = this.model.checks(action, this.facts), passed = checks.every(c => c.passed), before = copy(this.facts);
    if (passed) { const after = this.model.transition(action, this.facts); this.model.validate(after); this.facts = after; }
    const learned = this.observe(action, passed);
    const changes = Object.fromEntries(Object.entries(this.facts).filter(([key, value]) => before[key] !== value).map(([key, value]) => [key, {before: before[key], after: value}]));
    const causes = [];
    for (const key of [...referencedFacts(action.requires)].sort()) {
      const previous = [...this.events].reverse().find(e => key in e.changes);
      if (previous && !causes.includes(previous.id)) causes.push(previous.id);
    }
    const event = {id: `e${String(this.events.length + 1).padStart(3, '0')}`, action: action.id, actor: action.actor, label: action.label, status: passed ? 'executed' : 'blocked', day: this.facts.day, checks, changes, cause_event_ids: causes, learned, planning: copy(planning), provenance: copy(action.provenance), canon: this.canonChecks()};
    this.events.push(event); return event;
  }
  canonChecks() {
    return this.model.data.canon_events.map(e => { const checks = e.requires.map(c => ({condition: copy(c), passed: conditionResult(c, this.facts, this.model.parameters)})); return {id: e.id, label: e.label, source: copy(e.source), eligible_now: checks.every(c => c.passed), checks}; });
  }
  resolve() {
    for (let i = 0; i < this.model.actions.length; i++) {
      const eligible = this.model.actions.find(a => a.kind === 'trigger' && this.model.checks(a, this.facts).every(c => c.passed));
      if (!eligible) return;
      this.execute(eligible);
    }
    throw new Error('战况结算未收敛');
  }
  step(id) {
    if (!this.available().some(a => a.id === id)) throw new Error('此刻无法执行这道军令');
    const action = this.model.action(id);
    if (!this.model.checks(action, this.facts).every(c => c.passed)) throw new Error('实际战况已不允许这道军令');
    const start = this.events.length;
    this.execute(action); this.decisions.push(id); this.resolve();
    for (const actor of this.model.data.npc_order) {
      if (this.stopReason) break;
      const plan = this.model.plan(actor, this.beliefs[actor], this.model.parameters.planning_depth);
      if (plan) { this.execute(this.model.action(plan.plan[0]), plan); this.resolve(); }
    }
    return this.events.slice(start);
  }
  async trace() {
    const serialized = pythonCanonical(this.model.data);
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
    const checksum = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
    return {format_version: 1, model: copy(this.model.data), model_sha256: checksum, scenario: this.scenario, initial: copy(this.initial), decisions: [...this.decisions], events: copy(this.events), final: {facts: copy(this.facts), beliefs: copy(this.beliefs)}, stop_reason: this.stopReason || 'script_complete'};
  }
}
function pythonCanonical(value) {
  if (Array.isArray(value)) return '[' + value.map(pythonCanonical).join(', ') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ': ' + pythonCanonical(value[k])).join(', ') + '}';
  return JSON.stringify(value);
}
