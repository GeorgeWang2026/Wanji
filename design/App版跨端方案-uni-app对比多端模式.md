# App 版跨端方案：uni-app vs 微信「多端应用模式」

> 状态：**已确认**
> - 技术路线：**微信「多端应用模式」**（复用原生小程序代码）
> - occult 入口：**设置页隐藏开关**（默认关闭，开启后显示八字/卦典）
> 目标：在现有小程序代码基础上产出 iOS/Android App 版，App 版包含 occult（八字/卦典）隐藏功能，小程序版继续排除。

---

## 一、关键结论（先对齐认知）

1. 当前工程是 **原生微信小程序**，不是 uni-app。
   - 证据：全仓无 `.vue` 文件，无 `manifest.json` / `main.js` / `pages.json` / `App.vue` / `package.json`。
   - `uniApp/` 目录是历史命名，容易误判为 uni-app 框架。
2. 「uni-app 的 App 开发」与「微信多端应用模式」**思路一致**——都是一套代码编译到多端；但它们是**两套不同的技术体系**，对你的迁移成本天差地别。

---

## 二、两条路径对比

| 维度 | uni-app（DCloud） | 微信「多端应用模式」 |
|---|---|---|
| 核心思路 | 一套 Vue 代码 → 编译 H5 / 各家小程序 / App | 一套小程序代码 → 编译微信小程序 / iOS / Android / 鸿蒙 / Web |
| 技术栈 | Vue 3（`.vue` 文件、`<template>/<script>/<style>`） | 保留小程序 `WXML/WXSS/JS` 语法 |
| 对本项目 | **整体重写**：`.wxml`→`<template>`、`setData`→响应式、`app.json`→`pages.json`、`wx.*`→`uni.*` | **近乎零改写**：现有文件可直接复用 |
| App 端渲染 | WebView / nvue（weex） | 原生渲染（微信自研渲染引擎） |
| 条件编译 | `#ifdef APP-PLUS` / `#ifndef MP-WEIXIN` | 平台判断（`platform`）+ 构建期目录隔离 |
| 生态/成本 | 第三方框架，生态大，但重写 + 学习 Vue | 微信官方，贴着小程序，迁移最省 |
| 适配本项目「App 含 occult、小程序不含」 | 需先完成 Vue 重写才能谈条件编译 | 直接复用已完成的目录分层 |

**推荐：微信「多端应用模式」。** 理由：项目已经是原生小程序，重写成 uni-app 的代价远超收益；微信多端框架能最大程度复用阶段 1 的目录分层成果。

---

## 三、核心需求：App 含 occult，小程序不含

阶段 1 已完成的目录分层：

```
uniApp/pages/
├── core/     # 证券 + 对话（两端都含）
├── assist/   # 奇门 + 梅花（两端都含，辅助工具）
└── occult/   # 八字 + 卦典（仅 App 含）
```

小程序端通过 `app.json` 不注册 occult + `packOptions.ignore` 排除 occult 完成隐藏。

App 端需要相反动作：**注册 occult 页面 + 不排除 occult**。

### 3.1 通用机制（框架无关的伪代码）

核心是一个「平台开关」，决定 occult 页面是否进入编译产物与页面注册表。

```text
BUILD_TARGET = MP | APP

if BUILD_TARGET == MP:
    pages = [chat, qimen, meihua, stock, stock-chart, my-stocks]
    exclude_dir = ["uniApp/pages/occult"]
else:  # APP
    pages = [chat, qimen, meihua, stock, stock-chart, my-stocks,
             bazi, gua]                 # ← App 多两个页面
    exclude_dir = []                    # ← 不排除，occult 进包
```

### 3.2 运行时兜底（防止 App 里误跳转到未注册页面）

对话页的 `SKILL_PAGE` 映射目前把 `bazi/gua` 指向 occult 路径；App 版这两条路由有效，小程序版无效。加一道运行时守卫：

