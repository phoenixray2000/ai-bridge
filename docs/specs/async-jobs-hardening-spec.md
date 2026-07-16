# async-jobs 硬化 spec(0.13.0 → 0.14.0,八件套)

> 来源:0.13.0 上线首日(2026-07-16)batch-E 收尾门实战暴露的缺口,经 grilling
> 逐项定案。每项含根因/实证/修法/验收。执行按 ai-bridge 惯例:实现 + offline
> smoke + GPT whole-diff dogfood 评审环(≤8 轮,GREEN=无 BLOCKER/MAJOR)+
> bump 0.14.0(package.json / plugin.json / marketplace.json 三处 + lockfile,
> **用 node 写,禁 PS5.1 Set-Content utf8——会写 BOM 炸 JSON.parse**)+
> `claude plugin update` 部署 + cache 标记校验 + 记忆回填。

## 背景事实(实证,写码前不必复查)

- batch-E 收尾门(206 文件/97 commits,`git diff 141874d7..7cce5e22`):
  GPT 首跑 27min 死于 OpenAI capacity(偶发,探针验证已恢复);Gemini 连败四次
  ——1× 85min 僵死(agy 本地 CPU 累计 19.9s、6s 采样零增量=死连接,靠人工采样
  确诊)+ 3× 90s 假完成(输出=字面 token `run_command`)。
- Gemini 连败根因(对照实验坐实):headless `--sandbox` 下命令类工具被
  **auto-denied**(agy stderr 原话:`a tool required the "command" permission
  that headless mode cannot prompt for, so it was auto-denied`),而收尾门
  prompt 要求 reviewer 自己跑 git diff → agy 静默死(exit 0 空 stdout)→
  恢复通道从会话库把被拒的工具名 `run_command` 捞出来冒充答案。
- 第五次 Gemini 用「物化 diff + 禁跑命令」prompt 重发后存活运行(修法验证)。
- 两会话对同一审查重发时 prompt 措辞不同 → 幂等键不命中 → 双 GPT xhigh 并行
  白烧(靠人工发现后 cancel)。

## 八项改动

### 1. `ai_job_list` 工具(跨会话找回 job)
- **缺口**:job_id 活在死掉会话的上下文里;幂等键要求逐字节同 prompt,压缩后
  的会话措辞必变 → 找不回、或重发不收敛(见背景:双 GPT 并行)。
- **修法**:只读工具,列最近 N 个 job(默认 20,参数 `limit`):id / kind /
  vendor / state / started_at / finished_at / evidence_path / report_path。
  读 jobs root 逐 dir readJob(经对账),按 started_at 降序。
- **验收**:smoke——造 3 个假 job 断言列表序与字段;handshake 工具名单加入。

### 2. `ai_job_result` 默认 `wait_seconds` 120 → 300
- **理由**:早返回使大窗口对短任务零代价;120 默认让常规审查 3-8 次 poll、
  收尾门 ~45 次。上限 600 不动。
- **验收**:schema default 改 300;smoke 不需新用例(默认值断言可加可不加)。

### 3. xreview 钉 timeout 表 + route 收尾门清单半行
- **表**(宁大勿小——天花板成本不对称:过大零代价、过小杀合法长审查全重跑):
  常规相位/plan 审查=默认 25(不传);收尾门 whole-diff=90;超大 batch
  (≥100 文件或 ≥50 commits)/不可逆切换 xhigh=120–180;拿不准取大一档。
- route Closing gate 清单加:收尾门必须显式传 `timeout_minutes`(按表)。
- **实证**:batch-E 206 文件双厂 60min+ 未完仍属合法耗时;原提案 60 被证伪。
- **验收**:纯 skill 文本;dogfood 评审确认无规则丢失。

### 4. stdout tee + 惰性 CPU 探针看门狗 + status 诊断面板
- **缺口**:85min 僵死靠人工 CPU 采样确诊——「监控靠人=没做」。
- **修法**(健康路径零成本,惰性升级):
  a. `run()` 加 tee:vendor stdout/stderr 实时追加 `<jobDir>/stdout.log`
     (runner 传入路径;内存计数字节数与最后输出时刻)。
  b. 看门狗(runner 内):stdout 静默满 10min 才启动 CPU 探针——单发
     wmic/PowerShell 读子进程 CPU 时间,两次、间隔 5min;两次增量均为零 →
     判死:killTree vendor 子进程,该 attempt 按可重试故障处理(受 #5 预算约
     束)。有增量 → 回到静默观察。判死总时延 ≈15-20min。
     阈值 env 可调:`AI_BRIDGE_WEDGE_SILENCE_MS`(默认 600000)/
     `AI_BRIDGE_WEDGE_PROBE_GAP_MS`(默认 300000)。
  c. runner 每次采样/输出里程碑写 `<jobDir>/progress.json`
     {lastOutputAt, stdoutBytes, cpuSamples[], watchdog};`ai_job_status`
     展示:最后输出距今 / 累计字节 / CPU 活性 / 看门狗判定。
