"""Cross-runtime verification for browser decisions, knowledge and replay files."""
from collections import deque
import json
from pathlib import Path
import shutil
import subprocess
import unittest

from altertale.engine import Model, Session

ROOT = Path(__file__).resolve().parent.parent


@unittest.skipUnless(shutil.which('node'), 'Node.js is needed for browser parity')
class WebParityTests(unittest.TestCase):
    def test_browser_matches_python_across_branches_and_assumptions(self):
        fixtures = []
        for threshold in (3, 4):
            for scenario in ('baseline', 'zhuge'):
                model = Model.load()
                model.parameters['raid_threshold'] = threshold
                queue = deque([Session(model, scenario)])
                visited = 0
                while queue and visited < 65:
                    session = queue.popleft()
                    fixtures.append(session.trace())
                    visited += 1
                    if len(session.decisions) >= 3:
                        continue
                    for action in session.available():
                        branch = session.fork()
                        branch.step(action['id'])
                        queue.append(branch)
                # Longer attacks exercise terminal events and stale NPC knowledge.
                for choices in (
                    ['launch_campaign', 'press_attack', 'order_withdrawal'],
                    ['launch_campaign', 'reinforce_rear', 'order_withdrawal'],
                    ['launch_campaign', 'offer_truce', 'press_attack', 'order_withdrawal'],
                ):
                    session = Session(model, scenario)
                    for choice in choices:
                        if choice not in [a['id'] for a in session.available()]:
                            break
                        session.step(choice)
                    fixtures.append(session.trace())
        result = subprocess.run(
            ['node', str(ROOT / 'tests/check_web_parity.mjs')],
            input=json.dumps(fixtures, ensure_ascii=False),
            text=True, capture_output=True, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('complete causal traces matched', result.stdout)
