# 万机决策助手 · 微信小程序（独立工程）

本工程原先放在 `qimen-1/static/` 下，现已迁出为独立工程 **`G:\projects\wanji`**，
微信开发者工具导入工程根目录即可编译运行。

术数算法与 Markdown 渲染**复用网页版公共库的复制件**（`yishu.js` / `markdown.js`），不重写一套。

> 网页版仍在 `qimen-1/static/`（`xiaoxuan.html` / `assistant-widget.js`），本次迁移没有改动它的任何文件。
> 本工程根目录的 `yishu.js` / `markdown.js` 是**复制件**；网页版更新这两个库后需手工同步，见「三、公共库来源与同步」。

---

## 一、目录结构

工程根目录就是 `G:\projects\wanji`，`app.*`、`project.config.json`、`sitemap.json` 与两个公共库都在这一层，
页面与工具层在 `uniApp/` 下。微信开发者工具导入**工程根目录**（根目录直接可见 `app.json`）。

```
G:\projects\wanji\
├── app.js                        # 小程序入口：补 window 壳、globalData（排盘关联、TTS 开关）
├── app.json                      # 页面注册 / 窗口样式（录音权限不在此声明，见 3.5）
├── app.wxss                      # 全局暗色紫金主题 + 通用按钮/弹层样式
├── project.config.json           # 开发者工具项目配置（miniprogramRoot = "./"）
├── sitemap.json
├── yishu.js                      # ★ 术数引擎（复制自 qimen-1/static/yishu.js，保留 CommonJS 导出守卫）
├── markdown.js                   # ★ Markdown 渲染（复制自 qimen-1/static/markdown.js，未改动）
└── uniApp/
    ├── README.md                 # 本文档（packOptions 已忽略，不参与打包）
    ├── utils/
    │   ├── window-shim.js        # 给公共库补最小 window / localStorage 壳
    │   ├── env.js                # 接口基址（dev/prod + 本地覆盖）
    │   ├── api.js                # wx.request 封装 + 登录态（qimen_token 等）
    │   ├── yishu.js              # 术数引擎适配层（qimenPan / baziPan / meihuaGua）
    │   ├── markdown.js           # Markdown 适配层（chatHtml / guaHtml / plain）
    │   ├── md-rich.js            # 给 rich-text 补内联样式（rich-text 不支持 class 样式表）
    │   ├── paipan.js             # 排盘 → 后端 payload 组装 + preview_prompt_hint
    │   ├── asr.js                # 录音 + /speech/asr 识别
    │   └── tts.js                # /speech/tts + innerAudioContext 分段播放
    └── pages/
        ├── chat/                 # 首页：对话主流程（发送 / Markdown / 语音输入 / 播报）
        ├── qimen/                # 奇门遁甲排盘（九宫格 + 宫位释义 + 关联）
        ├── bazi/                 # 四柱八字（四柱 + 旺衰 + 大运 + 关联）
        ├── meihua/               # 梅花易数（时间/数字/物象起卦 + 三卦 + 关联）
        └── gua/                  # 卦典详情（后端 Markdown → rich-text）
```

---

## 二、如何导入运行

1. 打开**微信开发者工具** → 导入项目。
2. 项目目录选择 **`G:\projects\wanji`**（工程根目录，进来就能直接看到 `app.json`；
   不要再选 `uniApp` 或旧的 `qimen-1\static`）。
   - `project.config.json` 里 `miniprogramRoot` 为 `"./"`，AppID 为 `wx27c9a5ea8b03c258`（IDE 导入时写入）；
     正式发布请替换成你们自己的小程序 AppID。
3. 首次打开建议检查：**详情 → 本地设置 →
   勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」**（本地联调必需）。
4. 进入首页即为对话页（`uniApp/pages/chat/chat`）。可先用「注册」创建账号（后端默认赠送 10 积分），
   或使用网页版已有账号登录。

> 编译包体说明：本工程不再需要排除网页版的 `avatar/`、`mystock/`、`ths/` 与网页脚本——
> 这些文件都没有迁过来。`project.config.json` 的 `packOptions.ignore` 现在只忽略
> `*.md`、`.git`、`.github`、`node_modules`，整包约 208 KB（远低于 2 MB 主包上限）。

---

## 三、公共库来源与同步

