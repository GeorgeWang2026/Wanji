/* ============================================================
 * paipan.js —— 排盘数据 → 后端 payload 组装
 * ------------------------------------------------------------
 * 就是把 xiaoxuan.html 里 _doSendRecInput 的组装逻辑搬过来（字段名保持一致），
 * 让小程序提问与网页版走同一条多智能体深度解读链路：
 *   1. 本地用 yishu.js 算命盘（零网络）
 *   2. POST /api/v1/chat/preview_prompt_hint 让后端把命盘转成提示词文本
 *   3. 发 /chat 时带上 paipan_data + paipan_prompt_text
 * ============================================================ */
var y = require('./yishu.js');
var api = require('./api.js');

var DEEP_READING_COST = 1; // DF-77：每次深度解读 1 积分（根问题与追问同计），与 backend/routers/credits.py 的 DEEP_READING_COST 保持一致

function pad(n) { return n < 10 ? '0' + n : '' + n; }

function fmtTime(yy, mm, dd, hh, mi) {
  return yy + '-' + pad(mm) + '-' + pad(dd) + ' ' + pad(hh) + ':' + pad(mi || 0);
}

/* ---------------- 奇门遁甲 ---------------- */
function buildQimen(yy, mm, dd, hh, mi) {
  var r = y.qimenPan(yy, mm, dd, hh, mi || 0);
  var pan = r.pan;
  var bazi = r.bazi;
  var payload = {
    pan: pan,
    bazi: {
      year: bazi.year, month: bazi.month, day: bazi.day,
      hour: bazi.hour, jieqi: bazi.jieqi
    },
    // 后端 _extract_qimen_text 依赖它输出「起局时间」行
    solar_time: { y: yy, m: mm, d: dd, h: hh, mi: mi || 0 }
  };
  var meta = {
    type: 'qimen',
    label: '奇门遁甲',
    summary: (pan.full || '') + ' · ' + fmtTime(yy, mm, dd, hh, mi),
    y: yy, m: mm, d: dd, h: hh, mi: mi || 0
  };
  return { payload: payload, meta: meta, pan: pan, bazi: bazi };
}

/** 按当前时刻起奇门（未绑定技能时的兜底） */
function autoQimen(now) {
  return buildQimen(now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes());
}

/* ---------------- 四柱八字 ---------------- */
function buildBazi(yy, mm, dd, hh, mi, gender, name) {
  var r = y.baziPan(yy, mm, dd, hh, mi || 0, gender || '男');
  var pb = r.pb;
  var dy = r.dy;
  var payload = {
    year: yy, month: mm, day: dd, hour: hh, minute: mi || 0,
    gender: gender || '男',
    name: name || '',
    pb: pb,
    pdy: dy,
    pdayun: dy,
    py: yy, pm: mm, pd: dd, ph: hh, pmi: mi || 0
  };
  var meta = {
    type: 'bazi',
    label: '四柱八字',
    summary: [pb.year, pb.month, pb.day, pb.hour].join(' ') + ' · ' + (gender || '男') + '命',
    y: yy, m: mm, d: dd, h: hh, mi: mi || 0,
    gender: gender || '男',
    name: name || ''
  };
  return { payload: payload, meta: meta, pb: pb, dy: dy, prof: r.prof };
}

/* ---------------- 梅花易数 ---------------- */
function buildMeihua(gua, mode, input) {
  mode = mode || 'time';
  input = input || {};
  var ben = y.lookup64(gua.up, gua.down);
  var hu = y.lookup64(gua.huUpperGua, gua.huLowerGua);
  var bian = y.lookup64(gua.bianUpperGua, gua.bianLowerGua);
  var summary = [
    '本卦 ' + ((ben && ben.full) || ''),
    '互卦 ' + ((hu && hu.full) || ''),
    '变卦 ' + ((bian && bian.full) || ''),
    '动爻第' + gua.moveYao + '爻'
  ].join(' · ');

  var payload = {
    up: gua.up, down: gua.down,
    huUpperGua: gua.huUpperGua, huLowerGua: gua.huLowerGua,
    bianUpperGua: gua.bianUpperGua, bianLowerGua: gua.bianLowerGua,
    moveYao: gua.moveYao, tiGua: gua.tiGua, yongGua: gua.yongGua,
    tiWx: gua.tiGua.wx, yongWx: gua.yongGua.wx,
    mode: mode,
    input: {
      mode: mode,
      time: input.time || null,
      number: input.number || { n1: null, n2: null, n3: null },
      word: input.word || { text: '', upN: null, downN: null, csIdx: null, cs: null },
      summary: summary
    }
  };
  var meta = {
    type: 'meihua',
    label: '梅花易数',
    summary: summary,
    mode: mode,
    time: input.time || null,
    gua: gua
  };
  return { payload: payload, meta: meta, ben: ben, hu: hu, bian: bian };
}