```js
// 伪代码
var SKILL_PAGE = {
  qimen: '/uniApp/pages/assist/qimen/qimen',
  meihua: '/uniApp/pages/assist/meihua/meihua',
  bazi: '/uniApp/pages/occult/bazi/bazi',
  gua: '/uniApp/pages/occult/gua/gua'
};

function isOccultEnabled() {
  // App 端返回 true；小程序端返回 false
  return getPlatform() !== 'mp-weixin';
}

function openSkill(type) {
  if (!isOccultEnabled() && (type === 'bazi' || type === 'gua')) {
    return; // 小程序端不跳转
  }
  wx.navigateTo({ url: SKILL_PAGE[type] });
}
```

> 注：`getPlatform()` 具体 API 需按所选框架落到实际代码（uni-app 用条件编译，微信多端用 `platform` 判断）。此处只表达意图。

---

## 四、按「微信多端模式」的改造清单（推荐路径）

| # | 事项 | 说明 |
|---|---|---|
| 1 | 开发者工具切换「多端应用模式」 | 项目配置里开启，配置 App 名称/包名/图标/签名 |
| 2 | App 版页面注册 | 让 occult 的 bazi/gua 进入 App 构建的页面表 |
| 3 | 不排除 occult | App 构建不应用 `packOptions.ignore` 的 occult 条目 |
| 4 | 原生能力接入 | 支付、推送、登录等 App 专属能力（当前小程序未接支付，App 版可接） |
| 5 | 彩蛋入口 | App 版给 occult 放一个隐藏入口（长按/连点/设置项），供专业爱好者使用 |
| 6 | 双端差异开关 | 落地 3.2 的运行时守卫，统一「两端行为」 |

---

## 五、设置页隐藏开关设计（已确认形式）

occult 页面的**注册**与**入口**分离：

- App 端：occult 页面**已注册**（进包），但**入口默认隐藏**，由设置页开关控制。
- 小程序端：occult 页面**未注册**（排除），开关不存在（或置灰/无操作）。

### 5.1 平台开关（框架无关伪代码）

```text
getPlatform():
    mp-weixin  → 小程序
    app        → 多端 App
```

### 5.2 开关状态持久化

```js
var OCCULT_KEY = 'occult_enabled';   // 本地存储键

function isOccultOn() {
  return getPlatform() === 'app'
      && wx.getStorageSync(OCCULT_KEY) === '1';
}

function setOccult(on) {
  wx.setStorageSync(OCCULT_KEY, on ? '1' : '0');
  // 开关变化后刷新技能条/入口可见性
}
```

### 5.3 入口可见性判定

```js
function isOccultEntryVisible() {
  // 仅 App 端 + 开关开启时才显示八字/卦典入口
  return isOccultOn();
}
```

### 5.4 设置页开关 UI（伪代码）

```text
[个人中心 / 设置]
  ...
  高级功能（仅 App 版显示）
    ☐ 传统文化研究工具（八字 / 卦典）     ← 默认关闭
       说明：仅供专业爱好者研究交流，内容仅供参考
```

- 开关默认 `off`，切换后写入本地存储并立即刷新首页技能条。
- 开关只影响「入口」，不影响页面注册（App 端始终注册，避免动态注册复杂度）。

---

## 六、给 Solo Coder 的任务拆解

- [ ] T1：开发者工具切换「多端应用模式」，跑通 App 骨架
- [ ] T2：occult 页面 App 端注册 + 小程序端保持 `packOptions.ignore` 排除
- [ ] T3：落地 `getPlatform()` 与 `isOccultOn()` 平台开关，接入 `SKILL_PAGE` 守卫
- [ ] T4：设置页新增「高级功能」隐藏开关（仅 App 版可见），持久化 `occult_enabled`
- [ ] T5：开关开启后刷新首页技能条，显示八字/卦典入口
- [ ] T6：App 专属原生能力（支付/推送/登录，按需）
- [ ] T7：双端冒烟测试（小程序不含 occult；App 含 occult，开关关闭无入口、开启可进入）

---

## 七、遗留问题（不阻塞当前任务）

1. App 版是否接支付（App Store 内购 vs 微信/支付宝支付，审核规则不同）——后续单独评估。
2. App 版目标平台：iOS + Android 都要，还是先 Android——发布时再定。