### 3.1 来源：网页版公共库的复制件

| 本工程文件 | 来源 | 迁移方式 | 说明 |
| --- | --- | --- | --- |
| `G:\projects\wanji\yishu.js` | `g:\projects\qimen-1\static\yishu.js` | 复制 | 术数引擎；末尾保留 CommonJS 导出守卫 |
| `G:\projects\wanji\markdown.js` | `g:\projects\qimen-1\static\markdown.js` | 复制 | Markdown 渲染；内容与网页版一致 |

原件**仍在 qimen-1 中保留**，网页版通过 `<script src="/yishu.js">`、`<script src="/markdown.js">` 正常加载，互不影响。
其余网页版资产（`xiaoxuan.html`、`assistant-widget.js`、`api-client.js`、`avatar/`、`mystock/` 等）**没有**迁入本工程。

### 3.2 `yishu.js`：导出守卫必须保留

`yishu.js` 原本是**浏览器全局脚本**（顶层 `const`/`function`），小程序模块作用域取不到这些名字。
文件末尾有一段导出（`if (typeof module !== "undefined" && module.exports) { ... }`），页面统一通过
`uniApp/utils/yishu.js` 适配层取用 `qimenPaiPan` / `getBazi` / `calcDayun` / `dayMasterProfile` / `meihuaGua` / `lookup64` 等原函数。

- 浏览器：没有 `module` 变量 → 整块跳过，`xiaoxuan.html` 行为零变化。
- 小程序：`require()` 后可直接拿到 97 个常量与函数。
- **同步时务必确认这段守卫还在文件末尾**：若用旧版本源文件覆盖，`require` 会拿不到引擎，页面会提示「引擎未就绪」。

该文件里的 `localStorage`（万物类象缓存）由 `window-shim.js` 用 `wx.getStorageSync` 兜底实现，未修改引擎内部逻辑。

**本地补丁（同步后必须重打）**：第 910 行原本是 `const _keys = Object.keys(window);`。
小程序的模块包装会把 `window` 置为 `undefined`（即使 `globalThis.window` 可写），所以改成：

```js
const _keys = Object.keys(typeof window !== "undefined" && window ? window : globalThis);
```

浏览器里 `window` 存在，取值不变。

### 3.3 `markdown.js`

- 该文件是 `(function(global){...})(window)` 形式。注意：**只在 `globalThis` 上挂 `window` 不够**——
  小程序编译后的模块作用域里裸 `window` 是 `undefined`，IIFE 收不到实参，
  会抛 `Cannot set properties of undefined (setting 'QimenMarkdown')`。
- 所以结尾实参加了守卫回退（**本地补丁，同步后必须重打**）：

```js
})(typeof window !== "undefined" && window ? window : (typeof globalThis !== "undefined" ? globalThis : {}));
```

- 对话回复用 `chatMdToHtml(md, { rich: true })`（与网页版悬浮助手的富文本分支一致，支持表格/代码块/引用）；
  卦典用 `guaMdToHtml(md)`。
- 因为 `<rich-text>` 只认内联 `style`，`md-rich.js` 会按标签补一套暗色主题内联样式；
  该步骤只加 `style`，不改结构，且遇到已有 `style` 的标签（如动爻高亮）直接跳过。

### 3.4 网页版公共库更新后如何同步

