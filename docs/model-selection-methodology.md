# 开发流程模型选择方法论

> **定位:这是 rationale(为什么),不是行为的权威源。** ai-bridge 的 skill
> (`skills/route`、`skills/smart-plan`、`skills/xreview`、`skills/ai-model` 等)才是
> 实际运行的、行为的**唯一权威源(SPOT)**。本文档解释背后的取舍与原理,供人阅读;
> 二者若冲突,**以 skill 为准**,并回来刷新本文档。本文档定期刷新,不必与 skill 逐字同步。
> (2026-06-16 从 collab-runtime 迁入本仓——方法论属于实现它的插件,不属于消费方仓库。)
>
> **2026-07-17 勘误指针**:第二评审席的席位节奏已统一为 xreview「Seat cadence」
> (SPOT)——第二席(Gemini;gemini 场景为 Opus)只坐**每个 gate 的首轮**,R2+ 由
> GPT 单席锚定;`-gpt` 降级面板例外(全轮双席)。文中旧的「plan R1 + closing
> gate only / middle rounds GPT-solo」等表述均被其取代,以 skill 为准。
> 依据:2026-06/07 月度实证(19/21 误报为 Gemini 且集中于修复验证轮;真实捕获
> 集中于首次入席),同批新增:振荡出口、gate 接线 `--verdict` 强制、相位 ≤8 task 硬顶。
>
> 定稿于 2026-06-11，源自 CCS modular refactor（Phase A）的实践。
> 适用范围：所有 spec → plan → subagent 执行 → review 的开发流程；不限于 CCS。
> 从 Phase B 起，每个 plan 的 task 必须带「复杂度」字段（低/高）+ 可选「critical」旗标，执行时按 复杂度 × 当期执行场景查 §3.2 得出模型；critical 正交，= 抬档 + 更小心 + 该 task 独占一个 phase（不再触发 task 级审）。

## 0. 一句话总纲

**智力跟着判断空间走，档位跟着阻力走，配额池按职能分工。**

模型选择不是"重要的任务用好模型"，而是回答三个独立的问题：

1. 这一步还剩多少**判断空间**？（决定模型强弱）
2. 这一步的**反馈有多贵**、阻力有多大？（决定推理档位）
3. 这一步消耗**哪个配额池**、买到的是什么职能？（决定厂商）

三个问题答案互相独立——存在"极重要但 Sonnet medium 就够"的任务（计划已含完整代码的切换前置准备），也存在"不重要但值得 max"的任务（顽固红灯第三轮）。

---

## 1. 四条分配原则

### P1：智力放在计划里，执行就可以便宜

判断空间是守恒的：要么在写计划时花掉，要么漏到执行时被迫花。plan 用 planner 角色（现 Opus 4.8 high；Fable 退役前为 Fable medium–high）写到"带完整代码 + 预期输出"的密度，执行 task 就退化成"誊写 + 跑 verify + 提交"，Sonnet 完全够格。

**计划质量是模型降级的前提。** 如果 plan 只写到"重构 X 模块"这种意图层，执行模型就要自己做架构决策——这时派 Sonnet 不是省钱，是把智力花在了错误的位置还要返工。反过来说：发现执行 subagent 频繁需要"自由发挥"，那是 plan 写薄了的信号，回去补 plan，而不是给执行升模型。

### P2：配额分池——Claude 池养"判断"，GPT/Gemini 池养"对抗"

- **Claude 池**（Opus/Sonnet 共享 5x 池；Fable 已退役）：承担一切需要"懂这个仓库、懂这次意图"的判断——写 spec/plan、编排、逐 task 验收、review 仲裁、疑难修复。编排用 Opus 4.8 medium，planner（spec/plan/架构）用 Opus 4.8 high。
- **GPT 池**（codex CLI，独立配额，**但同样可能见底**）：跨厂商 review 的主力；默认场景下兼任执行池（见 §3.2 执行场景）。
- **Gemini 池**（独立配额，**当前不是瓶颈**）：两个职能——对抗 reviewer（在**最重的关口**参与,**不是每轮/每节点**:多轮 plan 评审只上 R1+收尾门、中间轮 GPT 单席,见 §4 Layer 0 席位表;账本上 Gemini 值窄+屡幻觉 finding/漏 BLOCKER/rogue 改树,故降频)+ 上下文苦力（P4 的消化外包）。

跨厂商 review 的真正价值是**视角差**——不同模型的盲区不重叠——而不是"多跑一遍"。同厂商再 review 一轮，盲区和编排会话高度重合，边际价值低。

### P3：额外 review 的价值在视角差，不在重复

