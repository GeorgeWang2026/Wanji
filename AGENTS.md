<!-- 由 wanji-agent/AGENTS.md 生成，禁止手改；校验脚本 wanji-agent/scripts/check-agents-md.sh -->
铁律 v4 · 2026-11-21

1. 一库一写手：同一仓库同一时间只有一个人写，交接当面说清。（《文档作业规范》§8 写权归属 https://jian-pei.feishu.cn/docx/FrxZdGkDqoGXC8xwp83cWklAnSN）
2. 分支开发，绿了才合，合完删分支。（《协作契约》第四章 代码与写入 https://jian-pei.feishu.cn/docx/H2dzdN2XDojBajxqXKQcGsOknof）
3. 云文档我建、陈平整理、别人只读；建单归我。（《协作契约》第十章 写权归属 https://jian-pei.feishu.cn/docx/H2dzdN2XDojBajxqXKQcGsOknof）
4. 交付回复在任务线程下；@ 只用于叫人干活；单条 ≤10 行。（《架构说明》§十七 v2 https://jian-pei.feishu.cn/docx/NWJ7dtwQtoA9Xqx92o4cHChpnSh）
5. 不猜：拿不准标「待确认」，宁可问。（《文档作业规范》§9 不猜 https://jian-pei.feishu.cn/docx/FrxZdGkDqoGXC8xwp83cWklAnSN）
6. 开工先读铁律，回执填版本号与读取时间；超 12 小时重读。（《开工必读清单》〇、铁律 v4 https://jian-pei.feishu.cn/docx/H4h6dKn5oo8CwcxaBToc4bILnA5）
7. 定时一律由 Runner 或系统计划任务驱动，禁用 Trae 定时器；执行类活不进会话。（《本地执行器（Runner）规格》 https://jian-pei.feishu.cn/docx/A69JdGv8koo3sXxeGiGcxGf5nCe；《开工必读清单》 https://jian-pei.feishu.cn/docx/H4h6dKn5oo8CwcxaBToc4bILnA5）
8. 只维护 wanji / wanji-mp / wanji-agent 三个仓库；stock 等老项目已弃用，不投入人力、不为它做检索与兼容判断。（《阶段 3 写入口收口方案》 https://jian-pei.feishu.cn/docx/SC6hdWHUmo4VLVx5IvCcjxdknog）
9. **方案不得夹带**：新流程、新开关、新阶段这类机制设计，必须单独建 DF 单，或明确写进某张单的「确认范围」；否则只能放在方案的「建议」章节，不得进入排期与实现。
10. **派活前先判存活**：派人、派检索之前先确认目标项目服务在跑、有人维护；已弃用项目零投入，不派活、不检索、不为它做兼容判断。
11. **聊天里的新想法当天不进代码**：对话中产生的新想法一律先落「待确认」清单，一次一句；要动手先建单，任何人不得当场开工。
12. **一张单只准改它写明的入口**：派工必须附「准改文件与端点」白名单，不填不许开跑；越界即回滚，越界记录写进回执。
13. **同一时间只有一个写权持有人**：其余人的 Runner 只给读代码、跑测试、回执三类权限；写权交接须留记录，不得两头同时可写。

详情见上述链接；本文件为唯一可编辑版本，其他仓库为副本，禁止手改。
