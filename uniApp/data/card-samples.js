/* ============================================================
 * DF-156 · 四份联调样例（前后端共用同一套，避免各写各的）
 * ------------------------------------------------------------
 * 1) normal   ：8 类组件正经用法（含分组容器嵌套一层）
 * 2) unknown  ：混入未知组件 chart / carousel，须降级为文本块
 * 3) oversize ：layout 超限（节点数 260 > 上限 200），须整卡拒渲染
 * 4) no_card  ：消息不带 card 字段，纯文本路径不得受影响
 *
 * 用法：require('../../data/card-samples.js').normal 等
 * ============================================================ */

var normal = {
  schema_version: '1.0',
  card_id: 'card_demo_0001',
  layout: {
    nodes: [
      { type: 'text', text: '下周一上午 3 个航班可订', key: 'n1' },
      { type: 'tip', text: '价格含税，改签需补差', level: 'info', key: 'n2' },
      {
        type: 'group',
        title: '选择航班',
        key: 'g1',
        children: [
          {
            type: 'list',
            mode: 'single',
            title: '上午班次',
            key: 'n3',
            items: [
              { text: '08:10 CA1501  ¥1200', action_id: 'pick_ca1501' },
              { text: '09:35 MU5102  ¥1080', action_id: 'pick_mu5102' },
              { text: '11:20 HU7605  ¥1150', action_id: 'pick_hu7605' }
            ]
          },
          { type: 'status', label: '余票紧张度', value: '3/9', percent: 33, state: 'running', key: 'n4' }
        ]
      },
      {
        type: 'buttons',
        key: 'n5',
        buttons: [
          { text: '按价格排序', action_id: 'sort_price' },
          { text: '确认下单', action_id: 'confirm_order', style: 'primary' }
        ]
      },
      { type: 'input', label: '备注', placeholder: '如：靠窗、带婴儿', action_id: 'note_input', key: 'n6' }
    ]
  }
};

var unknown = {
  schema_version: '1.0',
  card_id: 'card_demo_0002',
  layout: {
    nodes: [
      { type: 'text', text: '以下包含两种未注册组件', key: 'u1' },
      { type: 'chart', text: '柱状图：近七日客流', key: 'u2' },
      { type: 'carousel', title: '轮播图', key: 'u3' },
      {
        type: 'buttons',
        key: 'u4',
        buttons: [{ text: '知道了', action_id: 'ack_unknown' }]
      }
    ]
  }
};

function buildOversize() {
  var nodes = [];
  for (var i = 0; i < 260; i++) {
    nodes.push({ type: 'text', text: '第 ' + (i + 1) + ' 行', key: 'x' + i });
  }
  return {
    schema_version: '1.0',
    card_id: 'card_demo_0003',
    layout: { nodes: nodes }
  };
}

var oversize = buildOversize();

var noCard = null; // 消息本身没有 card 字段

module.exports = {
  normal: normal,
  unknown: unknown,
  oversize: oversize,
  noCard: noCard,
  all: [
    { name: 'normal', card: normal },
    { name: 'unknown', card: unknown },
    { name: 'oversize', card: oversize },
    { name: 'no_card', card: noCard }
  ]
};
