"""Local CLI for playing, comparing and replaying the Jingzhou experiment."""

from __future__ import annotations

import argparse
from copy import deepcopy
import json
from pathlib import Path

from .engine import Model, RuleError, Session, replay
from .sabre import export_problem, run_sabre

DEFAULT_CHOICES = "launch_campaign,press_attack,order_withdrawal"
OWNERS = {"Shu": "刘备集团", "Wu": "孙权集团"}
STATUSES = {"active": "仍在前线", "retreated": "已撤回荆州", "captured": "被俘"}


def make_model(threshold: int | None = None) -> Model:
    model = Model.load()
    if threshold is not None:
        if not 1 <= threshold <= 20:
            raise RuleError("raid-threshold must be between 1 and 20")
        model.parameters["raid_threshold"] = threshold
    return model


def run_choices(session: Session, choices: str) -> None:
    for choice in filter(None, (item.strip() for item in choices.split(","))):
        if session.stop_reason:
            break
        session.step(choice)


def summary(session: Session) -> str:
    facts = session.facts
    status = STATUSES[facts["guan_yu_status"]]
    if facts["guan_yu_status"] == "active" and facts["guan_yu_location"] == "Jingzhou":
        status = "尚未出征"
    return (f"第 {facts['day']} 天：荆州属{OWNERS[facts['jingzhou_owner']]}，"
            f"关羽{status}，粮秣 {facts['supplies']}，"
            f"后方/前线/预备队 {facts['rear_troops']}/{facts['front_troops']}/{facts['reserve_troops']}。")


def show_events(events: list[dict]) -> None:
    for event in events:
        suffix = "（条件不成立）" if event["status"] == "blocked" else ""
        print(f"  第 {event['day']:>3} 天 · {event['label']}{suffix}")