编排会话对每个 task 本来就做两段式 review（spec 符合性 + 代码质量），这是**连续层**，零额外成本。在此之上每加一轮 review，必须回答"这轮带来了什么新视角"：

- 同厂商加一轮 → 基本冗余，不加。（注意"同厂商"看的是**执行方**：执行方是 GPT 时，编排的 Claude 两段式本身就构成跨厂商视角；GPT 再 review 自己写的代码反而是同源的。）
- 跨厂商加一轮 → 盲区互补，加在关键节点；
- 配额不构成瓶颈的厂商（当前是 Gemini）→ 在**最重关口**(plan R1/phase 边界/收尾门)参与,视角差近乎白送；但**多轮 plan 评审中间轮不上**(GPT 单席),因其账本值窄+仲裁开销高(见 §4 Layer 0)；
- 但"免费"不等于无成本：每轮 review 的产出都要编排仲裁，**仲裁烧的是 Claude 池**——所以低复杂度 task 仍不加额外 review，约束从配额成本变成了仲裁带宽。

### P4：上下文外包——配额消耗不只在"谁思考"，也在"谁读垃圾"

大文件消化、日志/dump 分析、全仓扫描、外部资料检索这类工作，判断空间≈0 但上下文消耗巨大。让编排会话自己读是**双重浪费**：烧 Claude 池，还污染编排上下文窗口——窗口被原始材料挤占后，后续判断质量下降，而**窗口是比配额更贵的资产**。派 Claude subagent（如 Explore）读能隔离窗口，但池子照烧。

外包给无瓶颈池（agy/Gemini）一次买到两个收益：**池子不烧 Claude，窗口只回摘要不回原文**。消化类工作用 Flash 档就够，Pro high 留给 review。

边界条件——能不能外包看**产出的性质**，不看材料的大小：

- 产出是**事实提取**（"这 5000 行日志里有哪些 error 簇"、"这个库的 API 怎么用"、"全仓哪些地方引用了 X"）→ 可外包；错漏由后续 verify / 交叉验证兜底。
- 产出是**判断输入**（为写 plan 做的架构理解、为仲裁做的代码精读）→ 留在 Claude 池。这类阅读的价值在读完之后的判断质量，外包给不懂仓库意图的模型，摘要会把关键细节当噪声丢掉——省下的配额会以更贵的形式（错误的 plan）还回来。

---

## 2. 两个决策轴

### 轴一：判断空间 → 模型强弱

| 判断空间 | 特征 | 模型 |
|---|---|---|
| 无判断纯消化 | 大文件/日志消化、全仓扫描、资料检索，产出=事实摘要 | Gemini Flash（agy 外包，见 P4） |
| 低复杂度 | plan 含完整代码/预期输出，执行=誊写+verify | 按 §3.2 场景的低档（medium） |
| 高复杂度 | plan 给了方向但留了现场决策（调参、分类、与现状核对） | 按 §3.2 场景的高档（high；非换模型） |
| 开放空间 | 写 spec、写 plan、架构仲裁、解空间宽 | planner = Opus 4.8 high（任何场景下都不降；档位按轴二定）|

### 轴二：阻力 × 反馈成本 → 推理档位

档位买的是**隐藏推理预算**：回答前探索多少条假设、回溯多少次、同时持有多少约束。max 的收益集中在 **搜索空间大 × 反馈贵 × 一次做对价值高** 的交集上，三个条件缺一个就是空转：

- 搜索空间已被压扁（执行类）→ max 是用狙击镜钉钉子；
- 反馈便宜（有 verify 脚本 + 红线 + typecheck 的紧反馈环）→ "medium 试错两轮"几乎总比"max 一次想对"又快又省，环境会纠错；
- 此外 max 回合延迟明显变长，拖垮交互节奏，且 Opus 的 max 思考烧共享池很快。

**升级策略（档位 + 模型双阶梯）**：起点是（场景 × 复杂度）格子。遇阻时**按模型升级到 Opus**，不是把同一模型换更高档重试：

- 非 Opus 场景遇阻 → **Opus high** → 仍不破 → **Opus max**；
- Opus 场景遇阻 → 直接 **Opus max**（只有 Opus 自己升上来的才到 max）。

即：任何池先交给 Opus **high**，唯 Opus-on-Opus 才 max。升级跟着问题的**阻力**走，不跟**重要性**走——重要但顺畅的工作，场景默认档 + verify 环就是最优解。**遇阻才升，不预防性 max**；唯一的预防性 max 是不可逆切换前的预演审计（写进 plan，见 critical）。

#### max 的五个法定场景

