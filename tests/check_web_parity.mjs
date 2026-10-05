import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {Model, Session} from '../web/engine.mjs';
const fixtures=JSON.parse(readFileSync(0,'utf8'));
for(const expected of fixtures){
  const session=new Session(new Model(expected.model),expected.scenario);
  for(const decision of expected.decisions) session.step(decision);
  assert.deepEqual(await session.trace(),expected,`${expected.scenario}: ${expected.decisions.join(',')}`);
}
console.log(`Browser/Python parity: ${fixtures.length} complete causal traces matched.`);
