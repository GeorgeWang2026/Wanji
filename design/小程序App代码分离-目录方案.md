# 小程序 / App 代码分离 · 目录整理方案（monorepo 双工程）

> 决策：**本仓库新建 App 目标**（非复用网页版）。最终形态为 monorepo 双工程 + 跨端共享算法层。
> 现状：`wanji-mp` 是原生微信小程序（目录名 `uniApp` 为历史遗留，非 uni-app）。根目录 `yishu.js` / `markdown.js` 已是纯 JS 复制件（带 CommonJS 守卫），天然跨端。

---

## 0. 技术判断（先说结论）

| 事项 | 判断 |
|---|---|
| 是否全量把原生小程序迁到 uni-app | **否**。.wxml/.wxss 页面迁 uni-app 成本高、易引入回归，且收益有限 |
| 真正要跨端共享的是什么 | **算法/工具层**（术数引擎、排盘、Markdown、提示词），这部分已是纯 JS，直接复用 |
| 页面层怎么办 | 两端 UI 各自实现（小程序原生 + App 新工程），不强行统一 |

**核心思路：monorepo 三块 —— `shared`（跨端纯 JS）+ `miniapp`（原生小程序）+ `app`（新 App 工程）。**

---

## 1. 目标目录结构

```
wanji-mp/                              # monorepo 根
├── shared/                            # ★ 跨端共享（纯 JS，零 wx/uni API）
│   ├── yishu.js                       #   术数引擎（从根目录上移）
│   ├── markdown.js                    #   Markdown 渲染
│   ├── paipan-core.js                 #   排盘纯逻辑（从 uniApp/utils/paipan.js 拆出）
│   └── prompts.js                     #   提示词（脱敏版，两端共用）
│
├── miniapp/                           # ★ 原生微信小程序工程（现状代码迁入）
│   ├── app.js / app.json / app.wxss
│   ├── project.config.json            #   miniprogramRoot = "miniapp/"
│   ├── sitemap.json
│   ├── utils/                         #   小程序适配层（引用 ../shared）
│   │   ├── window-shim.js / env.js / api.js
│   │   ├── yishu.js                   #   适配 shared.yishu.js
│   │   ├── markdown.js / md-rich.js
│   │   ├── paipan.js / asr.js / tts.js
│   └── pages/
│       ├── core/                      #   两端共用：证券主打 + 对话
│       │   ├── chat/  stock/  stock-chart/  my-stocks/
│       ├── aux/                       #   小程序可见辅助（去预测化）
│       │   ├── qimen/  meihua/
│       └── occult/                    #   ★ 仅 App（小程序 app.json 不注册）
│           ├── bazi/  gua/
│
└── app/                               # ★ 新 App 工程（uni-app 或 Taro，阶段2新建）
    ├── pages/                         #   core + aux + occult 全量
    ├── utils/                         #   引用 ../shared
    └── ...                            #   平台无关页面重写
```

---

## 2. 分层职责

| 层 | 内容 | 小程序包 | App 包 |
|---|---|---|---|
| `shared/` | 术数引擎、排盘逻辑、Markdown、提示词 | ✅（被 miniapp 引用） | ✅（被 app 引用） |
| `miniapp/pages/core` | chat/证券 | ✅ | — |
| `miniapp/pages/aux` | 奇门/梅花 | ✅ | — |
| `miniapp/pages/occult` | 八字/卦典 | ❌（app.json 不注册 + packOptions 排除） | ✅（app 侧重写引用 shared） |
| `app/pages/*` | App 全量页面 | — | ✅ |

---

## 3. 小程序如何排除 occult（立即生效，不等 App 工程）

沿用微信原生机制，两个动作即可：

1. **`miniapp/app.json` 的 `pages` 不注册 `occult/*`** → 微信不编译，包内无 bazi/gua。
2. **`miniapp/project.config.json` 的 `packOptions.ignore` 排除 `occult`** 目录，双保险。