1. **不可逆切换前的预演审计**：反馈是"生产坏了"的步骤（删目录+切计划任务、secrets 瘦身、下线服务端口），切换清单的最后一遍找漏项审计值得 planner（Opus）max 一次性过；跨厂商侧对应 GPT xhigh 复核 cutover diff。**这类 max 直接写进对应 plan 的步骤里**，不靠现场临时判断。
2. **顽固 bug 的第三轮**：medium 两轮假设-验证打不穿的红灯再升档。历史深 bug（候选覆写滑动窗口、看门狗盲区、测试 seed 顺序）都是"要把整个系统的异步行为同时装在脑子里"的大搜索空间问题——max 的主场。但大多数红灯 medium 一轮就破。
3. **关键架构仲裁**：解空间宽、约束互相打架、错了影响数年的决策（bus vs hub 级别）。
4. **review 争议仲裁**：跨厂商 reviewer 的发现与编排判断在 P0 边界冲突时，对**争议点本身**上 max 裁决——只裁争议点，不重审全 diff。
5. **隐私/安全边界变更**：动 privacy invariants、secrets 处理路径的 diff，错漏代价不对称。

---

## 3. 角色—模型映射（按执行场景切换）

### 3.1 不随场景变的部分

| 角色 | 模型（档位） | 理由 |
|---|---|---|
| 写 spec / 写 plan / 架构决策（planner 角色） | **Opus 4.8（high）** | 智力密度最高的环节，省不得；任何场景下都不降级。~~Fable 5~~ 已退役，按降级路径改派 Opus 4.8 并档位上调一级（medium→high）|
| 执行编排 + 逐 task 两段 review | **Opus 4.8（medium）**，主会话 | 判断集中地：验收产出、对照 spec、决定调整 |
| 关键节点 review | **Gemini 3.1 Pro（high）在最重关口参与** | plan R1+收尾门/phase 边界/切换 diff（**已无 critical-task 级审**——critical 改为独占 phase,见 §4/§5）；**多轮 plan 评审中间轮 GPT 单席**(Gemini 降频,见 §4 Layer 0) |
| 上下文密集消化/检索 | **Gemini Flash（agy）**，只回摘要 | 判断空间≈0、上下文巨大；省 Claude 池 + 保编排窗口（P4） |
| review 发现的修复 | 仲裁归编排（Opus）；低复杂度修复按当期场景派发，微妙修复编排直改 | 跨厂商 reviewer 不懂仓库惯例，误报率不低——先仲裁再修 |

**模型退役降级路径（已激活）**：本表按"角色"定义，模型名是角色的当前赋值，**单点维护在 ai-bridge 的 `route` skill 的角色→模型表，其余一切引用角色名**。**Fable 5 已退役（2026-06-11）→ planner 角色赋值改为 Opus 4.8、档位上调一级（medium→high）作为智力补偿。** 操作上：改 `route` skill 角色表一行 + 重装 plugin 刷 cache，全链生效。

### 3.2 执行模型场景（`/aibridge:ai-model` 切换）

执行量（消耗大头）派给谁，定义为四个**执行场景**——语义是"优先用哪个模型执行"，切换的常见动因是配额水位（Claude 池是慢性瓶颈，所以默认 GPT 场景），但场景本身按模型命名。状态存 `~/.claude/ai-model`（单行：gpt/sonnet/gemini/opus，全局单一事实源），routing 每次派发现读，所有会话即刻生效。

**场景定执行池，复杂度定池内档位**（低→medium，高→high）。执行方在场景内**保持一致**，高复杂度任务不再偷偷跳到更贵的模型——那是升级（轴二）该干的事。

| 场景 | 低复杂度 | 高复杂度 | 关键节点 review |
|---|---|---|---|
| **GPT（默认）** | GPT 5.5 medium | GPT 5.5 high | GPT 5.5 high + Gemini 双签 |
| **Sonnet** | Sonnet 5 medium | Sonnet 5 high | GPT 5.5 high + Gemini 双签 |
| **Gemini** | Gemini 3.1 Pro (High) | **Sonnet 5 high** | GPT 5.5 high + Opus medium |
| **Opus** | Opus 4.8 medium | Opus 4.8 high | GPT 5.5 high + Gemini 双签 |

通则：

