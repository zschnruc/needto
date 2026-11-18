const fs = require('fs');
const path = require('path');
let JSDOM;
try {
  JSDOM = require('jsdom').JSDOM;
} catch (e) {
  if (!process.env.JSDOM_TD) { console.error('请先安装 jsdom: npm install jsdom'); process.exit(1); }
  JSDOM = require(path.join(process.env.JSDOM_TD, 'node_modules', 'jsdom')).JSDOM;
}

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; throw new Error(msg); }
  console.log('PASS: ' + msg);
}
function click(doc, el, win) { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); }

// ---- 内存版 mock 云数据库 ----
function makeMockDB(seedRows) {
  let rows = seedRows.map(r => JSON.parse(JSON.stringify(r)));
  const db = {
    from(table) {
      let _op = null, _eq = null, _order = null;
      const q = {
        select() { if (!_op) _op = 'select'; return q; }, // 已有写操作时 select 仅表示 return representation
        insert(row) { _op = 'insert'; q._row = row; return q; },
        update(row) { _op = 'update'; q._row = row; return q; },
        delete() { _op = 'delete'; return q; },
        eq(col, val) { _eq = { col, val }; return q; },
        order(col, opt) { _order = { col, opt }; return q; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            if (table !== 'needs') return { data: [], error: null };
            let result;
            if (_op === 'select') {
              result = rows.slice();
              if (_eq) result = result.filter(r => String(r[_eq.col]) === String(_eq.val));
              if (_order) result.sort((a, b) => _order.opt && _order.opt.ascending === false ? b[_order.col] - a[_order.col] : a[_order.col] - b[_order.col]);
            } else if (_op === 'insert') {
              rows.unshift(q._row); result = [q._row];
            } else if (_op === 'update') {
              result = [];
              rows.forEach(r => {
                if (!_eq || String(r[_eq.col]) === String(_eq.val)) { Object.assign(r, q._row); result.push(r); }
              });
            } else if (_op === 'delete') {
              result = [];
              rows = rows.filter(r => { if (!_eq || String(r[_eq.col]) === String(_eq.val)) { result.push(r); return false; } return true; });
            }
            return { data: result, error: null };
          }).then(resolve, reject);
        }
      };
      return q;
    }
  };
  return { db, getRows: () => rows };
}

const SDK_STUB = '<script>window.WorkBuddyCloud={createWorkBuddyCloud:function(){return {database:window.__MOCKDB__}}}</script>';
const FAIL_STUB = '<script>window.__FAILDB__={from:function(){var q={select:function(){return q},order:function(){return Promise.resolve({data:null,error:{message:"网络错误"}})}};return q}};window.WorkBuddyCloud={createWorkBuddyCloud:function(){return {database:window.__FAILDB__}}}</script>';

function makeDom(mockDb, stub) {
  return new JSDOM(html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net[^"]*"><\/script>/, stub || SDK_STUB), {
    runScripts: 'dangerously', url: 'https://need-match.app.workbuddy.host/',
    beforeParse(w) { if (mockDb) w.__MOCKDB__ = mockDb; }
  });
}

const seedRows = [
  { id: 'n1', title: '找后端工程师', cat: '找人', description: 'AI 创业团队', contact: 'wx:a', publisher: '用户A_X1Y2', client_id: 'OWNER1', status: 'open', created_at: Date.now() - 60000, matches: '[]' },
  { id: 'n2', title: 'Pre-A 融资对接', cat: '找资源', description: 'FinTech 项目融资', contact: 'wx:b', publisher: '用户B_C3D4', client_id: 'OWNER2', status: 'open', created_at: Date.now() - 120000, matches: JSON.stringify([{ id: 'm1', name: '用户C_E5F6', contact: 'wx:c', msg: '感兴趣', client_id: 'VISITOR9', created_at: Date.now() - 30000 }]) },
  { id: 'n3', title: '供应链金融合作', cat: '找合作', description: '银行资金方', contact: 'wx:d', publisher: '用户D_G7H8', client_id: 'OWNER3', status: 'open', created_at: Date.now() - 180000, matches: '[]' }
];
const wait = () => new Promise(r => setTimeout(r, 60));