1. 从 `g:\projects\qimen-1\static\` 复制同名文件覆盖本工程根目录的 `yishu.js` / `markdown.js`。
2. **重打上面两条本地补丁**（覆盖会连带把补丁冲掉，漏了就是运行时「引擎未就绪 / Markdown 渲染库加载失败」）：
   - `markdown.js` 最后一行的 `})(window);` → 3.3 里带 `typeof` 守卫的版本；
   - `yishu.js` 第 910 行的 `Object.keys(window)` → 3.2 里带 `typeof` 守卫的版本。
   快速自检（两条都应有输出、且不报错）：

   ```powershell
   Select-String -Path G:\projects\wanji\markdown.js -Pattern 'globalThis : \{\}'
   Select-String -Path G:\projects\wanji\yishu.js -Pattern 'window \? window : globalThis'
   ```

3. 检查 `yishu.js` 末尾的 `typeof module !== "undefined"` 导出块是否仍在：
   - 在 → 直接用；
   - 不在（例如从更早的备份覆盖）→ 把网页版带守卫的版本复制过来，**不要**手写一套新导出。
4. 跑一遍语法与冒烟检查（见「十、自测清单」），确认 `yishu.js` 仍能导出 97 个成员、`markdown.js` 能返回 HTML。
5. 小程序侧适配层（`uniApp/utils/yishu.js`、`uniApp/utils/markdown.js`）一般无需改动；
   只有公共库函数签名变化时才需要同步适配层。

### 3.5 `app.json` 不写录音 `permission`

`permission` 字段只接受位置类 scope（`scope.userLocation` 等）。写 `scope.record` 会得到
`无效的 app.json permission["scope.record"]` 告警，且不会带来任何授权效果。
录音授权由 `wx.getRecorderManager` / `wx.authorize` 在首次调用时自动弹窗，因此该块已删除。

---

## 四、需要配置的域名与后端环境

### 4.1 域名白名单（微信公众平台 → 开发 → 开发管理 → 服务器域名）

| 类型 | 填写 | 用途 |
| --- | --- | --- |
| request 合法域名 | `https://estock.space` | 登录、积分、`/chat`、`/gua`、`/speech/asr` |
| uploadFile 合法域名 | `https://estock.space` | `wx.uploadFile` 上传录音 |
| downloadFile 合法域名 | `https://estock.space` | `innerAudioContext` 播放 TTS 音频 / 报告 PDF 下载 |

**以上三个列表都要加 `https://estock.space`**（`request` / `uploadFile` / `downloadFile` 是相互独立的列表，只配一个不够）。

要求：**HTTPS + 已备案 + 不带宽口**（只能 443）。域名有变动时改两处：

1. `uniApp/utils/env.js` 里的 `CONFIG.prod.API_ORIGIN`；
2. 小程序后台的上述三类域名。

也可以在小程序首页「登录/账号」弹层里直接改「接口地址」（存在本地，优先级最高），方便真机调试。

### 4.2 后端环境

- 小程序直连的是与网页版**完全相同**的接口前缀 `/api/v1`，不需要反向代理层。
- 用到的接口（全部已存在，**本次没有新增或修改任何后端代码**）：

| 接口 | 用途 |
| --- | --- |
| `POST /auth/login`、`POST /auth/register` | 登录 / 注册 |
| `GET /credits/balance` | 余额（返回体字段为 `credits`）|
| `POST /credits/consume` | 扣费（首次提问 5 积分，带 `target_id` 的追记为 0）|
| `POST /chat/preview_prompt_hint` | 把盘面组装成提示词文本（免鉴权）|
| `POST /chat` | 模型回复（需要 `Authorization: Bearer <token>`）|
| `POST /speech/asr` | 录音识别（multipart 字段名必须是 `audio`）|
| `GET /speech/tts` | 语音合成（默认 `edge-tts`，`voice=zh-CN-XiaoxiaoNeural`）|
| `GET /gua/{num}`、`GET /gua/fetch/{num}` | 卦典正文（Markdown）|

- ASR / TTS 依赖后端环境变量：`DASHSCOPE_API_KEY`（或本地 faster-whisper / `BAIDU_API_KEY`），
  以及 `edge-tts` 包。缺失时：ASR 返回 501/502（小程序侧提示「改用文字输入」），TTS 返回 501（静默不播报）。
- `backend/config.py` 的 `SPEECH_REQUIRE_AUTH` 默认关闭。若你们后续打开它，
  TTS（`innerAudioContext` 无法自定义请求头）会 401，需要后端额外支持 query token 或给音频加签名 URL。

### 4.3 合法域名的本地联调替代

开发者工具里勾选「不校验合法域名」后即可直连 `http://localhost:5000`；
真机预览时把 `CONFIG.dev.API_ORIGIN` 换成电脑的局域网 IP（手机访问不到 `localhost`），
并确保后端以 `--host 0.0.0.0` 启动。

---

## 五、浏览器 API 逐项替代方案