- **复杂度映射档位，不映射换模型**——选了场景就把执行压在该池，低/高只调 medium/high；Opus 是遇阻升级目标（轴二），不是高复杂度任务的默认落点。这避免了"选 Sonnet 省池子、判断型却跳 Opus"的过载。
- **Gemini 是弱执行方**：低复杂度都要 Pro **High**，高复杂度直接出池到 **Sonnet high**（Gemini high 不够）。故 Gemini 场景只把*容易*的活外包给 Gemini。
- **铁律:GPT 有额度就**必须**在 review 面板,不是"优先"是"强制"**（含 GPT 场景，自审但强；跨厂商由 Gemini+编排提供）。**一个在跑的 gating review(Layer 0/phase 边界/收尾闸),只要 GPT 可用就必含 GPT;单厂 Gemini 顶替 GPT 做 gate 是禁止的**——那不是"从轻",是丢了金标准的残废 review。Gemini 只能是 GPT **旁边**的第二视角,绝不顶替。**"评审从轻"的唯一合法杠杆是频率(= phase 粒度**:phase 切小则 phase 边界审跑得勤;**已无 task 级审**——TDD 兜 per-task,critical task 靠独占 phase 早覆盖),**绝不是把 GPT 换成更便宜的单 Gemini**;真要省就**整轮不跑**(信 verify),不是跑个残废的。唯一移除 GPT 的是 `-gpt`(额度死)→换 **Opus** 补位,**不是**换单 Gemini。单厂 `gemini` 参数只用于 ad-hoc 一次性二意见(`/aibridge:gemini`),绝不用于 managed gate。**注意 GPT 单席≠单厂 Gemini**:plan 多轮评审里 **Gemini 只上 R1+收尾门、中间轮 GPT 单席**(Gemini 账本值窄+多幻觉 finding,见 Layer 0 条);GPT 单席合法(金标准在+编排两段构成跨厂),被禁的只是**丢掉 GPT**。agy flake 时跳过该轮 Gemini(GPT 兜),不换 Opus(换 Opus 只给 -gpt)。
- **任何场景下 Claude 池都保住四件事**：spec/plan/架构（planner = Opus 4.8 high）、编排+逐 task 验收（Opus）、review 仲裁（Opus）、微妙修复。

**净效果**：Claude 池的消耗钉死在写计划和编排两个高杠杆点；执行量按场景在四个模型间切换；Gemini 作为无瓶颈池承担**关键关口(非每轮)的对抗 review** + 上下文消化，同时给 Claude 池和编排窗口减负。

---

## 4. Review 三层 + 收尾闸

**不是每次实施完都要单独一轮 review。** 三层 + 收尾闸代替"每次都来"，按时机从早到晚：

0. **plan 级跨厂商（Layer 0，最早最高杠杆）**：plan 在任何 task 派发前先过跨厂商 review（`smart-plan` Phase 4），循环至绿才放行执行。**面板=固定外厂 GPT+Gemini,不用 §3.2 的 per-scenario 表**——那张表按**场景执行方**定面板(给 code review 用),而 plan 的作者**永远是 planner(Opus),与场景无关**;套执行方逻辑会在 gpt 场景把 GPT 漏掉(实测 bug)。plan 评审 GPT 尤其不能丢:唯一同家族替补是 Opus、与 Opus planner 盲区相关、独立性弱(实测 GPT 曾独抓两厂全漏的 MAJOR)。`-gpt` 时=Gemini+clean-Opus 但**响亮声明这轮独立性薄**(Opus 评审与 Opus planner 同家族)。**判断密度最高的产物恰恰原先零跨厂商审**——智力前置到 plan（P1），review 价值也该前置。审的是**设计**不是实现，八维（权威清单见 `smart-plan` Phase 4）：① 拆分与排序 ② **完整性(锚定 spec 目标)**——漏的是 spec 要求的 task/边界/rollback，不是"能想到的一切" ③ route 字段诚实度 + critical 独占 phase（complexity 评实没、critical 漏标没、critical task 是否独占 phase——唯一审路由**输入**本身的地方）④ 接口/契约健壮性（地基型 task 下游全压在上面）⑤ 验收契约充分性（每 task 有真 verify）⑥ spec 对齐 ⑦ 视觉契约接线（有 demo/mockup 时）⑧ reality premise 接地。设计 bug 在此抓到改一行 plan,漏到 code 要重做一个 phase——**性价比最高的一次 review**。
   **不是一份 plan 只跑一轮**:复杂 plan 合理地需多轮收敛(实证:trend-breakdown 6 轮)。**GREEN=最新一轮无 BLOCKER/MAJOR**(MINOR 记录并带进执行期当 tracked 清理,不追到零)——旧的"追 0 findings + 干净确认轮"白烧尾轮(3→3→0/1→1→0),砍掉省 ~1 轮(常 4→3)。**R1 全量、R2 起 delta**(只审上轮 findings 修复 + plan diff 段;后段真抓获本就在 delta,全量重读不变段=纯开销;仅 plan 评审,收尾闸仍全 diff 因代码跨缝回归)。**flake 不计一轮**(agy 空 stdout 重试/GPT token_revoked 换席在**同轮**内消化,只有产出 findings 的跨厂过关才进轮次)。**Gemini 席位=R1+收尾门,中间轮 GPT 单席**(账本:Gemini 值窄=设计眼 finding、却屡出幻觉 finding 纯仲裁开销+漏 GPT 抓的 BLOCKER+rogue 改树;GPT 单席非违铁律=金标准在+编排两段构成跨厂;独立性在 R1 与终局两最重关口保留足够);agy flake 直接**跳过该轮 Gemini**(GPT 兜),不启 clean-Opus 换席(那只给 -gpt)。**轮数不是过度设计信号,收敛轨迹才是**——但**硬性 8 轮上限**:8 真轮未 GREEN→**停,升级给人**定夺(继续/重构 spec/中止),是**升级触发非自动放绿**(13 轮 churn 该撞机制,不该自然磨停)。防 churn 另两闸:**(a) 加法型 finding 接受前 ground**(对 spec 非目标+源码核验,已否决就驳,meeting-summary C6 栽此);**(b) 收敛轨迹记 verdict**(每真轮 findings 数+严重度+架构落定否;计数下降健康,上升因移除=健康/因新增=scope creep 警报)。