(async function () {
  // 1. 首次加载云端数据
  const m1 = makeMockDB(seedRows);
  const dom = makeDom(m1.db);
  const d = dom.window.document, w = dom.window;
  await wait();
  assert(d.getElementById('statTotal').textContent === '3', '首屏加载云端数据，总数=3');
  assert(d.getElementById('statMatches').textContent === '1', '统计累计对接=1');
  assert(d.querySelectorAll('.need').length === 3, '渲染 3 张需求卡片');
  assert(/_[A-Z2-9]{4}$/.test(d.getElementById('myName').textContent), '随机用户名已生成');

  // 2. 发布需求写入云端
  d.getElementById('fTitle').value = '找算法顾问';
  d.getElementById('fCat').value = '找人';
  d.getElementById('fContact').value = 'wx:new';
  d.getElementById('fDesc').value = '风控算法兼职';
  click(d, d.getElementById('pubBtn'), w);
  await wait();
  assert(m1.getRows().length === 4, '发布后云端行数=4');
  assert(d.getElementById('statTotal').textContent === '4', '统计同步为 4');
  const published = m1.getRows().find(r => r.title === '找算法顾问');
  assert(published && published.client_id, '新需求含 client_id');
  assert(published.status === 'open' && published.matches === '[]', '新需求初始状态正确');

  // 3. 我发布的标签
  const mineTab = Array.from(d.querySelectorAll('.tab')).find(t => t.getAttribute('data-tab') === 'mine');
  click(d, mineTab, w);
  assert(d.querySelectorAll('.need').length === 1, '"我发布的"显示 1 条（刚发布的）');

  // 4. 对接写入云端（独立访客）
  const m2 = makeMockDB(seedRows);
  const dom2 = makeDom(m2.db);
  const d2 = dom2.window.document, w2 = dom2.window;
  await wait();
  const matchBtn = d2.querySelector('[data-act="match"]');
  assert(matchBtn, '存在"我要对接"按钮');
  click(d2, matchBtn, w2);
  const mf = d2.querySelector('.match-form');
  assert(mf, '展开对接表单');
  assert(/_[A-Z2-9]{4}$/.test(mf.querySelector('.mf-name').value), '对接表单预填随机用户名');
  mf.querySelector('.mf-contact').value = 'wx:helper';
  mf.querySelector('.mf-msg').value = '可以帮忙';
  click(d2, mf.querySelector('[data-act="submit-match"]'), w2);
  await wait();
  const n1 = m2.getRows().find(r => r.id === 'n1');
  assert(JSON.parse(n1.matches).length === 1, '对接记录写入云端');
  assert(d2.getElementById('statMatches').textContent === '2', '统计累计对接更新为 2');

  // 5. 我对接的标签
  const matchedTab = Array.from(d2.querySelectorAll('.tab')).find(t => t.getAttribute('data-tab') === 'matched');
  click(d2, matchedTab, w2);
  assert(d2.querySelectorAll('.need').length === 1, '"我对接的"显示 1 条');

  // 6. 删除（云端）
  const m3 = makeMockDB(seedRows);
  const dom3 = makeDom(m3.db);
  const d3 = dom3.window.document, w3 = dom3.window;
  await wait();
  w3.confirm = () => true;
  d3.getElementById('fTitle').value = '测试删除';
  d3.getElementById('fContact').value = 'wx:t';
  d3.getElementById('fDesc').value = '测试';
  click(d3, d3.getElementById('pubBtn'), w3);
  await wait();
  const delBtn = d3.querySelector('[data-act="del"]');
  assert(delBtn, '我发布的需求显示删除按钮');
  click(d3, delBtn, w3);
  await wait();
  assert(!m3.getRows().find(r => r.title === '测试删除'), '删除操作从云端移除记录');

  // 7. 搜索 / 筛选
  const search = d3.getElementById('searchInput');
  search.value = '融资';
  search.dispatchEvent(new w3.Event('input', { bubbles: true }));
  assert(d3.querySelectorAll('.need').length >= 1, '搜索"融资"命中云端数据');
  search.value = '';
  search.dispatchEvent(new w3.Event('input', { bubbles: true }));
  const filter = d3.getElementById('catFilter');
  filter.value = '找合作';
  filter.dispatchEvent(new w3.Event('change', { bubbles: true }));
  assert(d3.querySelectorAll('.need').length >= 1, '筛选"找合作"命中云端数据');

  // 8. 云端失败降级
  const domE = makeDom(null, FAIL_STUB);
  await wait();
  const errText = domE.window.document.getElementById('list').textContent;
  assert(errText.indexOf('加载失败') > -1, '云端失败时显示错误提示而非空白');

  console.log('\nALL CLOUD TESTS PASSED');
})().catch(e => { console.error(e); process.exit(1); });