/** 按当前时刻起梅花（兜底） */
function autoMeihua(now) {
  var gua = y.meihuaGua({
    mode: 'time',
    year: now.getFullYear(), month: now.getMonth() + 1,
    day: now.getDate(), hour: now.getHours()
  });
  var shortSummary = y.lookup64(gua.up, gua.down);
  var r = buildMeihua(gua, 'time', {
    time: { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate(), h: now.getHours(), mi: now.getMinutes() },
    summary: (shortSummary && shortSummary.full) || ''
  });
  // 兜底路径的 summary 用网页版同款短格式
  r.payload.input.summary = r.meta.summary;
  return r;
}

/**
 * 请求后端把 paipan_data 组装成提示词文本
 * @param {object} paipanData { qimen?, bazi?, meihua? }
 * @returns {Promise<{texts:object, hint:string}>}
 */
function fetchPromptText(paipanData) {
  return api.request('/chat/preview_prompt_hint', {
    method: 'POST',
    auth: false,
    data: { paipan_data: paipanData || {} }
  }).then(function (d) {
    var texts = {};
    if (d && Array.isArray(d.type_infos)) {
      d.type_infos.forEach(function (ti) {
        if (ti && ti.type && ti.text) texts[ti.type] = ti.text;
      });
    }
    return { texts: texts, hint: (d && d.hint) || '' };
  });
}

/* ============================================================
 * 追问：从 analysis_result 还原当时的盘面参数
 * ------------------------------------------------------------
 * 参考页 continueFollowupFromRecord → _xbBindPaipanFromThread：
 *   GET /chat/analysis_result/{analysis_id} 拿到 pan_info 文本，
 *   反向解析出起局时间 / 生日 / 卦象 / 证券代码，再重绑技能与盘面。
 * 小程序原来只恢复 rootQuestionId，这里补上与参考页一致的能力。
 * ============================================================ */

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

/** GET /chat/analysis_result/{id} → pan_info 文本（失败返回 ''） */
function fetchAnalysisResult(analysisId) {
  if (!analysisId) return Promise.resolve('');
  return api.request('/chat/analysis_result/' + analysisId).then(function (j) {
    if (j && j.code === 0 && j.data && j.data.pan_info) return j.data.pan_info;
    if (j && j.pan_info) return j.pan_info;
    return '';
  }).catch(function () { return ''; });
}

/** 后端 pan_info 文本 → 最小盘面参数（照抄参考页 _panInfoToPaipanData） */
function panInfoToParams(tool, panInfo, fallbackISO) {
  if (!panInfo || typeof panInfo !== 'string') return null;
  var info = panInfo;

  if (tool === 'stock') {
    var mName = info.match(/【个股】\s*([^（(\n【]+?)\s*[（(]\s*([0-9A-Za-z.]{4,12})\s*[）)]/);
    if (!mName) return null;
    var stock = { name: (mName[1] || '').trim(), code: mName[2].trim().toUpperCase() };
    var mZs = info.match(/【天时[^\n]*\n([^\n（(]+?)\s*[（(]\s*([0-9A-Za-z.]{2,12})\s*[）)]/);
    if (mZs) { stock.zs_name = (mZs[1] || '').trim(); stock.zs_code = mZs[2].trim(); }
    var mBk = info.match(/【地利[^\n]*\n([^\n（(]+?)\s*[（(]\s*([0-9A-Za-z.]{2,12})\s*[）)]/);
    if (mBk) { stock.bk_name = (mBk[1] || '').trim(); stock.bk_code = mBk[2].trim(); }
    return stock;
  }

  if (tool === 'bazi') {
    var mSolar = info.match(/公历[：:]\s*(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})/);
    if (!mSolar) return null;
    return {
      py: +mSolar[1], pm: +mSolar[2], pd: +mSolar[3], ph: +mSolar[4], pmi: +mSolar[5],
      pgender: /坤造/.test(info) ? '女' : (/乾造/.test(info) ? '男' : '男'),
      pname: ''
    };
  }

  if (tool === 'qimen') {
    // pan_info: 「四柱八字：2024 11 10 14」/「定局：阳 · 甲子 · 四局」
    var mBz = info.match(/四柱八字[：:]\s*(\d{4})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})/);
    var mJu = info.match(/定局[：:]\s*([^\s·\n]+)\s*·\s*([^\s·\n]+)\s*·\s*([^\n]+)/);
    var qd = {};
    if (mBz) {
      qd.qy = +mBz[1]; qd.qm = +mBz[2]; qd.qd = +mBz[3]; qd.qh = +mBz[4]; qd.qmi = 0;
    } else if (fallbackISO) {
      // DF-41：pan_info 不含四柱八字行时，用提问记录的 created_at 兜底
      var dt = new Date(fallbackISO);
      if (!isNaN(dt.getTime())) {
        qd.qy = dt.getFullYear();
        qd.qm = dt.getMonth() + 1;
        qd.qd = dt.getDate();
        qd.qh = dt.getHours();
        qd.qmi = dt.getMinutes();
      }
    }
    if (mJu) qd.qju = ((mJu[1] || '').trim() + (mJu[2] || '').trim() + (mJu[3] || '').trim()).trim();
    return qd.qy ? qd : null;
  }

  if (tool === 'meihua') {
    var mMode = info.match(/梅花易数\s*·\s*(时间起卦|数字起卦|物卦起法)/);
    var mBen = info.match(/【本卦】上卦\s*([^\s·]+)[^\n]*?·\s*下卦\s*([^\s·]+)[^\n]*?·\s*动爻第(\d+)爻/);
    var mHu = info.match(/【互卦】上卦\s*([^\s·]+)[^\n]*?·\s*下卦\s*([^\s·]+)/);
    var mBian = info.match(/【变卦】上卦\s*([^\s·]+)[^\n]*?·\s*下卦\s*([^\s·]+)/);
    if (!mBen) return null;
    var guaList = y.dict('MH_GUA') || [];
    var nameToGua = function (s) {
      var nm = (s || '').trim().charAt(0);
      for (var i = 0; i < guaList.length; i++) {
        if (guaList[i] && guaList[i].name === nm) return guaList[i];
      }
      return null;
    };
    var upG = nameToGua(mBen[1]);
    var downG = nameToGua(mBen[2]);
    if (!upG || !downG) return null;
    var moveYao = +mBen[3];
    var tiGua = moveYao > 3 ? downG : upG;
    var yongGua = moveYao > 3 ? upG : downG;
    var mh = {
      up: upG, down: downG, moveYao: moveYao,
      tiGua: tiGua, yongGua: yongGua,
      tiWx: tiGua.wx, yongWx: yongGua.wx
    };
    var huG = mHu ? [nameToGua(mHu[1]), nameToGua(mHu[2])] : null;
    if (huG && huG[0] && huG[1]) { mh.huUpperGua = huG[0]; mh.huLowerGua = huG[1]; }
    var bianG = mBian ? [nameToGua(mBian[1]), nameToGua(mBian[2])] : null;
    if (bianG && bianG[0] && bianG[1]) { mh.bianUpperGua = bianG[0]; mh.bianLowerGua = bianG[1]; }
    var data = {
      mhMode: mMode ? (mMode[1] === '时间起卦' ? 'time' : (mMode[1] === '数字起卦' ? 'number' : 'word')) : 'time',
      mhGuaData: mh
    };
    if (fallbackISO) {
      var dt2 = new Date(fallbackISO);
      if (!isNaN(dt2.getTime())) {
        data.mhy = dt2.getFullYear();
        data.mhm = dt2.getMonth() + 1;
        data.mhd = dt2.getDate();
        data.mhh = dt2.getHours();
        data.mhmi = dt2.getMinutes();
      }
    }
    return data;
  }
  return null;
}