1. **连续层（零额外成本，逐 task）**：**TDD（先写失败测试→实现→过）** + verify 脚本 + 红线 + typecheck 是机械正确性的地板；编排会话（Opus）对每个 task 做两段式 review（spec 符合性 + 代码质量）。TDD 兜住"作者想到要测的" per-task 正确性;编译器 + 下一个 task 的 typecheck 免费抓**类型级**接口破坏。这一层本来就有，不算额外。
2. **phase 边界（执行期唯一的跨厂商层）**：完整 phase diff 的跨厂商 review——按 §3.2 当期场景面板（默认 GPT 5.5 high + Gemini 双签），过了才打 tag、进部署决策；切换 diff 升 GPT xhigh。**取消原"每个 critical task 一轮跨厂审"**(太重;TDD 已兜 per-task,跨厂真价值在集成/设计——接口/契约/多包接线,这些**接线时才现**、不在单 task 内)。**critical 旗标现只 = 抬档 + 更小心 + 信号 planner 把该 task 隔离成独占一个 phase**(§5),使其 phase 边界审在**任何消费者接线前**就跑——早覆盖那类"类型正确但语义错"的接口缺陷(编译器抓不到、下游会复利)。**频率主旋钮 = phase 粒度**:phase 切小,这层跑得勤、问题新鲜时批量逮;高风险/地基 task 独占 phase 由 **Layer 0 强制查**(取代原自动 task 审的唯一保障)。
3. **收尾闸:全量实现 xreview（Layer 3-final）**：plan 最后一个 task 绿后**不立即收工**,对**整份 plan diff**(`git diff <plan-base>..HEAD` 对 spec)再跑一轮跨厂商 review,循环至绿才算 done。实践验证:它抓到 phase 边界结构上抓不到的问题——跨 phase 集成断裂、整体才显形的不一致、两个 phase 各建一半的缝。**这是 Layer 0 的执行侧镜像**:Layer 0 在写任何代码前审整份 plan,收尾闸在 done 前审整份实现;两者都是全产物跨厂商、都 loop-until-green。同样套加法闸(全量 reviewer 一样会"还应建 X")。**"重跑全 diff"是字面契约,聚焦复审不能替代**:每轮收尾闸重审**整份** diff,不是只复查修过的那几条 finding——只看补丁处("A/B/C 修了没")**不算过闸**,因为一个修复可能在别处回归或破缝,而全量这一遍正是为这种集成级覆盖存在的,把它缩到补丁范围=重新打开它本要堵的盲区。只有完整全 diff xreview 返回 GREEN 才清闸。(这是对"聚焦复审"通则的**刻意例外**——per-finding 仲裁/Step-5 升级缩到争议点,因为它们不是 gate;收尾闸是 gate,故永远全 diff。)范围=plan 执行(托管回环);one-shot 调用无整体 diff 可收。

