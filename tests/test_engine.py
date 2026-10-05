from copy import deepcopy
import json
import io
import os
from pathlib import Path
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from altertale.cli import DEFAULT_CHOICES, comparison, interactive, run_choices
from altertale.engine import Model, RuleError, Session, replay, referenced_facts
from altertale.sabre import export_problem, run_sabre


class JingzhouTests(unittest.TestCase):
    def setUp(self):
        self.model = Model.load()

    def run_route(self, scenario, choices=DEFAULT_CHOICES):
        session = Session(self.model, scenario)
        run_choices(session, choices)
        return session

    def test_same_decisions_have_causally_different_outcomes(self):
        baseline = self.run_route("baseline")
        alternate = self.run_route("zhuge")
        self.assertEqual(baseline.decisions, alternate.decisions)
        self.assertEqual(baseline.facts["guan_yu_status"], "captured")
        self.assertEqual(alternate.facts["guan_yu_status"], "retreated")
        self.assertIn("raid_jingzhou", [e["action"] for e in baseline.events])
        self.assertNotIn("raid_jingzhou", [e["action"] for e in alternate.events])
        self.assertIn("coordinate_with_wei", [e["action"] for e in alternate.events])

    def test_intervention_costs_are_recorded_in_initial_state(self):
        baseline = Session(self.model, "baseline")
        alternate = Session(self.model, "zhuge")
        differences = {k for k in baseline.facts if baseline.facts[k] != alternate.facts[k]}
        self.assertEqual(differences, {"zhuge_liang_location", "rear_coordination", "shu_resources", "yizhou_advisory_capacity"})
        self.assertLess(alternate.facts["shu_resources"], baseline.facts["shu_resources"])

    def test_liu_bei_can_change_outcome_with_reinforcements(self):
        saved = self.run_route("baseline", "launch_campaign,reinforce_rear,order_withdrawal")
        self.assertEqual(saved.facts["jingzhou_owner"], "Shu")
        self.assertEqual(saved.facts["guan_yu_status"], "retreated")

    def test_truce_is_accepted_by_wu_instead_of_imposed(self):
        negotiated = self.run_route("zhuge", "launch_campaign,offer_truce,order_withdrawal")
        self.assertTrue(negotiated.facts["truce"])
        self.assertIn("accept_truce", [e["action"] for e in negotiated.events])
        declined = self.run_route("baseline", "launch_campaign,offer_truce,order_withdrawal")
        self.assertFalse(declined.facts["truce"])
        self.assertIn("raid_jingzhou", [e["action"] for e in declined.events])

    def test_unknown_enemy_deployment_is_not_used_for_planning(self):
        session = Session(self.model, "zhuge")
        self.assertNotIn("rear_troops", session.beliefs["sun_quan"])
        self.assertNotIn("rear_coordination", session.beliefs["sun_quan"])
        session.execute(session.model.action("launch_campaign"))
        plan = session.model.plan("sun_quan", session.beliefs["sun_quan"])
        self.assertEqual(plan["plan"][0], "scout_jingzhou")
        self.assertNotIn("rear_troops", session.beliefs["sun_quan"])
        event = session.execute(session.model.action("scout_jingzhou"), plan)
        self.assertIn("rear_coordination", event["learned"]["sun_quan"])

    def test_stale_intelligence_blocks_raid_without_changing_resources(self):
        session = Session(self.model, "baseline")
        session.step("launch_campaign")
        session.execute(session.model.action("reinforce_rear"))
        plan = session.model.plan("sun_quan", session.beliefs["sun_quan"])
        self.assertEqual(plan["plan"][0], "raid_jingzhou")
        before = deepcopy(session.facts)
        event = session.execute(session.model.action("raid_jingzhou"), plan)
        self.assertEqual(event["status"], "blocked")
        self.assertEqual(session.facts, before)
        self.assertEqual(session.beliefs["sun_quan"]["rear_troops"], 3)

    def test_invalid_player_input_leaves_session_unchanged(self):
        session = Session(self.model, "baseline")
        before = session.trace()
        for choice in ["raid_jingzhou", "order_withdrawal", "not_an_action"]:
            with self.assertRaises(RuleError):
                session.step(choice)
            self.assertEqual(session.trace(), before)

    def test_dead_actor_cannot_act(self):
        self.model.data["facts"]["liu_bei_alive"]["initial"] = False
        session = Session(self.model, "baseline")
        self.assertEqual(session.available(), [])
        with self.assertRaises(RuleError):
            session.step("launch_campaign")

    def test_all_explored_routes_preserve_resources_and_troop_accounting(self):
        frontier = [Session(self.model, scenario) for scenario in ["baseline", "zhuge"]]
        transitions = 0
        for _ in range(4):
            following = []
            for session in frontier:
                for action in session.available():
                    branch = session.fork()
                    events = branch.step(action["id"])
                    state = deepcopy(session.facts)
                    for event in events:
                        for key, change in event["changes"].items():
                            self.assertEqual(state[key], change["before"])
                            state[key] = change["after"]
                        branch.model.validate(state)
                    self.assertEqual(state, branch.facts)
                    following.append(branch)
                    transitions += 1
            frontier = following
        self.assertGreater(transitions, 100)

    def test_failed_effects_commit_atomically(self):
        session = Session(self.model, "baseline")
        action = deepcopy(session.model.action("launch_campaign"))
        action["effects"].append({"fact": "shu_resources", "operation": "add", "value": -100})
        before = session.trace()
        with self.assertRaises(RuleError):
            session.execute(action)
        self.assertEqual(session.trace(), before)

    def test_fork_and_model_parameters_are_isolated(self):
        parent = Session(self.model, "zhuge")
        branch = parent.fork()
        branch.step("launch_campaign")
        branch.model.parameters["raid_threshold"] = 4
        self.assertEqual(parent.events, [])
        self.assertEqual(parent.facts["front_troops"], 0)
        self.assertEqual(parent.model.parameters["raid_threshold"], 3)
        self.assertEqual(self.model.parameters["raid_threshold"], 3)

    def test_saved_trace_replays_and_rejects_tampering(self):
        session = self.run_route("baseline")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "nested" / "trace.json"
            session.save(path)
            trace = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(replay(trace).trace(), trace)
        trace["events"][-1]["changes"]["guan_yu_status"]["after"] = "retreated"
        with self.assertRaises(RuleError):
            replay(trace)
        changed = session.trace()
        changed["model"]["parameters"]["raid_threshold"] = 4
        with self.assertRaises(RuleError):
            replay(changed)

    def test_causal_links_reference_events_that_changed_prerequisites(self):
        session = self.run_route("baseline")
        earlier = {}
        for event in session.events:
            prerequisites = referenced_facts(session.model.action(event["action"])["requires"])
            for cause in event["cause_event_ids"]:
                self.assertIn(cause, earlier)
                self.assertTrue(prerequisites.intersection(earlier[cause]["changes"]))
            earlier[event["id"]] = event
        self.assertTrue(session.events[-1]["cause_event_ids"])

    def test_stronger_enemy_capability_can_defeat_the_intervention(self):
        self.model.parameters["raid_threshold"] = 4
        session = self.run_route("zhuge")
        self.assertEqual(session.facts["guan_yu_status"], "captured")

    def test_horizon_prevents_further_player_decisions(self):
        self.model.parameters["horizon_days"] = 10
        session = Session(self.model, "zhuge")
        session.step("launch_campaign")
        self.assertEqual(session.stop_reason, "horizon")
        with self.assertRaises(RuleError):
            session.step("press_attack")

    def test_fixture_references_defined_facts_and_provenance(self):
        facts = set(self.model.data["facts"])
        sources = {source["id"] for source in self.model.data["provenance"]}
        identifiers = [a["id"] for a in self.model.actions]
        self.assertEqual(len(set(identifiers)), len(identifiers))
        for action in self.model.actions:
            self.assertFalse(referenced_facts(action).difference(facts))
            self.assertFalse(set(action["provenance"]).difference(sources))
            for actor, keys in action["reveals"].items():
                self.assertIn(actor, self.model.data["actors"])
                self.assertFalse(set(keys).difference(facts))

    def test_comparison_artifacts_replay(self):
        with tempfile.TemporaryDirectory() as directory:
            report = comparison(Path(directory))
            self.assertIn("提高袭击门槛", report)
            for name in ["baseline", "zhuge", "zhuge-sensitive"]:
                trace = json.loads((Path(directory) / f"{name}.json").read_text(encoding="utf-8"))
                self.assertEqual(replay(trace).trace(), trace)

    def test_sabre_export_preserves_unknown_information_and_scope(self):
        session = Session(self.model, "baseline")
        problem = export_problem(session)
        self.assertIn("believes(PlannerActor, rear_troops() = ?);", problem)
        self.assertNotIn("action launch_campaign", problem)
        self.assertNotIn("action capture_guan_yu", problem)
        self.assertIn("consenting: PlannerActor;", problem)

    def test_interactive_player_does_not_see_secret_wu_plans(self):
        session = Session(self.model, "zhuge")
        output = io.StringIO()
        with patch("builtins.input", side_effect=["1", "1", "5"]), redirect_stdout(output):
            interactive(session)
        self.assertNotIn("落实吴魏军事联动", output.getvalue())
        self.assertNotIn("探查荆州后方部署", output.getvalue())
        self.assertIn("前线报告", output.getvalue())
        self.assertEqual(session.facts["guan_yu_status"], "retreated")


@unittest.skipUnless(os.environ.get("ALTERTALE_SABRE_JAR"), "Optional external Sabre JAR not provided")
class SabreIntegrationTests(unittest.TestCase):
    def test_same_model_produces_alternative_wu_plans(self):
        jar = Path(os.environ["ALTERTALE_SABRE_JAR"])
        for scenario, expected in [("baseline", "raid_jingzhou"), ("zhuge", "coordinate_with_wei")]:
            with self.subTest(scenario=scenario):
                session = Session(Model.load(), scenario)
                session.step("launch_campaign")
                result = run_sabre(session, jar)
                self.assertEqual(result["status"], "found")
                self.assertEqual(result["plan"][0], expected)


if __name__ == "__main__":
    unittest.main()