def comparison(output: Path, threshold: int | None = None, jar: Path | None = None) -> str:
    output.mkdir(parents=True, exist_ok=True)
    model = make_model(threshold)
    cases = [("baseline", "baseline", model), ("zhuge", "zhuge", model)]
    sensitivity = Model(deepcopy(model.data))
    sensitivity.parameters["raid_threshold"] += 1
    cases.append(("zhuge-sensitive", "zhuge", sensitivity))
    report = ["# 荆州对照实验", "", "以下结果来自人工规则模型，数值不代表历史概率。",
              "三组使用相同决策：授权北伐 → 继续攻城 → 下令撤军。", "",
              "| 实验 | 袭击门槛 | 荆州控制 | 关羽状态 | 粮秣 | 停止原因 |",
              "| --- | --- | --- | --- | --- | --- |"]
    runs = []
    for name, scenario, case_model in cases:
        session = Session(case_model, scenario)
        run_choices(session, DEFAULT_CHOICES)
        session.save(output / f"{name}.json")
        facts = session.facts
        label = case_model.data["scenarios"][scenario]["label"]
        if name.endswith("sensitive"):
            label += "（提高袭击门槛）"
        report.append(f"| {label} | {case_model.parameters['raid_threshold']} | {OWNERS[facts['jingzhou_owner']]} | "
                      f"{STATUSES[facts['guan_yu_status']]} | {facts['supplies']} | {session.stop_reason or 'script_complete'} |")
        runs.append((name, session))
    report += ["", "提高门槛意味着敌方能突破更强的防备，用来检查留守结论对规则假设的敏感性。", ""]
    for name, session in runs:
        report += [f"## {name}", "", summary(session), ""]
        for event in session.events:
            report.append(f"- 第 {event['day']} 天：{event['label']}（{event['status']}）。")
        report.append("")
        replay(session.trace())
    if jar:
        report += ["## Sabre 同模型的单角色规划", "", "导出授权北伐后的状态，让孙权规划下一批行动。", ""]
        for name, scenario, case_model in cases[:2]:
            session = Session(case_model, scenario)
            session.step("launch_campaign")
            (output / f"{name}.sabre.txt").write_text(export_problem(session), encoding="utf-8")
            result = run_sabre(session, jar)
            (output / f"{name}.sabre.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            report.append(f"- {name}：{result['status']}；计划：{' → '.join(result['plan']) or '无'}。")
        report.append("")
    text = "\n".join(report) + "\n"
    (output / "comparison.md").write_text(text, encoding="utf-8")
    return text


def interactive(session: Session) -> None:
    print("《异章：荆州》：你扮演刘备。数值是局部模型的抽象单位。")
    while not session.stop_reason:
        known = session.beliefs["liu_bei"]
        print(f"\n第 {known['day']} 天 · 荆州属{OWNERS[known['jingzhou_owner']]} · 粮秣 {known['supplies']}")
        choices = session.available()
        if not choices:
            print("当前没有可行命令，实验暂停。")
            break
        for number, action in enumerate(choices, 1):
            costs = []
            for effect in action["effects"]:
                if effect["operation"] == "add" and isinstance(effect["value"], int) and effect["value"] < 0:
                    label = {"supplies": "粮秣", "shu_resources": "资源", "reserve_troops": "预备队", "rear_troops": "后方兵力"}.get(effect["fact"])
                    if label:
                        costs.append(f"{label} {-effect['value']}")
            detail = "，投入 " + "、".join(costs) if costs else ""
            print(f"{number}. {action['label']}（推进 {action['days']} 天{detail}）")
        try:
            value = input("输入编号，或 q 退出：").strip()
        except EOFError:
            break
        if value.lower() == "q":
            break
        if not value.isdigit() or not 1 <= int(value) <= len(choices):
            print("请输入列表中的编号。")
            continue
        events = session.step(choices[int(value) - 1]["id"])
        # Secret actions stay in the developer trace; player sees observed events.
        for event in events:
            if event["status"] == "executed" and "liu_bei" in session.model.action(event["action"])["observers"]:
                show_events([event])
            elif "liu_bei" in event["learned"]:
                # Learning that front-line pressure changed does not reveal a secret pact.
                updates = event["learned"]["liu_bei"]
                if "wei_pressure" in updates:
                    print(f"  第 {event['day']} 天 · 前线报告：敌方压力升至 {updates['wei_pressure']['after']}。")
    print(summary(session))


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="AlterTale · 异章：荆州局部反事实实验")
    commands = parser.add_subparsers(dest="command", required=True)
    compare = commands.add_parser("compare", help="运行基线、留守与假设敏感性对照")
    compare.add_argument("--output", type=Path, default=Path("artifacts/jingzhou"))
    compare.add_argument("--raid-threshold", type=int)
    compare.add_argument("--sabre-jar", type=Path)
    play = commands.add_parser("play", help="进行一条路线，或交互扮演刘备")
    play.add_argument("--scenario", choices=["baseline", "zhuge"], default="zhuge")
    play.add_argument("--choices", default=DEFAULT_CHOICES)
    play.add_argument("--interactive", action="store_true")
    play.add_argument("--raid-threshold", type=int)
    play.add_argument("--output", type=Path)
    rerun = commands.add_parser("replay", help="验证保存的完整世界状态及因果记录")
    rerun.add_argument("trace", type=Path)
    export = commands.add_parser("export-sabre", help="导出某个 NPC 的下一步规划问题")
    export.add_argument("--scenario", choices=["baseline", "zhuge"], default="zhuge")
    export.add_argument("--after", default="launch_campaign")
    export.add_argument("--actor", choices=["sun_quan", "cao_cao"], default="sun_quan")
    export.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "compare":
            print(comparison(args.output, args.raid_threshold, args.sabre_jar))
            print(f"报告与可回放记录：{args.output}")
        elif args.command == "play":
            session = Session(make_model(args.raid_threshold), args.scenario)
            if args.interactive:
                interactive(session)
            else:
                run_choices(session, args.choices)
                show_events(session.events)
                print(summary(session))
            if args.output:
                session.save(args.output)
        elif args.command == "replay":
            session = replay(json.loads(args.trace.read_text(encoding="utf-8")))
            print("回放一致：" + summary(session))
        else:
            session = Session(make_model(), args.scenario)
            run_choices(session, args.after)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(export_problem(session, args.actor), encoding="utf-8")
            print(f"已导出：{args.output}")
    except (RuleError, OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        parser.exit(2, f"错误：{error}\n")