**Layer 0 遇红**：确认的设计缺陷回 planner（Opus 4.8 high）修订；深层架构争议归编排（open-ended 仲裁不离编排）；**真 spec 漏洞回 Phase 1 重开 spec,不在 review 里现造机器**。复审至绿才放行执行——plan 不进托管回环直到 Layer 0 干净。证据/仲裁同 code xreview（各厂商落 `plan-<name>-<vendor>.md`，编排出 `plan-<name>-verdict.md`，不让外厂互相合并）。**干净终态产物(SPOT)**:plan 收敛到干净终态,逐轮修订史留在 `plan-<name>-verdict.md`,**不塞进 plan**——plan 背"加了X又删X"的考古会把 review 循环漏进交付物、淹没实施者要建的东西(meeting-summary 反面、trend-breakdown 正面)。**加法偏置是 review 格式的结构性问题,不止 plan 层**:code review 也有镀金倾向,同一条"reviewer 核查 conformance、不得扩张合同"适用——合同 = spec(+code review 时再加该 plan task)。

### 修复与仲裁流程

```
跨厂商 reviewer 提出 → 编排（Opus，Claude 池）仲裁
  ├─ 误报 → 直接驳回，写明理由（不许照单全收）
  └─ 确认 → 按性质派发
       ├─ 低复杂度修复 → 按当期场景派发
       └─ 微妙修复 → 编排直改
     → 重跑 verify → 只对争议点复核（不重审全 diff）
```

仲裁必须回到 Claude 池：reviewer 有视角差优势，但不懂仓库惯例和本次意图，处置权在作者侧。

---

## 5. 落地机制

1. **plan 的 task 带「复杂度」字段 + 可选「critical」旗标**（从 Phase B 起为正式格式）：逐 task 标 `低`/`高` 复杂度，外加正交的 `critical`（= 不可逆 ∪ 地基型）。复杂度→档位；**critical → 抬档 + 更小心 + 该 task 必须独占一个 phase**（不再触发 task 级跨厂审——那层已取消,太重;critical task 的早覆盖改由**其独占 phase 的边界审**提供,在任何消费者接线前就跑,逮"类型正确但语义错"的接口缺陷)。二者正交（一个 task 可"低复杂度 + critical"）。**critical task 埋进多 task phase = Layer 0 的 BLOCKER 级发现**(取代原自动 task 审的唯一保障机制)。执行时按「复杂度 × 当期场景」查 §3.2。**不在 plan 里写死模型名**——执行场景是执行期变量，写死会陈旧。
2. **max 审计写进 plan 步骤**：不可逆切换前的预演审计作为显式步骤出现在 plan 里，标注档位。
3. **关键检查上提**：subagent 执行的删除/收尾类 task，"全仓零引用"等终局检查由编排会话复核，不下放。
4. **消化外包的固定姿势**：编排遇到大块原始材料（长日志、dump、生成代码、外部文档）不直接读，丢给 agy 消化、只回摘要（`agy -p`，Flash 档；ai-bridge 建成后走其消化工具）。判断输入类阅读除外（P4 边界条件）。
5. **续接子代理:handoff-first,resume 为闭合例外**：跨 dispatch 续接开发任务默认**全新 spawn + handoff 简报**,不 resume 前一个执行体——干净窗口胜过全上下文（P4:resume 把死胡同与啰嗦工具输出一起拖回,污染比配额更贵的窗口）。**handoff 简报五要素**:① 已完成到哪 task/commit ② 还剩什么 ③ 试过且失败的路 ④ 关键 `file:line` ⑤ 验收契约;一份简报同时承载同模型续接与跨模型升级。**resume 仅限两种、闭合不可扩**:(1) 同一 diff 的 review 改修、同 vendor(GPT `ai_exec_start`+`resume`,codex 会话即该 diff 工作态,=托管回环遇红路径);(2) 你正逐回合紧驱动、不跨 compaction 的单个紧耦合任务(Claude `run_in_background` 保活 + SendMessage)。非这两种一律 handoff——"感觉需要上下文"不是第三种;尤其不为"下一个 plan task(每 task 干净窗口)/换模型(本就续不了)/前文走了死路/跨回合/Gemini(agy 无 resume)"而 resume。详见 ai-bridge `route` skill 的 Continuation 节。
6. **现实门(Reality gate)rationale**:全部 review 层(L0–L3+收尾闸)都在检「产物 vs spec」——读 plan 和代码;结构性盲区=从不检「产物 vs 现实」。每次 review 拦不住的中途 replan 都同构:代码对其前提正确、前提却偏离现实(prod 表空、部署 dist 陈旧、真实输入比 fixture 野)。合成 fixture 全绿、healthz 200、收尾闸 GREEN,线上照样坏——读更多代码关不掉这个盲区,只有真实证据能。故 done 前两道必查:①执行现场新鲜度(跑的确实是刚构建的代码,mtime/build_commit 断言,**healthz 活着≠新代码在跑**——陈旧 dist 曾让正确修复看起来无效、误诊数日);②一次真实数据 live smoke(非 fixture)。绿测试+绿收尾闸**不可宣称 done**;部署归用户时诚实降级表述("merged & review-GREEN,现实未验,待 deploy+live smoke"),两义务随 handoff travel 为 OPEN gate。纯重构无运行时表面则**显式**跳过(静默跳过会被读成"已过门")。plan 侧镜像=reality premise 接地(smart-plan Phase 2)。
7. **UI demo 沉淀为视觉契约 + 视觉决策断言**：有 demo 时它比文字 spec 信息量大却不在 SPOT 链里→实现者重新解读填空→落盘与 demo 相差颇多(与"假接入"同类:验收检了代理、没检真结果)。修=demo 存在时:① 按路径钉进 spec 作权威视觉源(SPOT);② 蒸馏**承重**视觉决策(信息层级/控件存在/分组顺序/各状态有别/可供性)为显式断言,**标契约 vs 示意**(占位文案/默认色等示意细节非契约,整张像素化会过度约束滚镀金 churn);③ UI task 带视觉断言作验收、verify 在 **DOM/结构级**断言渲染输出(非截图像素 diff、非"组件文件存在"代理);④ xreview 加**视觉一致性**维度(把 demo+渲染页给 reviewer 判断有没有兑现承重决策,违的引承重断言、示意细节不报);⑤ smart-plan Phase 4 加视觉契约维度、Phase 3 出口检查 UI task 接了视觉契约。两层检法=DOM 断言(确定地板)+ xreview 判断(地板兜不住的气质层级),不做像素 diff。

