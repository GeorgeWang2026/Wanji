/* ============================================================
 * DF-156 · 整卷提交器（§14 回执第 4 项）
 * ------------------------------------------------------------
 * 幂等口径（manifest form_rules.submit_idempotency）：
 *   幂等键 = 动作 + 归一后答案指纹（survey-form.fingerprint）
 *   - 同一份答案重复提交：只发一次，回放首次结果
 *   - 改答案再提交：指纹变化，算新一次，正常发送
 *   - 同指纹并发触发共用同一个在途 Promise
 *   - 失败不写缓存，允许同指纹重试
 * 纯逻辑，send 由调用方注入（页面注入 api.request，自测注入桩）。
 * ============================================================ */

var formUtil = require('./survey-form.js');

function clone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

function createSubmitter(send) {
  if (typeof send !== 'function') throw new Error('submitter 需要注入 send 函数');
  var cache = {};    // fingerprint -> 首次回执
  var pending = {};  // fingerprint -> 在途 Promise
  var sendCount = 0;

  function submit(payload) {
    if (!payload || !payload.action_id) {
      return Promise.reject(new Error('整卷提交缺 action_id'));
    }
    if (!payload.card_id) {
      return Promise.reject(new Error('整卷提交缺 card_id（服务端要校验归属）'));
    }
    var key = formUtil.fingerprint(payload);

    if (cache[key]) {
      var hit = clone(cache[key]);
      hit.replayed = true;
      return Promise.resolve(hit);
    }
    if (pending[key]) return pending[key];

    sendCount++;
    pending[key] = Promise.resolve()
      .then(function () { return send(clone(payload)); })
      .then(function (res) {
        var record = {
          ok: true,
          replayed: false,
          key: key,
          payload: clone(payload),
          response: res
        };
        cache[key] = record;
        delete pending[key];
        return clone(record);
      }, function (err) {
        delete pending[key];
        throw err;
      });

    return pending[key];
  }

  return {
    submit: submit,
    keyOf: function (payload) { return formUtil.fingerprint(payload); },
    stats: function () { return { sends: sendCount, cached: Object.keys(cache).length }; }
  };
}

module.exports = { createSubmitter: createSubmitter };
