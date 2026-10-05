# AlterTale · 异章

> 改变一个选择，让故事重新演化。

AlterTale 是一个以小说为世界基线的剧情反事实游戏项目。玩家扮演故事中的角色，在关键决策点改变选择；系统根据当前世界状态、人物目标、认知与行动条件，逐步推演后续事件。

玩家操作的主要粒度是战略和剧情决策，例如北伐、撤军、调遣、谈判与结盟。

## 运行荆州 demo

需要 Python 3.11 或更新版本。从仓库根目录运行，无需模型 API 或第三方 Python 包。

```bash
# 扮演刘备，连续选择命令
python -m altertale play --interactive --scenario zhuge

# 运行基线、留守及假设敏感性对照
python -m altertale compare

# 回放并核对世界状态、认知和因果记录
python -m altertale replay artifacts/jingzhou/zhuge.json

# 验证规则、资源守恒、分支、信息限制和回放
python -m unittest discover -s tests -v
```

报告保存到 `artifacts/jingzhou/comparison.md`，三组完整记录保存为同目录的 JSON。

默认对照使用相同命令“北伐 → 继续攻城 → 撤军”。也可以改变选择：

```bash
python -m altertale play --scenario baseline \
  --choices launch_campaign,reinforce_rear,order_withdrawal
```

这是人工局部模型的实验结果；来源、假设和限制见 [模型说明](docs/model-notes.md)。

## 第一个 demo：《异章：荆州》

以《三国演义》的“关羽北伐襄樊—荆州危机—败走麦城”作为局部测试窗口，玩家首先扮演刘备。

比较两种起点：

- 原著基线：采用所选原著版本中这一时期的部署。
- 反事实起点：设定诸葛亮已提前留守荆州，重新推演后续事件。

第二种起点是实验性世界设定；诸葛亮到任的时间和调遣过程需要在模型中说明。模型需要计算留守对防御、外交、人员配置与其他地区的影响，不预设关羽必胜或荆州必然安全。

详细范围与验收标准见 [荆州 demo 说明](docs/jingzhou-demo.md)。

## 工作原则

- 世界状态负责记录事实，角色认知允许不完整或错误。
- 原著事件需要检查前置条件；条件变化后可以保留、变形或失效。
- 新事件需要有可追溯的行动条件、角色动机和状态变化。
- 每次推演推进到下一个重要事件或玩家决策点，再根据新状态继续。
- 原文事实、对原文的解释和实验模型假设分别记录，事实引用保留章节及版本定位。
- 小说是故事基线；反事实结果是模型下的可能发展。

## 开发顺序

1. 评估现成实现：用相同的小场景检查 Sabre 的规划能力、StoryWorld 的状态与分支管理，以及 There-and-Back 的结构抽取方法。
2. 手工建立荆州最小世界模型，运行基线和反事实对照。
3. 增加玩家连续决策、状态检查、回放与因果说明。
4. 接入语言模型，把经验证的事件写成剧情。
5. 用相关章节检验半自动结构抽取，再扩展故事范围和可扮演角色。

## 待评估的参考项目

| 项目 | 评估重点 |
| --- | --- |
| [Sabre](https://github.com/sgware/sabre) | 已定义行动、人物目标与认知下的事件序列规划 |
| [StoryWorld Engine](https://github.com/MaxfanO/storyworld-engine) | 世界状态、分支隔离、检查点与因果链记录 |
| [There and Back Again](https://github.com/alex-calderwood/there-and-back) | 从自然语言提取形式化故事模型的方法 |

采用依赖或复制代码之前，检查实现、接口、运行条件和许可证。技术栈与引擎尚未确定。

第一轮检查及实际运行结果见 [代码评估](docs/engine-evaluation.md)。当前运行器使用 Python 标准库，支持从同一 JSON 模型导出 NPC 规划问题给外部 Sabre：

```bash
python -m altertale compare --sabre-jar /path/to/sabre/build/jar/sabre.jar
```

Sabre 是单独获取的可选参考引擎，仓库未捆绑其代码或二进制。

## 当前状态

首个可运行实验：31 个状态字段、15 个行动/触发器、三个连续玩家决策的默认对照，以及可重复执行的状态和因果记录。当前模型覆盖约 42 天的演示路径，尚未接入语言模型、自动章节抽取或完整战役模拟。