/** 还原参数 → 本地重算 payload/meta（与手动绑定同形，发送追问时使用同一盘面） */
function rebuildFromParams(tool, p) {
  if (!p) return null;
  if (tool === 'qimen') {
    var q = buildQimen(p.qy, p.qm, p.qd, p.qh, p.qmi || 0);
    if (p.qju) q.meta.qju = p.qju;       // 保留原始定局文案（仅展示用）
    return { payload: q.payload, meta: q.meta };
  }
  if (tool === 'bazi') {
    var b = buildBazi(p.py, p.pm, p.pd, p.ph, p.pmi || 0, p.pgender, p.pname);
    return { payload: b.payload, meta: b.meta };
  }
  if (tool === 'meihua') {
    var time = p.mhy ? { y: p.mhy, m: p.mhm, d: p.mhd, h: p.mhh, mi: p.mhmi } : null;
    var m = buildMeihua(p.mhGuaData, p.mhMode, { time: time });
    m.meta.time = time;
    return { payload: m.payload, meta: m.meta };
  }
  return null;
}

/**
 * 线程恢复：types + analysis_ids → { qimen:{payload,meta}, ... }
 * 逐个拉 analysis_result，解析 pan_info 后本地重算；失败的技能不返回（标签仍会展示）。
 */
function restoreThread(types, analysisIds, fallbackISO) {
  var out = {};
  var seq = (types || []).map(function (t) {
    var aid = analysisIds && analysisIds[t];
    if (!aid) return Promise.resolve();
    if (t === 'stock') {
      return fetchAnalysisResult(aid).then(function (info) {
        var stock = panInfoToParams('stock', info, fallbackISO);
        if (stock) out.stock = { stock: stock, meta: { type: 'stock' } };
      });
    }
    return fetchAnalysisResult(aid).then(function (info) {
      var params = panInfoToParams(t, info, fallbackISO);
      if (!params) return;
      try {
        var entry = rebuildFromParams(t, params);
        if (entry) out[t] = entry;
      } catch (e) {
        console.warn('[paipan] 还原 ' + t + ' 失败', e);
      }
    });
  });
  return Promise.all(seq).then(function () { return out; });
}

module.exports = {
  DEEP_READING_COST: DEEP_READING_COST,
  buildQimen: buildQimen,
  autoQimen: autoQimen,
  buildBazi: buildBazi,
  buildMeihua: buildMeihua,
  autoMeihua: autoMeihua,
  fetchPromptText: fetchPromptText,
  fetchAnalysisResult: fetchAnalysisResult,
  panInfoToParams: panInfoToParams,
  restoreThread: restoreThread
};
