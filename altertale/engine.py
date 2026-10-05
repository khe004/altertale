"""Declarative state transitions and bounded planning; no network or LLM calls."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
from typing import Any


class RuleError(ValueError):
    """An action, model, or replay is invalid."""


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def evaluate(expression: Any, facts: dict, parameters: dict) -> Any:
    if not isinstance(expression, dict):
        return expression
    if set(expression) == {"fact"}:
        return facts.get(expression["fact"])
    if set(expression) == {"parameter"}:
        return parameters[expression["parameter"]]
    if set(expression) == {"sum"}:
        values = [evaluate(term, facts, parameters) for term in expression["sum"]]
        return None if any(value is None for value in values) else sum(values)
    raise RuleError(f"Unsupported expression: {expression}")


def condition_result(condition: list, facts: dict, parameters: dict) -> bool:
    left, operator, right = condition
    left = evaluate(left, facts, parameters)
    right = evaluate(right, facts, parameters)
    if left is None or right is None:
        return False  # Unknown information never establishes eligibility.
    operations = {
        "eq": lambda: left == right,
        "ne": lambda: left != right,
        "ge": lambda: left >= right,
        "gt": lambda: left > right,
        "le": lambda: left <= right,
        "lt": lambda: left < right,
    }
    if operator not in operations:
        raise RuleError(f"Unsupported condition: {operator}")
    return operations[operator]()


def referenced_facts(value: Any) -> set[str]:
    if isinstance(value, dict):
        if set(value) == {"fact"}:
            return {value["fact"]}
        return set().union(*(referenced_facts(item) for item in value.values()))
    if isinstance(value, list):
        return set().union(*(referenced_facts(item) for item in value))
    return set()


@dataclass
class Model:
    data: dict

    @classmethod
    def load(cls, path: Path | None = None) -> Model:
        path = path or Path(__file__).parent / "data" / "jingzhou.json"
        return cls(json.loads(path.read_text(encoding="utf-8")))

    @property
    def parameters(self) -> dict:
        return self.data["parameters"]

    @property
    def actions(self) -> list[dict]:
        return self.data["actions"]

    def action(self, identifier: str) -> dict:
        for action in self.actions:
            if action["id"] == identifier:
                return action
        raise RuleError(f"Unknown action: {identifier}")

    def validate(self, facts: dict) -> None:
        specs = self.data["facts"]
        if set(facts) != set(specs):
            raise RuleError("World facts do not match the model schema")
        for name, spec in specs.items():
            value = facts[name]
            expected = {"int": int, "bool": bool, "str": str}[spec["type"]]
            if type(value) is not expected:
                raise RuleError(f"Wrong type for {name}: {value!r}")
            if "min" in spec and value < spec["min"]:
                raise RuleError(f"Resource below minimum: {name}={value}")
            if "max" in spec and value > spec["max"]:
                raise RuleError(f"Resource above maximum: {name}={value}")
            if "values" in spec and value not in spec["values"]:
                raise RuleError(f"Invalid value for {name}: {value}")
        for invariant in self.data["invariants"]:
            if "when" in invariant and not condition_result(invariant["when"], facts, self.parameters):
                continue
            if not condition_result(invariant["condition"], facts, self.parameters):
                raise RuleError(invariant["description"])

    def checks(self, action: dict, facts: dict) -> list[dict]:
        return [
            {"condition": deepcopy(condition), "passed": condition_result(condition, facts, self.parameters)}
            for condition in action["requires"]
        ]

    def transition(self, action: dict, facts: dict, partial: bool = False) -> dict:
        """Effects read the same pre-action snapshot, then commit atomically."""
        after = deepcopy(facts)
        for effect in action["effects"]:
            value = evaluate(effect["value"], facts, self.parameters)
            if value is None and not partial:
                raise RuleError(f"Unknown effect value: {effect['fact']}")
            if effect["operation"] == "set":
                after[effect["fact"]] = value
            elif effect["operation"] == "add":
                current = facts.get(effect["fact"])
                after[effect["fact"]] = None if current is None or value is None else current + value
            else:
                raise RuleError(f"Unsupported effect operation: {effect['operation']}")
        after["day"] = facts["day"] + action["days"]
        return after

    def utility(self, actor: str, facts: dict) -> int:
        return sum(
            goal["weight"] for goal in self.data["actors"][actor]["goals"]
            if all(condition_result(c, facts, self.parameters) for c in
                   (goal["requires"] if "requires" in goal else [goal["condition"]]))
        )

    def plan(self, actor: str, beliefs: dict, depth: int = 2) -> dict | None:
        """Search only this actor's bounded plans, using its own information.

        This is not Sabre's multi-agent explanation search. Unknown facts stay
        unknown unless the action explicitly acquires them at execution time.
        """
        start_score = self.utility(actor, beliefs)
        candidates = [a for a in self.actions if a["actor"] == actor and a["kind"] == "npc"]
        best: dict | None = None

        def search(view: dict, path: list[str], remaining: int) -> None:
            nonlocal best
            gain = self.utility(actor, view) - start_score
            if path and gain > 0:
                rank = (gain, -len(path))
                if best is None or rank > (best["gain"], -len(best["plan"])):
                    best = {"plan": path, "gain": gain, "utility_before": start_score}
            if remaining == 0:
                return
            for action in candidates:
                if all(check["passed"] for check in self.checks(action, view)):
                    search(self.transition(action, view, partial=True), path + [action["id"]], remaining - 1)

        search(deepcopy(beliefs), [], depth)
        return best


class Session:
    def __init__(self, model: Model, scenario: str):
        self.model = Model(deepcopy(model.data))
        if scenario not in model.data["scenarios"]:
            raise RuleError(f"Unknown scenario: {scenario}")
        self.scenario = scenario
        self.facts = {key: spec["initial"] for key, spec in self.model.data["facts"].items()}
        self.facts.update(self.model.data["scenarios"][scenario]["overrides"])
        self.model.validate(self.facts)
        self.beliefs = {
            actor: {key: deepcopy(self.facts[key]) for key in definition["initial_knowledge"]}
            for actor, definition in self.model.data["actors"].items()
        }
        # Day is scheduling information, visible to everyone.
        self.initial = {"facts": deepcopy(self.facts), "beliefs": deepcopy(self.beliefs)}
        self.events: list[dict] = []
        self.decisions: list[str] = []

    def fork(self) -> Session:
        return deepcopy(self)

    @property
    def stop_reason(self) -> str | None:
        if self.facts["campaign_finished"]:
            return self.facts["guan_yu_status"] if not self.facts["fancheng_taken"] else "fancheng_taken"
        if self.facts["day"] >= self.model.parameters["horizon_days"]:
            return "horizon"
        return None

    def available(self) -> list[dict]:
        if self.stop_reason:
            return []
        return [
            a for a in self.model.actions
            if a["kind"] == "player"
            and all(check["passed"] for check in self.model.checks(a, self.beliefs["liu_bei"]))
        ]

    def _observe(self, action: dict, executed: bool) -> dict:
        learned = {}
        visibility = deepcopy(action.get("reveals", {})) if executed else {}
        if not executed:
            # An attempted action encounters its actual blocking conditions.
            visibility[action["actor"]] = sorted(referenced_facts(action["requires"]))
        if executed:
            changed = [effect["fact"] for effect in action["effects"]]
            for actor in action["observers"]:
                visibility.setdefault(actor, []).extend(changed)
        for actor, keys in visibility.items():
            updates = {}
            for key in set(keys):
                value = deepcopy(self.facts[key])
                if self.beliefs[actor].get(key) != value or key not in self.beliefs[actor]:
                    updates[key] = {"before": self.beliefs[actor].get(key), "after": value}
                self.beliefs[actor][key] = value
            if updates:
                learned[actor] = updates
        for actor in self.beliefs:
            self.beliefs[actor]["day"] = self.facts["day"]
        return learned

    def execute(self, action: dict, planning: dict | None = None) -> dict:
        checks = self.model.checks(action, self.facts)
        passed = all(check["passed"] for check in checks)
        before = deepcopy(self.facts)
        if passed:
            after = self.model.transition(action, self.facts)
            self.model.validate(after)
            self.facts = after
        learned = self._observe(action, passed)
        changes = {
            key: {"before": before[key], "after": value}
            for key, value in self.facts.items() if before[key] != value
        }
        # Link each changed prerequisite to the last event that changed it.
        causes = []
        for key in sorted(referenced_facts(action["requires"])):
            for previous in reversed(self.events):
                if key in previous["changes"]:
                    if previous["id"] not in causes:
                        causes.append(previous["id"])
                    break
        event = {
            "id": f"e{len(self.events) + 1:03d}",
            "action": action["id"], "actor": action["actor"], "label": action["label"],
            "status": "executed" if passed else "blocked",
            "day": self.facts["day"], "checks": checks, "changes": changes,
            "cause_event_ids": causes, "learned": learned, "planning": deepcopy(planning),
            "provenance": action["provenance"],
            "canon": self.canon_checks(),
        }
        self.events.append(event)
        return event

    def canon_checks(self) -> list[dict]:
        results = []
        for event in self.model.data["canon_events"]:
            conditions = [
                {"condition": deepcopy(c), "passed": condition_result(c, self.facts, self.model.parameters)}
                for c in event["requires"]
            ]
            results.append({
                "id": event["id"], "label": event["label"], "source": event["source"],
                "eligible_now": all(c["passed"] for c in conditions), "checks": conditions,
            })
        return results

    def _resolve(self) -> None:
        for _ in range(len(self.model.actions)):
            eligible = next((
                a for a in self.model.actions if a["kind"] == "trigger"
                and all(c["passed"] for c in self.model.checks(a, self.facts))
            ), None)
            if eligible is None:
                return
            self.execute(eligible)
        raise RuleError("Trigger loop did not converge")

    def step(self, identifier: str) -> list[dict]:
        if identifier not in [a["id"] for a in self.available()]:
            raise RuleError(f"Player decision unavailable: {identifier}")
        action = self.model.action(identifier)
        # Player decisions must be physically legal as well as known to be legal.
        if not all(c["passed"] for c in self.model.checks(action, self.facts)):
            raise RuleError(f"Player decision blocked by actual state: {identifier}")
        start = len(self.events)
        self.execute(action)
        self.decisions.append(identifier)
        self._resolve()
        for actor in self.model.data["npc_order"]:
            if self.stop_reason:
                break
            plan = self.model.plan(actor, self.beliefs[actor], self.model.parameters["planning_depth"])
            if plan:
                self.execute(self.model.action(plan["plan"][0]), plan)
                self._resolve()
        return self.events[start:]

    def trace(self) -> dict:
        return {
            "format_version": 1, "model": deepcopy(self.model.data), "model_sha256": digest(self.model.data),
            "scenario": self.scenario, "initial": deepcopy(self.initial),
            "decisions": list(self.decisions), "events": deepcopy(self.events),
            "final": {"facts": deepcopy(self.facts), "beliefs": deepcopy(self.beliefs)},
            "stop_reason": self.stop_reason or "script_complete",
        }

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(self.trace(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def replay(trace: dict) -> Session:
    if trace.get("format_version") != 1:
        raise RuleError("Unsupported replay format")
    if digest(trace["model"]) != trace["model_sha256"]:
        raise RuleError("Model checksum mismatch")
    session = Session(Model(deepcopy(trace["model"])), trace["scenario"])
    for choice in trace["decisions"]:
        session.step(choice)
    if session.trace() != trace:
        raise RuleError("Replay does not match the saved state or causal record")
    return session
