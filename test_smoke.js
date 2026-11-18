const fs = require('fs');
const path = require('path');
let JSDOM;
try {
  JSDOM = require('jsdom').JSDOM;
} catch (e) {
  if (!process.env.JSDOM_TD) {
    console.error('请先安装 jsdom: npm install jsdom');
    process.exit(1);
  }
  JSDOM = require(path.join(process.env.JSDOM_TD, 'node_modules', 'jsdom')).JSDOM;
}

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; throw new Error(msg); }
  console.log('PASS: ' + msg);
}
function click(doc, el, win) { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); }
function makeDom(seedData) {
  return new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://example.test/',
    beforeParse(w) { if (seedData) w.localStorage.setItem('needmatch_data_v1', JSON.stringify(seedData)); }
  });
}

// ============ 1. 首次访问：自动载入示例数据 ============
const dom = makeDom(null);
const d = dom.window.document, w = dom.window;
const seed = JSON.parse(w.localStorage.getItem('needmatch_data_v1'));
assert(seed && seed.needs.length >= 10, '首次访问自动载入示例数据（' + seed.needs.length + ' 条）');
assert(d.getElementById('statTotal').textContent === String(seed.needs.length), '统计总数与示例一致');
assert(/_\w{4}$/.test(d.getElementById('myName').textContent), '随机用户名已生成');

const allTitles = seed.needs.map(n => n.title + n.desc).join(' ');
['大模型','GPU','SaaS','FinTech','IPO','融资','供应链金融','股权','产业资本','区块链'].forEach(function(k){
  assert(allTitles.indexOf(k) > -1, '示例覆盖关键词: ' + k);
});
const cats = {}; seed.needs.forEach(n => cats[n.cat] = 1);
['找人','找资源','找合作','求建议'].forEach(function(c){ assert(cats[c], '示例覆盖类型: ' + c); });

// ============ 2. "我发布的"与"我对接的"标签有内容 ============
const mineTab = Array.from(d.querySelectorAll('.tab')).find(t => t.getAttribute('data-tab') === 'mine');
click(d, mineTab, w);
assert(d.querySelectorAll('.need').length >= 1, '"我发布的"标签有示例内容（' + d.querySelectorAll('.need').length + ' 条）');
const matchedTab = Array.from(d.querySelectorAll('.tab')).find(t => t.getAttribute('data-tab') === 'matched');
click(d, matchedTab, w);
assert(d.querySelectorAll('.need').length >= 1, '"我对接的"标签有示例内容（' + d.querySelectorAll('.need').length + ' 条）');

// ============ 3. 发布需求 ============
const allTab = Array.from(d.querySelectorAll('.tab')).find(t => t.getAttribute('data-tab') === 'all');
click(d, allTab, w);
const before = seed.needs.length;
const name0 = d.getElementById('myName').textContent;
d.getElementById('fTitle').value = '找人帮忙整理Excel表格';
d.getElementById('fCat').value = '找人';
d.getElementById('fContact').value = 'wx: test123';
d.getElementById('fDesc').value = '有一批数据需要整理成表格，有偿。';
click(d, d.getElementById('pubBtn'), w);
let stored = JSON.parse(w.localStorage.getItem('needmatch_data_v1'));
assert(stored.needs.length === before + 1, '发布后需求数 +1');
assert(d.getElementById('statTotal').textContent === String(before + 1), '统计同步更新');
assert(d.getElementById('myName').textContent !== name0, '发布后用户名重新随机');
assert(stored.name === d.getElementById('myName').textContent, '用户名已持久化到 DB');

// ============ 4. 访客视角：浏览 + 对接 ============
const visitorData = JSON.parse(JSON.stringify(stored));
visitorData.clientId = 'VISITOR-2';
const domB = makeDom(visitorData);
const d2 = domB.window.document, w2 = domB.window;
const card = d2.querySelector('.need');
assert(card !== null, '访客能看到需求');
let target = null, targetBtn = null;
d2.querySelectorAll('.need').forEach(function(c){
  if(target) return;
  const b = c.querySelector('[data-act="match"]');
  if(b){ target = c; targetBtn = b; }
});
assert(target !== null, '存在可对接的示例需求');
click(d2, targetBtn, w2);
const mf = d2.querySelector('.match-form');
assert(mf !== null, '点击后展开对接表单');
assert(/_\w{4}$/.test(mf.querySelector('.mf-name').value), '对接表单预填随机用户名');
mf.querySelector('.mf-contact').value = 'wx: helper99';
mf.querySelector('.mf-msg').value = '我可以帮忙';
click(d2, mf.querySelector('[data-act="submit-match"]'), w2);
const stored2 = JSON.parse(w2.localStorage.getItem('needmatch_data_v1'));
const totalMatches = stored2.needs.reduce(function(s,n){return s+n.matches.length},0);
assert(totalMatches >= 1, '对接记录已持久化（总对接数 ' + totalMatches + '）');

// ============ 5. 搜索 / 筛选 ============
const search = d2.getElementById('searchInput');
search.value = '不存在的关键词xyz';
search.dispatchEvent(new w2.Event('input', { bubbles: true }));
assert(d2.querySelectorAll('.need').length === 0, '搜索无结果显示空状态');
search.value = '融资';
search.dispatchEvent(new w2.Event('input', { bubbles: true }));
assert(d2.querySelectorAll('.need').length >= 1, '搜索"融资"命中示例需求');
search.value = '';
search.dispatchEvent(new w2.Event('input', { bubbles: true }));
const filter = d2.getElementById('catFilter');
filter.value = '找合作';
filter.dispatchEvent(new w2.Event('change', { bubbles: true }));
assert(d2.querySelectorAll('.need').length >= 1, '类型筛选"找合作"命中示例需求');

// ============ 6. 重新载入示例 ============
w.confirm = function(){ return true; };
click(d, d.getElementById('resetBtn'), w);
const reset = JSON.parse(w.localStorage.getItem('needmatch_data_v1'));
assert(reset.needs.length >= 10, '"重新载入示例"恢复示例数据');

// ============ 7. 清空数据 ============
click(d, d.getElementById('clearBtn'), w);
const cleared = JSON.parse(w.localStorage.getItem('needmatch_data_v1'));
assert(cleared.needs.length === 0, '"清空全部数据"清空需求');

// ============ 8. XSS 防护 ============
const domX = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://example.test/',
  beforeParse(win) {
    win.localStorage.setItem('needmatch_data_v1', JSON.stringify({
      clientId:'X', name:'anon_ABCD',
      needs:[{ id:'x1', title:'<img src=x onerror=alert(1)>', cat:'其他',
        desc:'<script>bad()</script>', contact:'c', publisher:'anon_ABCD',
        clientId:'OTHER', createdAt:Date.now(), status:'open', matches:[] }]
    }));
  }
});
const dx = domX.window.document;
assert(dx.querySelector('.need img') === null, '恶意HTML被转义，未注入img标签');
assert(dx.querySelector('.need h3').textContent.indexOf('<img') > -1, '文本以纯文本形式安全显示');

console.log('\nALL TESTS PASSED');