```json
// miniapp/app.json（小程序清单）
{ "pages": [
  "pages/core/chat/chat",
  "pages/core/stock/stock",
  "pages/core/stock-chart/stock-chart",
  "pages/core/my-stocks/my-stocks",
  "pages/aux/qimen/qimen",
  "pages/aux/meihua/meihua"
] }

// miniapp/project.config.json
{ "packOptions": { "ignore": [
  { "value": "pages/occult", "type": "folder" }
] } }
```

---

## 4. 分阶段执行（关键：先过审，再建 App）

### 阶段 1 —— 立即过审（只动小程序，不碰 App 工程）

```
step1  目录分层（轻量，不动工程根结构）
  mkdir miniapp/pages/{core,aux,occult}
  move 现有 pages/* -> 对应层（chat/stock->core, qimen/meihua->aux, bazi/gua->occult）

step2  小程序清单排除
  app.json.pages 移除 occult
  project.config.json.packOptions.ignore += occult

step3  敏感词脱敏（含 occult 隐藏页，防机审扫包）
  bazi/meihua/chat/quick-qa + 后端提示词 去预测化（见整改清单）

step4  一级菜单重排
  [奇门,证券,梅花] 证券居中，移除八字按钮

step5  加免责声明
  首页/结果页/付费弹窗

step6  提审
```

> 阶段 1 **不迁移工程根结构、不建 app 工程**，风险最低，目标是先让小程序过审。

### 阶段 2 —— 建 App 目标 + 抽共享层

```
step1  抽 shared/
  上移根目录 yishu.js/markdown.js -> shared/
  从 uniApp/utils/paipan.js 拆出纯逻辑 -> shared/paipan-core.js
  提示词集中 -> shared/prompts.js（脱敏版）

step2  迁 miniapp 工程
  现有小程序整体迁入 miniapp/，改 miniprogramRoot 与导入路径
  适配层 utils 改为 require('../../shared/...')

step3  新建 app/ 工程
  选型 uni-app 或 Taro（见 §5）
  pages 重写 core+aux+occult，复用 shared 算法
  排盘详情在 App 完整展示

step4  App 打包发布
```

---

## 5. App 工程选型建议

| 框架 | 优点 | 缺点 | 倾向 |
|---|---|---|---|
| **uni-app（Vue3）** | 同时支持 App/H5/小程序，生态成熟，HBuilderX 可视化 | 需把原生小程序重写为 .vue | ✅ 推荐 |
| **Taro（React）** | 团队若熟 React 则友好，可复用到 RN | 学习/迁移成本类似 | 视团队栈 |
| **H5 打 App 壳** | 最快，复用网页版 | 非原生体验 | 备选 |

> 若团队更熟 Vue → uni-app；更熟 React → Taro。两者都要重写页面，`shared/` 层均直接复用。

---

## 6. 落地步骤（伪代码总览）

```
整体流程:
  阶段1(立即):
    pages 分 core/aux/occult 三层
    app.json 排除 occult + packOptions 排除
    敏感词脱敏 + 菜单重排 + 免责声明
    -> 提交小程序过审

  阶段2(后续):
    抽 shared 纯逻辑层
    miniapp 迁入子目录, 引用 shared
    新建 app 工程(uni-app/Taro), 复用 shared
    -> App 完整包含 occult 排盘详情
```

---

## 7. 需你确认

1. **阶段 1 是否「不迁工程根结构」**：即在现有根目录直接建 `miniapp/` 前，先用 `uniApp/pages/{core,aux,occult}` 分层跑通过审，再在阶段 2 迁入 `miniapp/`？（推荐，风险最小）
2. **App 框架选型**：uni-app(Vue) 还是 Taro(React)？取决于团队技术栈。
3. **`occult` 源码在阶段 1 保留在仓库内**（不删，供阶段 2 App 用）是否确认？

确认后我出阶段 1 的「逐文件移动 + 引用替换 + 脱敏」精确清单交 Solo Coder。
