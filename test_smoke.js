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

const html = fs.readFileSync('D:/workbuddy/needto/index.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.test/' });
const { window } = dom;
const { document } = window;

function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exitCode = 1; throw new Error(msg); }
  console.log('PASS: ' + msg);
}
function click(el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }

// 1. Identity generated
const name0 = document.getElementById('myName').textContent;
assert(/\/^[^\s]+_\w{4}$/.test(name0) || /_\w{4}$/.test(name0), '随机用户名已生成: ' + name0);

// 2. Publish a need
document.getElementById('fTitle').value = '找人帮忙整理Excel表格';
document.getElementById('fCat').value = '找人';
document.getElementById('fContact').value = 'wx: test123';
document.getElementById('fDesc').value = '有一批数据需要整理成表格，有偿。';
click(document.getElementById('pubBtn'));
let cards = document.querySelectorAll('.need');
assert(cards.length === 1, '发布后出现 1 张需求卡片');
assert(document.getElementById('statTotal').textContent === '1', '统计-总数=1');
assert(document.getElementById('myName').textContent !== name0, '发布后用户名已重新随机生成');

// verify persistence
const stored = JSON.parse(window.localStorage.getItem('needmatch_data_v1'));
assert(stored.needs.length === 1, 'localStorage 已写入需求');
assert(stored.needs[0].title === '找人帮忙整理Excel表格', '需求标题正确');

// 3. This need is mine (publisher)
assert(document.querySelector('.need .me-tag') !== null, '发布者能看到"我发布的"标记');

// 4. Simulate a DIFFERENT visitor by clearing clientId to force a match scenario.
//    We mutate stored clientId, reload a fresh DOM with same storage to mimic second user.
stored.clientId = 'VISITOR-2';
window.localStorage.setItem('needmatch_data_v1', JSON.stringify(stored));

const dom2 = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.test/' });
// seed dom2 storage with visitor data before script runs is tricky; instead set then re-run by manual load.
// Simpler: reuse dom, just change DB via a fresh JSDOM won't share storage. So test match on dom1 by switching clientId through storage+reload manually.
// We'll instead build dom2 with beforeParse to inject storage.
const domB = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'https://example.test/',
  beforeParse(w) {
    w.localStorage.setItem('needmatch_data_v1', JSON.stringify(stored));
  }
});
const d2 = domB.window.document;
const card2 = d2.querySelector('.need');
assert(card2 !== null, '第二访客能看到已发布需求');
assert(card2.querySelector('[data-act="match"]') !== null, '非发布者能看到"我要对接"按钮');
assert(card2.querySelector('.me-tag') === null, '非发布者看不到"我发布的"标记');

// 5. Open match form and submit
const matchBtn = card2.querySelector('[data-act="match"]');
matchBtn.dispatchEvent(new domB.window.MouseEvent('click', { bubbles: true }));
const mf = d2.querySelector('.match-form');
assert(mf !== null, '点击后展开对接表单');
const formName = mf.querySelector('.mf-name').value;
assert(formName && /_\w{4}$/.test(formName), '对接表单预填随机用户名: ' + formName);
mf.querySelector('.mf-contact').value = 'wx: helper99';
mf.querySelector('.mf-msg').value = '我可以帮忙';
mf.querySelector('[data-act="submit-match"]').dispatchEvent(new domB.window.MouseEvent('click', { bubbles: true }));
assert(d2.getElementById('statMatches').textContent === '1', '统计-累计对接=1');
const stored2 = JSON.parse(domB.window.localStorage.getItem('needmatch_data_v1'));
assert(stored2.needs[0].matches.length === 1, '对接记录已持久化');
assert(stored2.needs[0].matches[0].contact === 'wx: helper99', '对接联系方式正确');

// 6. "我对接的" tab shows the need for visitor
const matchedTab = Array.from(d2.querySelectorAll('.tab')).find(t => t.getAttribute('data-tab') === 'matched');
matchedTab.dispatchEvent(new domB.window.MouseEvent('click', { bubbles: true }));
assert(d2.querySelectorAll('.need').length === 1, '"我对接的"标签显示已对接需求');

// 7. Search filter
const allTab = Array.from(d2.querySelectorAll('.tab')).find(t => t.getAttribute('data-tab') === 'all');
allTab.dispatchEvent(new domB.window.MouseEvent('click', { bubbles: true }));
const search = d2.getElementById('searchInput');
search.value = '不存在的关键字xyz';
search.dispatchEvent(new domB.window.Event('input', { bubbles: true }));
assert(d2.querySelectorAll('.need').length === 0, '搜索无结果时显示空状态');
search.value = 'Excel';
search.dispatchEvent(new domB.window.Event('input', { bubbles: true }));
assert(d2.querySelectorAll('.need').length === 1, '搜索命中需求');

// 8. XSS safety check
const domX = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://example.test/',
  beforeParse(w) {
    w.localStorage.setItem('needmatch_data_v1', JSON.stringify({
      clientId: 'X', needs: [{ id: 'x1', title: '<img src=x onerror=alert(1)>', cat: '其他', desc: '<script>bad()</script>', contact: 'c', publisher: 'anon_ABCD', clientId: 'OTHER', createdAt: Date.now(), status: 'open', matches: [] }]
    }));
  }
});
const dx = domX.window.document;
assert(dx.querySelector('.need img') === null, '恶意HTML被转义，未注入img标签');
assert(dx.querySelector('.need h3').textContent.indexOf('<img') > -1, '文本以纯文本形式安全显示');

console.log('\nALL TESTS PASSED');