| 网页版用法 | 小程序替代 | 落地情况 |
| --- | --- | --- |
| `document` / `innerHTML` 拼 DOM | WXML 模板 + `setData` 数据绑定 | 已全部改为数据驱动 |
| Web Speech API（`SpeechRecognition` 实时出字）| `wx.getRecorderManager` 录音 → `wx.uploadFile` → `/speech/asr` 一次性识别 | 已实现（单次 ≤60s，非流式）|
| Web Audio API 振幅驱动嘴型动画 | 降级为「录音中」状态 + 秒数计时 + 呼吸点动画，无嘴型动画 | 已降级 |
| `speechSynthesis` / `new Audio()` | `wx.createInnerAudioContext` 播放 `/speech/tts`，按句切段顺序播放 | 已实现 |
| `localStorage` | `wx.setStorageSync`（登录态键名沿用 `qimen_token` / `qimen_uid` / `qimen_uname`）| 已实现 |
| 弹窗遮罩 / iframe | 页面内自绘 `qm-mask` + `qm-dialog`，或原生 `wx.showModal` | 已实现 |
| 富文本 `innerHTML` 渲染 Markdown | `<rich-text nodes="...">` + 内联样式补全 | 已实现（表格可显示，但不支持横向滚动容器）|
| `navigator` / `location` | `env.js` 显式基址 + 本地覆盖 | 已实现 |

---

## 六、术数弹窗迁移情况（按优先级）

| 优先级 | 弹窗 | 状态 | 说明 |
| --- | --- | --- | --- |
| P0 | 奇门遁甲排盘 | ✅ 已完成 | 日期/时辰选择、起局信息（四柱/定局/值符值使）、九宫格（天盘干/地盘干/八神/九星/八门/宫位标记/值符值使时干徽标）、点宫位看释义、预览提示词、关联到提问 |
| P0 | 关联排盘 → 提问 | ✅ 已完成 | 首页底部技能条 + 已关联标签；未关联时按当前时空自动起「奇门+梅花」双盘（与网页版 FB-40 行为一致）|
| P1 | 梅花易数（时间/数字/物象） | ✅ 已完成 | 三卦并排（本卦/互卦/变卦）+ 动爻高亮 + 体用五行关系；点卦象进卦典 |
| P1 | 四柱八字 | ✅ 已完成（主体） | 四柱十神表 + 旺衰判定（评分/喜用/忌神/断语）+ 十步大运（起止年/年龄/趋势评分） |
| P1 | 卦典详情 | ✅ 已完成 | `/gua/{n}` → `/gua/fetch/{n}` 回退；Markdown 渲染 |
| P2 | 八字「命运曲线」 | ❌ 未迁移 | 原实现是 canvas 逐年曲线，工作量大且需要重写绘制逻辑，页面已用文字说明替代 |
| P2 | 排盘档案（保存/读取/导出档案） | ❌ 未迁移 | 依赖网页版的档案编辑面板与 `_archives` 本地结构，小程序端暂用「关联当前盘」代替 |
| P2 | 奇门起局方式切换（拆补/置闰、盘面版式） | ❌ 未迁移 | 当前固定使用引擎默认参数（`转盘 · 拆补`），需要与产品确认是否暴露 |
| P3 | 网页版艺术化盘面（罗盘动画、卡片展开、悬浮动效） | ❌ 未迁移 | 小程序以信息可读为先，未做同款动效；卦典的折叠卡片因 `rich-text` 不支持点击事件也未还原 |

---

## 七、主流程（首页）行为说明

1. **输入 → 发送**：登录后输入文字，点「发送」。
2. **扣费确认**：首次提问弹 `wx.showModal` 确认消耗 **5 积分**（与后端 `DEEP_READING_COST` 一致）；
   同一轮追问（`target_id` = 根记录）**不再弹确认、不再扣费**。
3. **起盘**：优先使用已关联的盘；没有则按当前时空自动起「奇门 + 梅花」。
4. **提示词组装**：`POST /chat/preview_prompt_hint` → 把各类型文本作为 `paipan_prompt_text` 透传给 `/chat`。
5. **回复渲染**：`/chat` 返回后经 `markdown.js` → `rich-text` 渲染；长回复可「复制」。
6. **语音输入**：点「说」开始录音（再次点击停止），识别结果**只回填输入框**、由用户确认后再发送
   （网页版是识别后直接发送；这里因为涉及扣积分，改成了二次确认，属于有意的行为差异）。
7. **语音播报**：开关默认开启，收到回复自动朗读；单条消息可点「播报」重听，再点一次停止。

