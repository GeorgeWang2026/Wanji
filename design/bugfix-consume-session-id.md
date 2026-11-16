# Bug 确认与修复方案：对话记录未关联到智能体会话（session_id 缺失）

## 1. 现象

进入主页发起正式提问（付费深度解读）后，这批「问事记录」没有落到当前智能体会话（session）名下。之后凡是「按 session_id 反查聊天记录 / 问事记录」的路径，都查不到本次刚产生的记录，表现为记录与当前会话对不上、或列表为空。

## 2. 根因（一句话）

小程序端在调用 `/credits/consume` 扣费建单时，**请求体漏传 `session_id`**，导致 `question_records.session_id` 被写成 `NULL`，无法与智能体会话建立关联。网站端早已补上此字段，小程序端漏了。

## 3. 证据链

### 3.1 后端明确支持并依赖 `session_id`

- 后端扣费建单模型：`G:\projects\wanji\backend\routers\credits.py`
  - `session_id: Optional[str] = Field(None, max_length=64, description="所属智能体会话 id（跨库逻辑引用）；追问不传时继承父记录的值")`（约 L227）
  - 建单取值：`session_id = (body.session_id or "").strip() or None`，前端不传即为 `None`；追问仅在父记录有值时继承（约 L265-267）
  - 结论：**前端不传 → 整条链路 session_id = NULL**

- 智能体侧按 `session_id` 反查问事记录：`G:\projects\wanji-agent\src\wanji_agent\question_lookup.py`
  - 通过 `GET /credits/questions/by_session` 判断「哪些 session 已关联付费问题」
  - 依赖 `question_records.session_id` 才能定位到会话

### 3.2 网站端正确传了（参考实现）

- `G:\projects\wanji\static\assistant-widget.js`（约 L3883-3884）

```js
// DF-71/DF-104：带上智能体会话 id，业务库 question_records.session_id 据此关联到会话
if (window.__xbAgentSessionId) body.session_id = String(window.__xbAgentSessionId);
```

### 3.3 小程序端漏传（问题所在）

- `G:\projects\wanji-mp\uniApp\pages\chat\chat.js` 的 `startFlow`（约 L3079-3085）

```js
var consumeData = {
  scene: 'ask',
  usage: { ask: text, client_id: clientId, tool: bundle.types[0] || 'qimen' },
  paipan_count: Math.min(4, bundle.types.length),
  paipan_types: bundle.types,
  target_id: this.rootQuestionId || null
};
// ❌ 缺少 session_id，与网站端不一致
```

## 4. 处理流程（伪代码）

### 4.1 当前流程（有 bug）

```
startFlow(text):
    bundle = buildBundle()
    ok = confirmCost(text, bundle)
    if not ok: ...; return

    consumeData = {
        scene: 'ask',
        usage: { ask, client_id, tool },
        paipan_count, paipan_types,
        target_id: this.rootQuestionId || null
        // ❌ 无 session_id
    }
    consume = POST /credits/consume(consumeData)

    // 后端：question_records.session_id = NULL
    // 结果：按 session_id 反查问事记录时查不到本次记录
```

### 4.2 目标流程（对齐网站端）

```
startFlow(text):
    ...
    consumeData = {
        scene: 'ask',
        usage: { ask, client_id, tool },
        paipan_count, paipan_types,
        target_id: this.rootQuestionId || null
    }
    if this.agentSessionId != null and this.agentSessionId != '':
        consumeData.session_id = String(this.agentSessionId)   // ✅ 补传
    consume = POST /credits/consume(consumeData)

    // 后端：question_records.session_id = this.agentSessionId
    // 结果：按 session_id 反查能正确关联
```

## 5. 修复方案

### 5.1 主修复（必做，范围最小）

文件：`G:\projects\wanji-mp\uniApp\pages\chat\chat.js`，`startFlow` 内 `consumeData` 组装处（约 L3079-3085）。

在 `var consumeData = { ... };` 之后、`POST /credits/consume` 之前，补上与网站端一致的字段：

```js
if (this.agentSessionId) {
  consumeData.session_id = String(this.agentSessionId);
}
```

要点：
- 仅当 `this.agentSessionId` 非空时才携带，为空时行为与现状一致（后端按 `None` 处理），不引入回归。
- 追问场景（`target_id` 非空）同样受益：后端「追问未显式传 session_id 时继承父记录」，父记录因本次修复已有正确值，追问可正确继承；显式传值则直接覆盖，二者皆可。

### 5.2 关联风险点（建议确认，不擅自扩大改动范围）

`this.agentSessionId` 的「权威值」来源与网站端存在差异，可能在补 5.1 后仍偶发传空/传旧：

- 网站端：WS `session.ready` 下发权威 session_id 后，会回写 `window.__xbAgentSessionId`（`G:\projects\wanji\static\xiaoxuan.html` 约 L11946-11951）。

```js
function onReady(data){
  if (channel && data && data.session_id && !channel.sessionId){
    channel.sessionId = data.session_id;
  }
  if (channel && channel.sessionId) window.__xbAgentSessionId = channel.sessionId;  // ✅ 权威回写
}
```

- 小程序端：WS `session.ready` 仅更新 `AgentChannel` 内部的 `this.sessionId`，**未回写** `chat.js` 的 `this.agentSessionId`。

影响：若用户进入主页后、`/agent/sessions/ensure` 尚未返回或失败、但自由对话通道已通过 `session.ready` 拿到权威 session_id 时，`this.agentSessionId` 仍为空，5.1 的补传会拿到空值。

该点是否处理由用户确认：如需处理，可在 `chat.js` 的 freeTalk `onReady` 回调中同步回写 `this.agentSessionId`（与 `_restartSession` 已做的同步方式一致）。**本方案默认不纳入 5.1，仅提示。**

## 6. 验证方式

1. **直接验证**：登录后进入主页发起一次正式付费提问，抓包或查库确认 `/credits/consume` 请求体含 `session_id`，且 `question_records` 表该行 `session_id` = 当前智能体会话 id（非 NULL）。
2. **反查验证**：调用 `/credits/questions/by_session?session_id=<sid>`，确认能返回本次刚产生的问事记录。
3. **回归验证**：
   - 追问：在同一条根问题下追问，确认追问记录的 `session_id` 与根问题一致（继承或显式传值均可）。
   - 未登录/ensure 失败场景：确认补传逻辑在 `agentSessionId` 为空时不抛错、不影响原扣费流程。
   - 免费引导流：确认 `reuse_question_id` 复用路径不受影响（该分支同样在 `consumeData` 上追加字段，无冲突）。