### Phase A 实例标注

- Task 1–10、14 → 低复杂度（誊写+verify；默认 GPT 场景下即 GPT 5.5 medium）
- Task 11（红线规则调参+与盘点核对闸门）、Task 13（配置分类）→ 高复杂度（默认 GPT 场景下即 GPT 5.5 high）
- 删除/切换类、以及后续依赖的地基型 task → 另带 `critical` 旗标（抬档 + 独占一个 phase,不再另加 task 级审）；Task 8/9 收尾的"全仓零引用"检查 → 编排会话复核

---

## 6. 反模式清单

| 反模式 | 为什么错 |
|---|---|
| 按"重要性"挑档位 | 重要但顺畅的工作 medium+verify 就是最优解；档位跟阻力走 |
| 预防性 max | 大多数红灯 medium 一轮就破；max 预算花在了空转上 |
| 给薄 plan 配强执行模型 | 智力花错位置还要返工；正解是回去补 plan |
| 同厂商加额外 review 轮 | 盲区与编排重合，边际价值≈0；额外的那轮应该跨厂商 |
| 照单全收跨厂商 review 意见 | reviewer 不懂仓库惯例，误报率不低；必须先仲裁 |
| 给任何 task 加 task 级跨厂审 | 该层已取消——TDD+连续层兜 per-task,跨厂真价值在集成/设计(接线时现);critical task 靠独占 phase 早覆盖,不靠逐 task 审 |
| 配额吃紧仍不切场景 | 执行量是消耗大头；水位变了按 §3.2 切场景（`/aibridge:ai-model`），别等见底 |
| 在 plan 里写死模型名 | 执行场景是执行期变量；plan 标类型，模型执行期查表 |
| review 面板全是执行厂商 | 自审失去视角差；面板必须含非执行厂商（Gemini 场景由 Opus 补位） |
| 争议仲裁时重审全 diff | 只裁争议点；全量重审是把 max 预算摊薄到无效面上 |
| 用强模型执行来补偿计划缺陷 | 判断空间守恒：漏到执行期的判断比计划期更贵、更不可控 |
| 编排自己吞原始大材料 | 烧池子且污染编排窗口——窗口是比配额更贵的资产；外包消化，只回摘要（P4） |
| 把判断型阅读外包省额度 | 摘要会把关键细节当噪声丢掉；为 plan/仲裁做的理解必须留在 Claude 池 |

---

## 7. 速查决策树