积分不足时提示前往网页版充值（小程序内未接支付，网页版 `POST /pay/orders` 的微信支付无法在无商户号/无 `wx.requestPayment` 参数的情况下复用）。

---

## 八、与网页版的差异汇总

| 维度 | 网页版 | 小程序 |
| --- | --- | --- |
| 语音识别 | 浏览器实时识别，边说边出字 | 录完一次性识别，需确认后发送 |
| 语音播报 | `speechSynthesis` / `Audio` | `innerAudioContext`，锁定静音键也播放（`obeyMuteSwitch=false`）|
| 弹窗形态 | 页面内 modal + iframe 式遮罩 | 独立页面（`wx.navigateTo`）+ 页面内遮罩 |
| 富文本能力 | 完整 HTML/CSS，可点击折叠 | `rich-text` 子集，仅内联样式、无点击事件 |
| 充值 | 网页版下单 + 收款码 | 无，引导去网页版 |
| 本地缓存 | `localStorage` | `wx` Storage（键名兼容）|
| 分享 | 复制链接 | 原生 `onShareAppMessage` |

---

## 九、后续待办（建议优先级）

1. **接微信登录**：目前是账号密码登录；若要「一键登录」，需要后端新增 `POST /auth/wx-login`
   （`code` → `jscode2session` → openid 绑定/建号），这是唯一需要新增的后端接口。
2. **支付**：小程序内充值需商户号 + `wx.requestPayment`，并新增「JSAPI 下单 + 支付回调」链路。
3. **流式输出**：后端已有 `/chat/stream`（SSE），小程序可用 `wx.request` 的 `enableChunked` 做打字机效果。
4. **流式 ASR**：后端 `WS /speech/asr/ws` 可用，接入后能做到边说边出字。
5. **排盘档案**：把网页版档案结构（`_archives`）迁到 `wx` Storage，并补档案管理页。
6. **命运曲线**：用 `canvas type="2d"` 重绘逐年评分曲线。
7. **订阅消息**：深度解读是异步生成的，可用订阅消息在报告完成时推送提醒。

---

## 十、自测清单（迁移后在新位置重跑）

迁移后（2026-11-11）在 `G:\projects\wanji` 重新执行：

- [x] 17 个 JS 文件全部通过 `node --check`（含 `yishu.js` / `markdown.js` 与 5 个页面）
- [x] 8 个 JSON 全部可解析（`app.json` / `project.config.json` / `sitemap.json` / 5 个页面 json）
- [x] `app.json` 注册的 5 个页面 × `.js/.json/.wxml` 全部存在
- [x] 所有 `require('./…')` / `require('../../…')` 相对路径目标均存在（`../../yishu.js`、`../../markdown.js`）
- [x] 全工程无指向 `qimen-1` 的硬编码绝对路径（除本文档的说明性文字）
- [x] 整包 38 个文件、约 208 KB（源码），打包后主包 255.0 KB，远低于主包 2 MB 限制
- [x] Node 宿主模拟：`app.js onLaunch`、5 个页面 `onLoad` 均无异常
- [x] `yishu.js` 导出 97 个成员，`getBazi` / `qimenPaiPan` / `calcDayun` / `dayMasterProfile` / `meihuaGua` 输出正常
- [x] `markdown.js` 经 `chatHtml()` 输出带内联样式的 HTML（表格/标题/加粗）
- [x] 奇门九宫格、梅花三卦、八字四柱与十步大运、卦典回退（`/gua/{n}` → `/gua/fetch/{n}`）逻辑与迁移前一致
- [x] 首页全链路（mock 后端）：确认弹窗 → `preview_prompt_hint` → `consume`(5) → `/chat` → Markdown HTML
- [x] 微信开发者工具真实构建（2026-11-11）：`cli preview --project G:\projects\wanji` 退出码 0，
      主包 **255.0 KB**（261,081 B，单包；两次 preview 结果一致），编译 0 error / 0 warning
- [x] 运行时实测（模拟器 appservice）：`window.QimenMarkdown` 可用、术数引擎导出可用，
      聊天页无「Markdown 渲染库加载失败」提示，奇门排盘能出九宫格数据
- [x] `app.json` 不再包含无效的 `permission["scope.record"]`（该告警已消失）
- [ ] 真机验证录音 / 播放（涉及麦克风与域名白名单）