- **边界(诚实标注)**:「服务端长思考」vs「死连接」只能启发式区分;误杀=一次
  有界重试,漏杀=天花板兜底,两头有界。
- **已否决**:60s 定频 CPU 采样(15 倍过采样 + 每分钟冷启 PowerShell)。
- **验收**:smoke——fake runner 静默场景注入假 CPU 采样器断言判死与斩杀;
  codex 有输出场景断言探针从不启动。

### 5. timeoutMs 改 job 级预算(封重试翻倍黑洞)
- **缺口**:现为 per-attempt——agy attempt 1 吊满 90min 超时后若 exit 0 空
  stdout,attempt 2 再吃 90min,job 实际 180min,违背用户对 `timeout_minutes`
  的直觉。
- **修法**:callVendor 起始算 deadline;每 attempt 的 timeoutMs = 剩余预算;
  剩余 < 60s 不再重试直接失败。看门狗斩杀(#4)同样计入预算。
- **验收**:smoke——注入 runner 断言 attempt 2 拿到的是剩余预算而非全额;
  剩余不足时不重试。

### 6. review 类 job 完成时的 VERDICT 出口契约(封「completed 但是垃圾」)
- **缺口**:job 层只验 exit 0 + 非空 → `run_command` 假完成标 completed。
- **修法**:`ai_review_start` 加参数 `expect_verdict`(默认 false,ad-hoc
  一次性二意见不受影响);为 true 时 runner 在完成前校验输出末行匹配
  `/^VERDICT: (GREEN|NEEDS-FIX|RED)\s*$/m`(取输出最后非空行),不匹配 →
  state=failed,error 指明 malformed(evidence 照写,供 forensics)。
  xreview/smart-plan 的 gate 调用一律传 `expect_verdict: true`。
- **验收**:smoke——fake 输出无 VERDICT + expect_verdict → failed;
  有 VERDICT → completed;expect_verdict 缺省时旧行为不变。

### 7. 空 stdout 处理:stderr 签名先行 + 恢复通道答案合理性校验
- **缺口 a**:诊断全程躺在 stderr(jetski auto-denied 原话),空 stdout 路径
  只顾重试/恢复没看它 → 三次白重试。
- **修法 a**:agy 空 stdout 时先查 stderr:命中
  /auto-denied|required the "command" permission/ → **永久失败**(不重试、
  不恢复、degrade:true),error 附 stderr 原文 + 修法指引(「物化 diff,
  勿让 reviewer 跑命令」,指向 #8)。
- **缺口 b**:`recoverAgyAnswer` 把 11 字符工具名当答案(isNoise 只挡
  16-30 字符不透明 token)。
- **修法 b**:恢复候选加合理性下限:len < 40 且无空白字符 → 拒绝(短真答案
  被拒的代价=走正常重试,可接受);`run_command` 类 ^[a-z_]+$ 单 token 同拒。
- **验收**:smoke——stub stderr 带 auto-denied 签名 → 一次尝试即永久失败且
  error 含指引;recovery stub 返回 `run_command` → 视为恢复失败进入重试。

### 8. Gemini 席物化 diff(skill 文本,封能力错配)
- **缺口**:agy review 腿 = `--sandbox`(只读+禁命令),而 gate prompt 要求
  reviewer 自己跑 git diff → whole-batch 必死(小相位审查只读文件所以从未暴露)。
- **修法**:xreview「How」+ smart-plan Phase 4:**Gemini 席**的 prompt 必须
  引用物化 diff——编排层先 `git diff <base>..<head> > docs/reviews/<label>-diff.txt`,
  prompt 明令「只读文件、禁跑任何命令(沙箱 auto-deny)」;GPT 席不变
  (danger-full-access 自己跑 git)。gate 结束后删除 diff 文件(收尾清单加半行)。
- **已否决**:给 agy 开 command 权限 allow-rule——review 席位放开任意命令执行
  违背只读原则,且有 agy rogue 前科([[reference_agy_rogue_reviewer]])。
- **验收**:skill 文本;dogfood 评审确认 GPT 席未被误改。

## 执行注意

- 本仓关键锚点:`src/jobs.mjs`(job 层协议头注释=权威)/ `src/job-runner.mjs` /
  `src/server.mjs`(guarded handlers)/ `src/vendors.mjs`(callVendor gemini
  重试环、recoverAgyAnswer、run())/ `scripts/smoke.mjs`(job 层测试块,
  fake runner 走 `AI_BRIDGE_ALLOW_FAKE_JOBS=1` env 门 + `AI_BRIDGE_JOBS_ROOT`
  隔离)。
- 测试注入 seam 惯例:`_setRunImplForTests` / `_setKillImplForTests`;新增
  CPU 采样器同法(`_setCpuProbeImplForTests`)。
- 禁实弹压测 agy(聚簇冷启 → OAuth 风控);验证一律离线 fake + 至多单发实弹。
- smoke 全绿后跑一次真实 detached PONG(scratchpad live-job-test 模式)。