```
这一步是什么？
├─ 写 spec/plan/架构决策 → planner = Opus 4.8 high（解空间极宽或不可逆 → max）
├─ 大材料消化/全仓扫描/资料检索（产出=事实摘要）→ 外包 agy（Gemini Flash），只回摘要（P4）
│   └─ 但产出是 plan/仲裁的判断输入 → 不外包，留 Claude 池
├─ 执行 task —— 先读当期场景（§3.2，~/.claude/ai-model），复杂度定档：
│   ├─ GPT（默认）：低 → GPT 5.5 medium；高 → GPT 5.5 high
│   ├─ Sonnet：低 → Sonnet medium；高 → Sonnet high
│   ├─ Gemini：低 → Gemini Pro High；高 → Sonnet high（Gemini 弱，出池）
│   └─ Opus：低 → Opus medium；高 → Opus high
│   └─ critical 旗标（正交，=不可逆∪地基）→ 抬档 + 独占一个 phase（不再 task 级审）；不可逆切换审计 → Opus max
├─ review
│   ├─ plan 级（Layer 0）→ plan 出口跨厂商审设计（smart-plan Phase 4，固定外厂面板）；查 critical task 是否独占 phase；遇红回 planner/编排修订至绿才放行执行
│   ├─ task 级 → TDD（失败测试→实现→过）+ 编排（Opus）两段式（连续层，免费）；**无 task 级跨厂审**
│   ├─ phase 边界 → 按场景面板（默认 GPT high + Gemini 双签）；切换 diff 升 GPT xhigh；critical task 独占 phase 使其在此早覆盖
│   └─ 收尾闸 → 全量实现 xreview（whole diff，loop-until-green）
├─ 修复
│   ├─ 先仲裁（编排，Opus） → 误报驳回
│   ├─ 低复杂度 → 按当期场景派发
│   └─ 微妙 → 编排直改
└─ 卡住了？（升级走模型阶梯，非同模型换档）
    ├─ 非 Opus 场景遇阻 → Opus high
    ├─ Opus high 仍不破 → Opus max
    └─ Opus 场景遇阻 → 直接 Opus max（只对准病灶，不扩面）
```

---

## 8. superpowers 退役（2026-07-14）

Fable 5 后 superpowers 系列技能（brainstorming / writing-plans / TDD /
systematic-debugging）全局禁用。依据：这类技能的本质是给弱模型上的流程脚手
架，模型能力上来后每次调用烧的上下文买不回增量。但**禁用 ≠ 全部原生接管**，
四件套逐项记账：

| superpowers 技能 | 接管方式 |
|---|---|
| brainstorming | `/grilling` 逐题拷问 + smart-plan Phase 1 回写仪式（收敛=回写 spec；确认对象是 spec diff，不是对话） |
| writing-plans | smart-plan Phase 2 内建 plan 格式（自包含钉死，无外部依赖） |
| test-driven-development | route Step 4 执行契约（3 条反作弊规则随每次派发 verbatim 下发）。执行者是 GPT/Sonnet/Gemini——编排层模型升级碰不到它们；且 TDD 纪律对抗的是绿灯压力下的激励漂移，不是知识缺口，模型再强不自动免疫 |
| systematic-debugging | 零补偿：全局 CLAUDE.md 证据纪律 + production-incident-triage 已是用真实事故史调出的更强定制版，第三份违反 SPOT |

同日 `docs/superpowers/` 目录约定 hard-cut 为 `docs/reviews`（存量证据一并
搬迁，不留旧路径；`exec-reports` 等同级目录同样上提一层）。review 四层门
（L0 / 相位 / 收尾 / 现实）与此决策无关、照旧跑满——它们对抗的是作者自审
盲区相关性，模型升级不改变该相关性。

---

## 9. review/exec 异步 job 化（2026-07-16，0.13.0）

动因=实测同步阻塞调用的三类死法：① Claude Code stdio MCP **空闲超时默认
30min**（无响应即掐——whole-batch review 静默 30-40min 必死）；② 会话进程崩溃
（"resume with a fresh process"）连带杀 MCP server 与管道内 vendor 子进程，
整段 review 白烧；③ harness 报错重试 → 重新冷启动 agy → 聚簇 OAuth 风控暴露
（§已知）。调大 timeout 只治 ①，是补丁不是根治。

修=`ai_review_start`/`ai_exec_start` 毫秒级返回 job_id，detached runner 独立
进程执行、全状态落盘（跨会话可恢复：新会话 `ai_job_result` 直接取回已完成的
review，不重跑）；**幂等键**（kind+vendor+cwd+prompt+effort+paths）把重试映射
回原 job——同参数在跑=返回原 job_id，绝不双发。`ai_job_result` long-poll
300s（早返回使大窗口对短任务零代价；短调用一次 collect 完事，长调用几次廉价轮询）。digest 保持同步（分钟内）。
顺带根治:agy `--print-timeout` 原硬编码 15m（比 25min kill 计时器先到，长
review 的隐性杀手）→ 跟随 job 的 `timeout_minutes`。
