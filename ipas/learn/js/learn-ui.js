// ═══════════════════════════════════════════════════════
//  Three-Question Engine — UI Renderer v2.0
//  Renders Home Dashboard, Learn Screen, Phase 1-4, Exam
//  Depends on: learn-engine.js (ThreeQuestionEngine)
// ═══════════════════════════════════════════════════════

(function(global){
'use strict';

var TQE = global.ThreeQuestionEngine;
if(!TQE) throw new Error('learn-engine.js must be loaded before learn-ui.js');

var state = TQE.state;

// ─── Stats persistence ───
var STATS_KEY = 'tqe_s100_stats';

function _loadStats(){
  try {
    var raw = localStorage.getItem(STATS_KEY);
    if(!raw) return { answered: 0, correct: 0, streak: 0, lastDate: '', moduleMastery: {}, weakTopics: [] };
    return JSON.parse(raw);
  } catch(e){ return { answered: 0, correct: 0, streak: 0, lastDate: '', moduleMastery: {}, weakTopics: [] }; }
}

function _saveStats(stats){
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch(e){ /* silent */ }
}

function _updateStatsAfterPhase3(){
  var stats = _loadStats();
  var mod = TQE.getModule(state.moduleId);
  if(!mod) return;
  var correct = 0;
  var total = 0;
  mod.questions.forEach(function(q){
    if(state.phase3.answers[q.id]){
      total++;
      if(state.phase3.answers[q.id] === q.correct) correct++;
    }
  });
  stats.answered = (stats.answered || 0) + total;
  stats.correct = (stats.correct || 0) + correct;
  // Streak
  var today = new Date().toISOString().slice(0, 10);
  if(stats.lastDate !== today){
    var yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    stats.streak = stats.lastDate === yesterday ? (stats.streak || 0) + 1 : 1;
    stats.lastDate = today;
  }
  // Module mastery
  if(!stats.moduleMastery) stats.moduleMastery = {};
  var mastery = total > 0 ? Math.round(correct / total * 100) : 0;
  stats.moduleMastery[state.moduleId] = mastery;

  // Per-framework mastery (overwrite per module, not cumulative — avoids double-count)
  if(!stats.fwMastery) stats.fwMastery = {};
  mod.frameworks.forEach(function(fw){
    var fwCorrect = 0, fwTotal = 0;
    mod.questions.forEach(function(q){
      if(q.framework === fw.id && state.phase3.answers[q.id]){
        fwTotal++;
        if(state.phase3.answers[q.id] === q.correct) fwCorrect++;
      }
    });
    if(fwTotal > 0){
      // Overwrite this module's fw data (not accumulate), keyed by moduleId+fwId
      stats.fwMastery[mod.id + ':' + fw.id] = {
        correct: fwCorrect,
        total: fwTotal,
        pct: Math.round(fwCorrect / fwTotal * 100),
        lastDate: today,
        moduleId: mod.id,
        fwName: fw.name
      };
    }
  });

  _saveStats(stats);
}

// ─── Screen management ───
function showScreen(id){
  document.querySelectorAll('.tqe-screen').forEach(function(s){ s.classList.remove('active'); });
  var el = document.getElementById(id);
  if(el) el.classList.add('active');
  window.scrollTo(0, 0);
  updateTopNav(id);

  // Auto-render stats screen when navigating to it
  if(id === 'tqeScreenStats') renderStatsScreen();
  // Auto-render entry when navigating home
  if(id === 'tqeScreenEntry') renderEntry();

  if(TQE.getConfig().onPhaseChange) TQE.getConfig().onPhaseChange(id, state);
}

// ─── Top Navigation ───
function updateTopNav(screenId){
  var nav = document.getElementById('tqeNavLinks');
  if(!nav) return;
  var links = [
    { id: 'tqeScreenEntry', label: '首頁', action: 'TQE_UI.showScreen(\'tqeScreenEntry\')' },
    { id: 'tqeScreenLearn', label: '模組', action: 'TQE_UI.showScreen(\'tqeScreenEntry\')' },
    { id: 'tqeScreenLayer2', label: '弱項練習', action: 'TQE_UI.goLayer2()' },
    { id: 'tqeScreenStats', label: '成績', action: 'TQE_UI.showScreen(\'tqeScreenStats\')' }
  ];
  // Highlight: 模組 active when on Learn or Entry, 弱項練習 when on Layer2
  var html = '';
  links.forEach(function(l){
    var isActive = screenId === l.id;
    if(l.id === 'tqeScreenLearn' && (screenId === 'tqeScreenLearn' || screenId === 'tqeScreenPhase1' || screenId === 'tqeScreenPhase2' || screenId === 'tqeScreenPhase3' || screenId === 'tqeScreenPhase4')) isActive = true;
    var active = isActive ? ' active' : '';
    html += '<button class="nav-link' + active + '" onclick="' + l.action + '">' + l.label + '</button>';
  });
  nav.innerHTML = html;
}

// ─── Entry view state ───
var _entryView = 'home';

// ─── Entry screen (Home Dashboard) ───
function renderEntry(){
  var pack = TQE.getConfig().contentPack;
  if(!pack) return;

  // Toggle teacher link visibility
  var teacherLink = document.getElementById('tqeTeacherLink');
  if(teacherLink) teacherLink.style.display = TQE.isTeacher() ? 'inline-block' : 'none';

  var area = document.getElementById('tqeEntryArea');
  if(!area) return;

  var levels = TQE.getLevels();
  var modules = TQE.getAllModules();
  var stats = _loadStats();

  // Group modules by level
  var grouped = {};
  levels.forEach(function(lv){ grouped[lv.id] = []; });
  modules.forEach(function(m){
    var lvId = m.level || 'default';
    if(!grouped[lvId]) grouped[lvId] = [];
    grouped[lvId].push(m);
  });

  // Sub-views: home, level-X, practice-X, exam-X
  if(_entryView !== 'home' && _entryView.indexOf('level-') === 0){
    area.innerHTML = _renderLevelMenu(levels, grouped);
    return;
  }
  if(_entryView.indexOf('practice-') === 0){
    area.innerHTML = _renderPracticeList(levels, grouped);
    return;
  }
  if(_entryView.indexOf('exam-') === 0){
    area.innerHTML = _renderExamList(levels);
    return;
  }

  // ── Main Home Dashboard ──
  var totalAnswered = stats.answered || 0;
  var accuracy = totalAnswered > 0 ? Math.round((stats.correct || 0) / totalAnswered * 100) : 0;
  var streak = stats.streak || 0;
  var passPct = Math.min(accuracy, 95);

  // Find weak topics from per-framework historical data
  var weakTopics = [];
  var fwMastery = stats.fwMastery || {};
  var hasFwData = Object.keys(fwMastery).length > 0;
  modules.forEach(function(m){
    if(hasFwData){
      m.frameworks.forEach(function(fw){
        var key = m.id + ':' + fw.id;
        var fwData = fwMastery[key];
        if(fwData && fwData.total > 0){
          if(fwData.pct < 60){
            weakTopics.push({ title: fw.name, module: m.id, acc: fwData.pct, attempts: fwData.total });
          }
        }
      });
    } else {
      // Fallback: module-level mastery
      var mastery = stats.moduleMastery ? (stats.moduleMastery[m.id] || 0) : 0;
      if(mastery < 60 && mastery > 0){
        m.frameworks.forEach(function(fw){
          weakTopics.push({ title: fw.name, module: m.id, acc: mastery, attempts: 0 });
        });
      }
    }
  });
  weakTopics.sort(function(a, b){ return a.acc - b.acc; });
  weakTopics = weakTopics.slice(0, 5);

  var html = '';

  // ── Hero ──
  html += '<section class="home-hero">';
  html += '<div>';
  html += '<h1 class="hero-title">用<em>三個問題</em>，把淨零<br>從名詞變成你的直覺。</h1>';
  html += '<p class="hero-lede">' + TQE.escHtml(TQE.term('framework')) + '（What / Why / How）→ 爭議（產業正反辯證）→ 鑑別（高鑑別考古題）。我們不給你 200 頁 PDF，我們給你能上考場、上會議室的理解。</p>';
  html += '<div class="hero-actions">';
  if(modules.length > 0){
    html += '<button class="btn btn-primary btn-lg" onclick="TQE_UI.setEntryView(\'practice-l1\')">開始學習</button>';
  }
  html += '</div>';
  html += '</div>';

  // Hero stats card
  html += '<aside class="hero-stats">';
  html += '<div class="hero-stats-head"><div class="hero-stats-title">我的學習儀表板</div></div>';
  html += '<div class="readiness">';
  html += '<div class="readiness-ring" style="--pct:' + passPct + '"><span>' + passPct + '<sup>%</sup></span></div>';
  html += '<div class="readiness-copy"><strong>模擬通過機率</strong><span>基於歷史作答</span></div>';
  html += '</div>';
  html += '<div class="hero-stats-grid">';
  html += '<div><b>' + totalAnswered + '</b><span>已作答題數</span></div>';
  html += '<div><b>' + accuracy + '<span style="font-size:14px;color:var(--text-mute)">%</span></b><span>平均正確率</span></div>';
  html += '<div><b>' + streak + '</b><span>連續學習天</span></div>';
  html += '</div>';
  html += '</aside>';
  html += '</section>';

  // ── Module Grid ──
  html += '<section class="section">';
  html += '<div class="section-head"><div><h2>學習模組</h2><p>依 iPAS 考綱整理，每個模組都以三問法拆解' + TQE.escHtml(TQE.term('framework')) + '。</p></div></div>';

  levels.forEach(function(lv){
    var mods = grouped[lv.id] || [];
    if(mods.length === 0) return;
    var lock = lv.requiresLogin && !TQE.isLoggedIn();

    html += '<div style="margin-bottom:var(--space-4);">';
    html += '<div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-3);">';
    html += '<h3 style="margin:0;font-size:18px;font-weight:600;">' + TQE.escHtml(lv.name) + '</h3>';
    if(lv.requiresLogin){
      html += '<span class="tag tag-accent">' + (lock ? '需登入' : '已登入') + '</span>';
    }
    html += '</div>';

    html += '<div class="modules">';
    mods.forEach(function(m){
      var mastery = stats.moduleMastery ? (stats.moduleMastery[m.id] || 0) : 0;
      var isWeak = mastery > 0 && mastery < 50;

      html += '<article class="module" onclick="TQE_UI.selectModule(\'' + m.id + '\')">';
      if(isWeak) html += '<span class="module-flag">弱項</span>';
      if(lock) html += '<span class="module-flag">🔒</span>';
      html += '<div class="module-head"><div>';
      html += '<div class="module-num">' + TQE.escHtml(m.id) + '</div>';
      html += '<h3 class="module-title">' + TQE.escHtml(m.name) + '</h3>';
      html += '</div></div>';
      html += '<p class="module-desc">' + m.frameworks.length + ' 個' + TQE.escHtml(TQE.term('framework')) + ' · ' + m.questions.length + ' 題</p>';
      html += '<div>';
      html += '<div class="module-mastery">熟練度 ' + mastery + '%</div>';
      html += '<div class="module-bar"><span style="width:' + mastery + '%"></span></div>';
      html += '</div>';
      html += '<div class="module-meta"><div class="module-stats">';
      if(m.examSubject) html += '<div><span>考科</span><b>' + TQE.escHtml(m.examSubject.name) + '</b></div>';
      html += '</div></div>';
      html += '</article>';
    });
    html += '</div></div>';
  });
  html += '</section>';

  // ── Weak Topics ──
  if(weakTopics.length > 0){
    html += '<section class="section" style="padding-top:0;">';
    html += '<div class="section-head"><div><h2>AI 找出你的弱點</h2><p>根據你的作答，系統為你挑出最值得補強的主題。</p></div></div>';
    html += '<div class="weak-row">';
    html += '<div class="weak-list">';
    weakTopics.forEach(function(w, i){
      html += '<div class="weak-item">';
      html += '<div class="weak-rank">' + (i + 1) + '</div>';
      html += '<div class="weak-topic"><strong>' + TQE.escHtml(w.title) + '</strong><span>' + TQE.escHtml(w.module) + '</span></div>';
      html += '<div class="weak-acc">' + w.acc + '%</div>';
      html += '</div>';
    });
    html += '</div>';
    // Today's recommendation card
    html += '<div class="card card-pad" style="display:flex;flex-direction:column;gap:var(--space-4);">';
    html += '<div class="label-eyebrow">今日推薦</div>';
    html += '<h3 style="margin:0;font-size:20px;letter-spacing:-0.01em;">弱項衝刺</h3>';
    html += '<p style="margin:0;color:var(--text-soft);font-size:14px;line-height:1.6;">由系統依你的錯題分布排程：鑑別題 + 爭議案例 + 複習題。</p>';
    html += '<hr class="h-rule" style="margin:0">';
    html += '<div style="display:flex;justify-content:flex-end;"><button class="btn btn-primary btn-sm" onclick="TQE_UI.setEntryView(\'practice-l1\')">開始</button></div>';
    html += '</div>';
    html += '</div>';
    html += '</section>';
  }

  // ── Exam shortcut ──
  html += '<section class="section" style="padding-top:0;">';
  html += '<div class="section-head"><div><h2>模擬考</h2><p>按考科範圍模擬正式考試，計時作答。</p></div></div>';
  html += '<div style="display:flex;gap:var(--space-3);flex-wrap:wrap;">';
  levels.forEach(function(lv){
    html += '<button class="btn btn-outline" onclick="TQE_UI.setEntryView(\'exam-' + lv.id + '\')">' + TQE.escHtml(lv.name) + ' 模擬考</button>';
  });
  html += '</div>';
  html += '</section>';

  area.innerHTML = html;
  updateTopNav('tqeScreenEntry');
}

function _renderLevelMenu(levels, grouped){
  var lvId = _entryView.replace('level-', '');
  var lv = levels.find(function(l){ return l.id === lvId; });
  var lvName = lv ? lv.name : lvId;

  // Login gate for l2
  if(lvId === 'l2' && !TQE.isLoggedIn()){
    return '<div class="section" style="max-width:600px;margin:var(--space-7) auto;">' +
      _backBtn('home') +
      '<div class="info" style="text-align:center;background:var(--accent-soft);border-left:4px solid var(--accent);">' +
      '<strong>中級需要 Google 登入</strong><br>請先點擊上方登入按鈕。</div></div>';
  }

  return '<div class="section" style="max-width:600px;margin:var(--space-7) auto;">' +
    _backBtn('home') +
    '<h2 style="margin-bottom:var(--space-4);">' + TQE.escHtml(lvName) + ' — 選擇模式</h2>' +
    '<div class="card card-pad" style="cursor:pointer;border-left:3px solid var(--forest-600);margin-bottom:var(--space-3);" onclick="TQE_UI.setEntryView(\'practice-' + lvId + '\')">' +
    '<h3 style="margin:0;">練習（選模組）</h3>' +
    '<p style="font-size:14px;color:var(--text-soft);margin:var(--space-2) 0 0;">依模組逐步學習：框架建立 → 邊界校正 → 鑑別測驗 → 弱項練習</p></div>' +
    '<div class="card card-pad" style="cursor:pointer;border-left:3px solid var(--amber);margin-bottom:var(--space-3);" onclick="TQE_UI.setEntryView(\'exam-' + lvId + '\')">' +
    '<h3 style="margin:0;">模擬考（選考科）</h3>' +
    '<p style="font-size:14px;color:var(--text-soft);margin:var(--space-2) 0 0;">按考科範圍模擬正式考試，計時作答</p></div>' +
    '</div>';
}

function _renderPracticeList(levels, grouped){
  var lvId = _entryView.replace('practice-', '');
  var lv = levels.find(function(l){ return l.id === lvId; });
  var mods = grouped[lvId] || [];
  var stats = _loadStats();

  var html = '<div class="section" style="max-width:600px;margin:var(--space-7) auto;">';
  html += _backBtn('level-' + lvId);
  html += '<h2 style="margin-bottom:var(--space-4);">' + TQE.escHtml(lv ? lv.name : '') + ' — 選擇學習模組</h2>';

  mods.forEach(function(m){
    var mastery = stats.moduleMastery ? (stats.moduleMastery[m.id] || 0) : 0;
    var examLabel = m.examSubject ? '<p style="font-size:12px;color:var(--text-mute);margin-top:var(--space-1);">對應考科：' + TQE.escHtml(m.examSubject.name) + '</p>' : '';
    html += '<div class="card card-pad" style="cursor:pointer;margin-bottom:var(--space-3);" onclick="TQE_UI.selectModule(\'' + m.id + '\')">' +
      '<h3 style="margin:0 0 var(--space-1);">' + TQE.escHtml(m.id + ' — ' + m.name) + '</h3>' +
      '<p style="font-size:14px;color:var(--text-soft);margin:0;">' + m.frameworks.length + ' 個' + TQE.escHtml(TQE.term('framework')) + ' | ' + m.questions.length + ' 題 | 熟練度 ' + mastery + '%</p>' +
      examLabel + '</div>';
  });
  html += '</div>';
  return html;
}

function _renderExamList(levels){
  var lvId = _entryView.replace('exam-', '');
  var lv = levels.find(function(l){ return l.id === lvId; });
  var subjects = TQE.getSubjects();
  var lvSubjects = subjects.filter(function(s){ return s.level === lvId; });

  // Login gate for l1 exam
  if(lvId === 'l1' && !TQE.isLoggedIn()){
    return '<div class="section" style="max-width:600px;margin:var(--space-7) auto;">' +
      _backBtn('level-' + lvId) +
      '<div class="info" style="text-align:center;background:var(--accent-soft);border-left:4px solid var(--accent);">' +
      '<strong>模擬考需要 Google 登入</strong><br>請先點擊上方登入按鈕。</div></div>';
  }

  var html = '<div class="section" style="max-width:600px;margin:var(--space-7) auto;">';
  html += _backBtn('level-' + lvId);
  html += '<h2 style="margin-bottom:var(--space-4);">' + TQE.escHtml(lv ? lv.name : '') + ' — 選擇考科</h2>';

  lvSubjects.forEach(function(subj){
    html += '<div class="card card-pad" style="cursor:pointer;border-left:3px solid var(--amber);margin-bottom:var(--space-3);" onclick="TQE_UI.startSubjectExam(\'' + subj.id + '\')">' +
      '<h3 style="margin:0 0 var(--space-1);">' + TQE.escHtml(subj.name) + '</h3>' +
      '<p style="font-size:14px;color:var(--text-soft);margin:0;">' + subj.total + ' 題 | ' + subj.duration + ' 分鐘</p>' +
      '<p style="font-size:12px;color:var(--text-mute);margin:var(--space-1) 0 0;">涵蓋模組：' + TQE.escHtml(subj.modules.join('、')) + '</p></div>';
  });
  if(lvSubjects.length === 0){
    html += '<div class="info" style="text-align:center;background:var(--accent-soft);">此等級尚無考科設定</div>';
  }
  html += '</div>';
  return html;
}

function _backBtn(target){
  return '<button class="btn btn-ghost" onclick="TQE_UI.setEntryView(\'' + target + '\')" style="margin-bottom:var(--space-4);">← 返回</button>';
}

function setEntryView(view){
  _entryView = view;
  renderEntry();
}

function startSubjectExam(subjectId){
  var subjects = TQE.getSubjects();
  var subj = subjects.find(function(s){ return s.id === subjectId; });
  if(!subj) return;
  state.examSubjectId = subjectId;
  if(subj.modules.length > 0) state.moduleId = subj.modules[0];
  if(typeof global.TQE_Layer2 !== 'undefined' && global.TQE_Layer2.goExam){
    global.TQE_Layer2.goExam();
  } else {
    alert('模擬考模組未載入');
  }
}

function showExamSelection(){
  var mod = TQE.getModule(state.moduleId);
  var lvId = mod ? (mod.level || 'l1') : 'l1';
  _entryView = 'exam-' + lvId;
  renderEntry();
  showScreen('tqeScreenEntry');
}

function selectModule(id){
  var module = TQE.getModule(id);
  if(!module) return;

  // Check login requirement
  var levels = TQE.getLevels();
  var lv = levels.find(function(l){ return l.id === module.level; });
  if(lv && lv.requiresLogin && !TQE.isLoggedIn()){
    var authStatus = document.getElementById('tqeAuthStatus');
    if(authStatus) authStatus.textContent = '此模組需要 Google 登入';
    return;
  }

  state.moduleId = id;
  // Go to Learn screen (3-tab view)
  renderLearnScreen(id);
  showScreen('tqeScreenLearn');
}

// ─── Learn Screen (3-tab view) ───
var _learnTab = 'framework';

function renderLearnScreen(moduleId){
  var mid = moduleId || state.moduleId;
  var mod = TQE.getModule(mid);
  if(!mod) return;

  state.moduleId = mid;
  _learnTab = 'framework';
  _renderLearnAll(mod);
}

function _renderLearnAll(mod){
  // Breadcrumbs + head
  var headEl = document.getElementById('tqeLearnHead');
  if(headEl){
    headEl.innerHTML = '<div class="learn-crumbs">' +
      '<a onclick="TQE_UI.showScreen(\'tqeScreenEntry\');TQE_UI.setEntryView(\'home\');" style="cursor:pointer;">首頁</a>' +
      ' <span style="color:var(--text-mute);">›</span> ' +
      '<a onclick="TQE_UI.showScreen(\'tqeScreenEntry\');TQE_UI.setEntryView(\'home\');" style="cursor:pointer;">模組</a>' +
      ' <span style="color:var(--text-mute);">›</span> ' +
      '<span style="color:var(--text);">' + TQE.escHtml(mod.id + ' ' + mod.name) + '</span></div>' +
      '<h1 class="learn-title">' + TQE.escHtml(mod.name) + '</h1>' +
      '<div class="learn-meta">' +
      '<span>' + mod.frameworks.length + ' 個' + TQE.escHtml(TQE.term('framework')) + '</span>' +
      '<span>' + mod.questions.length + ' 題</span>' +
      '<span>熟練度 ' + (_loadStats().moduleMastery ? (_loadStats().moduleMastery[mod.id] || 0) : 0) + '%</span>' +
      '</div>';
  }

  // Three-Q tabs
  var tabsEl = document.getElementById('tqeThreeQTabs');
  if(tabsEl){
    var tabs = [
      { id: 'framework', label: '1 · FRAMEWORK', name: '框架' },
      { id: 'controversy', label: '2 · CONTROVERSY', name: '爭議' },
      { id: 'discrimination', label: '3 · DISCRIMINATION', name: '鑑別' }
    ];
    var tabHtml = '';
    tabs.forEach(function(t){
      var active = _learnTab === t.id ? ' active' : '';
      tabHtml += '<button class="' + active + '" onclick="TQE_UI._switchLearnTab(\'' + t.id + '\')">' +
        '<span class="three-q-label">' + t.label + '</span>' +
        '<span class="three-q-name">' + t.name + '</span></button>';
    });
    tabsEl.innerHTML = tabHtml;
  }

  // Left sidebar: TOC
  var tocEl = document.getElementById('tqeLearnTOC');
  if(tocEl){
    var tocItems = [
      { id: 'framework', label: '框架：What / Why / How', step: '1' },
      { id: 'controversy', label: '爭議：兩造辯證', step: '2' },
      { id: 'discrimination', label: '鑑別題：情境應用', step: '3' },
      { id: 'wrap', label: '本節總結', step: '4' }
    ];
    var tocHtml = '<div class="side-title">本模組章節</div><div class="toc">';
    tocItems.forEach(function(t){
      var active = _learnTab === t.id ? ' active' : '';
      var clickable = t.id !== 'wrap' ? ' onclick="TQE_UI._switchLearnTab(\'' + t.id + '\')"' : '';
      tocHtml += '<div class="toc-item' + active + '"' + clickable + '>' +
        '<div class="toc-step"><span>' + t.step + '</span></div>' +
        '<span>' + t.label + '</span></div>';
    });
    tocHtml += '</div>';
    tocEl.innerHTML = tocHtml;
  }

  // Left sidebar: progress
  var progEl = document.getElementById('tqeLearnProgress');
  if(progEl){
    var mastery = _loadStats().moduleMastery ? (_loadStats().moduleMastery[mod.id] || 0) : 0;
    progEl.innerHTML = '<div class="side-title">模組進度</div>' +
      '<div style="font-size:13px;color:var(--text-mute);margin-bottom:8px;">熟練度 ' + mastery + '%</div>' +
      '<div class="module-bar"><span style="width:' + mastery + '%"></span></div>';
  }

  // Right sidebar: concept map
  var conceptEl = document.getElementById('tqeConceptMap');
  if(conceptEl){
    var stats = _loadStats();
    var cmHtml = '<div class="concept-map"><h4>關鍵概念地圖</h4><div>';
    mod.frameworks.forEach(function(fw){
      var mastery = stats.moduleMastery ? (stats.moduleMastery[mod.id] || 0) : 0;
      var cls = mastery > 0 && mastery < 50 ? 'concept-pill weak' : (mastery >= 70 ? 'concept-pill strong' : 'concept-pill');
      cmHtml += '<span class="' + cls + '">' + TQE.escHtml(fw.name) + '</span>';
    });
    cmHtml += '</div><hr class="h-rule">';
    cmHtml += '<div style="font-size:12px;color:var(--text-mute);line-height:1.6;">綠色：熟練概念 · 紅色：系統偵測的弱點。</div></div>';
    conceptEl.innerHTML = cmHtml;
  }

  // Content area
  _renderLearnTabContent(mod);

  // Footer
  _renderLearnFooter(mod);
}

function _switchLearnTab(tabId){
  _learnTab = tabId;
  var mod = TQE.getModule(state.moduleId);
  if(!mod) return;
  _renderLearnAll(mod);
}

function _renderLearnTabContent(mod){
  var el = document.getElementById('tqeLearnContent');
  if(!el) return;

  var html = '';

  if(_learnTab === 'framework'){
    html += '<div class="lede">';
    html += '<div class="framework">';
    html += '<div class="framework-title">三問法 · ' + TQE.escHtml(TQE.term('framework')) + '節點</div>';
    html += '<div class="framework-grid">';
    mod.frameworks.forEach(function(fw){
      html += '<div class="framework-node">';
      html += '<b>' + TQE.escHtml(fw.id) + ' — ' + TQE.escHtml(fw.name) + '</b>';
      html += '<span>' + TQE.escHtml(fw.desc) + '</span>';
      html += '</div>';
    });
    html += '</div></div>';

    // Star rating section
    html += '<h3>評估你對每個' + TQE.escHtml(TQE.term('framework')) + '的熟悉程度</h3>';
    mod.frameworks.forEach(function(fw, idx){
      html += '<div class="fw-card" id="fw-' + fw.id + '">' +
        '<span class="fw-num">' + (idx+1) + '</span>' +
        '<span class="fw-title">' + TQE.escHtml(fw.name) + '</span>' +
        '<div class="fw-desc">' + TQE.escHtml(fw.desc) + '</div>' +
        (fw.analogy ? '<div class="fw-analogy">' + TQE.escHtml(fw.analogy) + '</div>' : '') +
        '<div class="self-rate">';
      for(var s=1; s<=5; s++){
        var lit = (state.phase1.ratings[fw.id] || 0) >= s ? ' lit' : '';
        html += '<span class="star' + lit + '" data-fw="' + fw.id + '" data-val="' + s + '" onclick="TQE_UI.rateFramework(\'' + fw.id + '\',' + s + ')">★</span>';
      }
      html += '</div></div>';
    });
    html += '</div>';
  }

  if(_learnTab === 'controversy'){
    html += '<div class="lede">';
    html += '<p>每一條路徑，都會在產業內引起一次爭論。我們不跳過爭論——<strong>爭論本身就是考點</strong>。選邊站，才能真正理解。</p>';
    mod.debates.forEach(function(d){
      var hasChosen = state.phase2.choices[d.id];
      html += '<div class="debate-scenario" id="learnDebate-' + d.id + '">';
      html += '<h3>' + TQE.escHtml(d.title) + '</h3>';
      html += '<p>' + TQE.escHtml(d.scenario) + '</p>';
      html += '<div class="side-btns">';
      html += '<button class="side-btn' + (hasChosen === 'A' ? ' chosen-a' : '') + '" onclick="TQE_UI._learnChooseSide(\'' + d.id + '\',\'A\')">' + TQE.escHtml(d.sideA.label) + '</button>';
      html += '<button class="side-btn' + (hasChosen === 'B' ? ' chosen-b' : '') + '" onclick="TQE_UI._learnChooseSide(\'' + d.id + '\',\'B\')">' + TQE.escHtml(d.sideB.label) + '</button>';
      html += '</div>';
      html += '<div class="debate-reveal' + (hasChosen ? ' show' : '') + '" id="learnReveal-' + d.id + '">';
      html += '<div class="info blue"><strong>正方：</strong>' + (d.sideA.args || []).map(TQE.escHtml).join('；') + '</div>';
      html += '<div class="info gold"><strong>反方：</strong>' + (d.sideB.args || []).map(TQE.escHtml).join('；') + '</div>';
      if(d.insight) html += '<div class="info green"><strong>洞察：</strong>' + TQE.escHtml(d.insight) + '</div>';
      html += '</div></div>';
    });
    html += '</div>';
  }

  if(_learnTab === 'discrimination'){
    // Show overview + start button — actual quiz runs in Phase 3 screen (with full AI chat)
    var answered = 0;
    mod.questions.forEach(function(q){ if(state.phase3.answers[q.id]) answered++; });
    var totalQ = mod.questions.length;

    html += '<div class="lede">';
    html += '<p>接下來進入 <strong>' + totalQ + ' 題鑑別測驗</strong>，每答錯一題，AI 會即時追問幫你釐清盲區。</p>';

    if(answered > 0 && answered >= totalQ){
      html += '<div class="info green" style="margin:var(--space-4) 0;"><strong>已完成！</strong>你已完成本模組全部 ' + totalQ + ' 題鑑別測驗。</div>';
      html += '<button class="btn btn-primary" style="width:100%;" onclick="TQE_UI.goReport()">查看弱點分析報告 →</button>';
    } else if(answered > 0){
      html += '<div class="info blue" style="margin:var(--space-4) 0;">已答 ' + answered + ' / ' + totalQ + ' 題，可繼續作答。</div>';
      html += '<button class="btn btn-primary" style="width:100%;" onclick="TQE_UI._startPhase3FromLearn()">繼續鑑別測驗（' + (totalQ - answered) + ' 題） →</button>';
    } else {
      html += '<div style="margin:var(--space-4) 0;padding:var(--space-4);background:var(--bg-soft);border-radius:var(--radius);border:1px solid var(--border);">';
      html += '<div style="display:flex;gap:var(--space-3);flex-wrap:wrap;">';
      mod.frameworks.forEach(function(fw){
        var fwQCount = mod.questions.filter(function(q){ return q.framework === fw.id; }).length;
        html += '<span class="tag">' + TQE.escHtml(fw.name) + ' · ' + fwQCount + ' 題</span>';
      });
      html += '</div></div>';
      html += '<button class="btn btn-primary" style="width:100%;margin-top:var(--space-4);" onclick="TQE_UI._startPhase3FromLearn()">開始鑑別測驗（' + totalQ + ' 題 + AI 追問） →</button>';
    }
    html += '</div>';
  }

  el.innerHTML = html;
}

function _learnChooseSide(debateId, side){
  state.phase2.choices[debateId] = side;
  var btns = document.querySelectorAll('#learnDebate-' + debateId + ' .side-btn');
  btns.forEach(function(b){ b.className = 'side-btn'; });
  btns[side === 'A' ? 0 : 1].classList.add('chosen-' + side.toLowerCase());
  var reveal = document.getElementById('learnReveal-' + debateId);
  if(reveal) reveal.classList.add('show');
}

function _startPhase3FromLearn(){
  // Transition from Learn screen to full Phase 3 with AI chat
  state.startTime = state.startTime || Date.now();
  // Find first unanswered question
  var mod = TQE.getModule(state.moduleId);
  if(!mod) return;
  var firstUnanswered = 0;
  for(var i = 0; i < mod.questions.length; i++){
    if(!state.phase3.answers[mod.questions[i].id]){ firstUnanswered = i; break; }
  }
  state.currentQ = firstUnanswered;
  renderPhase3();
  showScreen('tqeScreenPhase3');
}

function _renderLearnFooter(mod){
  var footerEl = document.getElementById('tqeLearnFooter');
  if(!footerEl) return;
  var tabs = ['framework', 'controversy', 'discrimination'];
  var idx = tabs.indexOf(_learnTab);
  var prevDisabled = idx <= 0 ? ' disabled style="opacity:.3;cursor:default;"' : '';
  var nextLabel = idx >= tabs.length - 1 ? '開始鑑別測驗' : '下一步';
  var nextAction = idx >= tabs.length - 1
    ? 'TQE_UI._startPhase3FromLearn()'
    : 'TQE_UI._switchLearnTab(\'' + tabs[idx + 1] + '\')';
  var prevAction = idx > 0 ? 'TQE_UI._switchLearnTab(\'' + tabs[idx - 1] + '\')' : '';

  footerEl.innerHTML =
    '<button class="btn btn-ghost"' + prevDisabled + ' onclick="' + prevAction + '">← 上一步</button>' +
    '<button class="btn btn-primary" onclick="' + nextAction + '">' + nextLabel + ' →</button>';
}

// ─── Start Learning (Phase 1 flow) ───
function startLearning(){
  state.startTime = Date.now();
  renderPhase1();
  showScreen('tqeScreenPhase1');
}

// ─── Phase 1: Framework Rating ───
function renderPhase1(){
  var mod = TQE.getModule(state.moduleId);
  if(!mod) return;
  var area = document.getElementById('tqePhase1Area');
  if(!area) return;

  var html = '<div class="phase-header fade-in">' +
    '<div class="phase-tag" style="background:var(--forest-600);">Phase 1</div>' +
    '<h2>框架建立</h2>' +
    '<p>評估你對每個' + TQE.escHtml(TQE.term('framework')) + '的熟悉程度</p></div>';

  mod.frameworks.forEach(function(fw, idx){
    html += '<div class="fw-card" id="fw-' + fw.id + '">' +
      '<span class="fw-num">' + (idx+1) + '</span>' +
      '<span class="fw-title">' + TQE.escHtml(fw.name) + '</span>' +
      '<div class="fw-desc">' + TQE.escHtml(fw.desc) + '</div>' +
      (fw.analogy ? '<div class="fw-analogy">' + TQE.escHtml(fw.analogy) + '</div>' : '') +
      '<div class="self-rate">';
    for(var s=1; s<=5; s++){
      html += '<span class="star" data-fw="' + fw.id + '" data-val="' + s + '" onclick="TQE_UI.rateFramework(\'' + fw.id + '\',' + s + ')">★</span>';
    }
    html += '</div></div>';
  });

  html += '<button class="btn btn-primary" style="display:block;width:100%;margin-top:var(--space-5);" id="tqeBtnP1Next" onclick="TQE_UI.goPhase2()" disabled>所有' + TQE.escHtml(TQE.term('framework')) + '都評分後才能繼續 →</button>';
  area.innerHTML = html;
}

function rateFramework(fwId, val){
  state.phase1.ratings[fwId] = val;
  document.querySelectorAll('.star[data-fw="' + fwId + '"]').forEach(function(s){
    s.classList.toggle('lit', parseInt(s.dataset.val) <= val);
  });
  var mod = TQE.getModule(state.moduleId);
  var allRated = mod.frameworks.every(function(fw){ return state.phase1.ratings[fw.id]; });
  var btn = document.getElementById('tqeBtnP1Next');
  if(btn) btn.disabled = !allRated;
}

// ─── Phase 2: Debate / Boundary Check ───
function goPhase2(){
  TQE.saveProgress('phase1_complete');
  TQE.saveSession();
  renderPhase2();
  showScreen('tqeScreenPhase2');
}

function renderPhase2(){
  var mod = TQE.getModule(state.moduleId);
  if(!mod) return;
  var area = document.getElementById('tqePhase2Area');
  if(!area) return;

  var html = '<div class="phase-header fade-in">' +
    '<div class="phase-tag" style="background:var(--amber);">Phase 2</div>' +
    '<h2>邊界校正</h2>' +
    '<p>專家也會爭論的情境，你選哪邊？</p></div>';

  mod.debates.forEach(function(d){
    html += '<div class="debate-scenario" id="debate-' + d.id + '">' +
      '<h3>' + TQE.escHtml(d.title) + '</h3>' +
      '<p>' + TQE.escHtml(d.scenario) + '</p>' +
      '<div class="side-btns">' +
      '<button class="side-btn" onclick="TQE_UI.chooseDebateSide(\'' + d.id + '\',\'A\')">' + TQE.escHtml(d.sideA.label) + '</button>' +
      '<button class="side-btn" onclick="TQE_UI.chooseDebateSide(\'' + d.id + '\',\'B\')">' + TQE.escHtml(d.sideB.label) + '</button>' +
      '</div>' +
      '<div class="debate-reveal" id="reveal-' + d.id + '">' +
      '<div class="info blue"><strong>正方：</strong>' + (d.sideA.args || []).map(TQE.escHtml).join('；') + '</div>' +
      '<div class="info gold"><strong>反方：</strong>' + (d.sideB.args || []).map(TQE.escHtml).join('；') + '</div>' +
      '<div class="info green"><strong>洞察：</strong>' + TQE.escHtml(d.insight) + '</div>' +
      '</div></div>';
  });

  html += '<button class="btn btn-primary" style="display:block;width:100%;margin-top:var(--space-5);" id="tqeBtnP2Next" onclick="TQE_UI.goPhase3()" disabled>全部選完後才能繼續 →</button>';
  area.innerHTML = html;
}

function chooseDebateSide(debateId, side){
  state.phase2.choices[debateId] = side;
  var btns = document.querySelectorAll('#debate-' + debateId + ' .side-btn');
  btns.forEach(function(b){ b.className = 'side-btn'; });
  btns[side === 'A' ? 0 : 1].classList.add('chosen-' + side.toLowerCase());
  var reveal = document.getElementById('reveal-' + debateId);
  if(reveal) reveal.classList.add('show');

  var mod = TQE.getModule(state.moduleId);
  var allChosen = mod.debates.every(function(d){ return state.phase2.choices[d.id]; });
  var btn = document.getElementById('tqeBtnP2Next');
  if(btn) btn.disabled = !allChosen;
}

// ─── Phase 3: Quiz ───
function goPhase3(){
  TQE.saveProgress('phase2_complete');
  TQE.saveSession();
  state.currentQ = 0;
  renderPhase3();
  showScreen('tqeScreenPhase3');
}

function renderPhase3(){
  var mod = TQE.getModule(state.moduleId);
  if(!mod) return;
  var area = document.getElementById('tqePhase3Area');
  if(!area) return;

  var html = '<div class="phase-header fade-in">' +
    '<div class="phase-tag" style="background:var(--clay);">Phase 3</div>' +
    '<h2>鑑別測驗</h2>' +
    '<p>找出你真正的知識缺口</p></div>';

  mod.questions.forEach(function(q, idx){
    html += '<div class="fade-in" id="qWrap-' + q.id + '" style="' + (idx > 0 ? 'display:none;' : '') + '">' +
      '<div class="quiz-stem"><span class="q-num">Q' + (idx+1) + '</span> ' + TQE.escHtml(q.stem) + '</div>' +
      '<div id="opts-' + q.id + '">';
    q.options.forEach(function(o){
      html += '<button class="option-btn" id="opt-' + q.id + '-' + o.key + '" onclick="TQE_UI.answerQ(\'' + q.id + '\',\'' + o.key + '\')">' +
        '<span class="opt-label">' + o.key + '</span>' + TQE.escHtml(o.text) + '</button>';
    });
    html += '</div><div id="feedback-' + q.id + '" style="margin-top:1rem;"></div></div>';
  });

  area.innerHTML = html;
}

function answerQ(qid, chosen){
  var mod = TQE.getModule(state.moduleId);
  var q = mod.questions.find(function(x){ return x.id === qid; });
  var isCorrect = chosen === q.correct;

  document.querySelectorAll('#opts-' + qid + ' .option-btn').forEach(function(b){ b.classList.add('locked'); });
  document.getElementById('opt-' + qid + '-' + q.correct).classList.add('correct');
  if(!isCorrect) document.getElementById('opt-' + qid + '-' + chosen).classList.add('wrong');

  state.phase3.answers[qid] = chosen;
  var chosenOpt = q.options.find(function(o){ return o.key === chosen; });
  state.phase3.scores[qid] = chosenOpt ? (chosenOpt.depth || 1) : 1;
  TQE.saveBlindSpot(q, chosen, isCorrect);

  var fb = document.getElementById('feedback-' + qid);
  if(isCorrect){
    var fw = mod.frameworks.find(function(f){ return f.id === q.framework; });
    fb.innerHTML = '<div class="info green"><strong>正確！</strong> 對應' + TQE.term('framework') + '「' + (fw ? fw.name : '') + '」。</div>' +
      _reportLink(state.moduleId, qid) +
      '<button class="btn btn-primary" style="display:block;width:100%;margin-top:.8rem;" onclick="TQE_UI.nextQ()">下一題 →</button>';
  } else {
    var diag = q.diagnosis ? q.diagnosis[chosen] : null;
    var hasDiag = diag && diag.gap && diag.gap !== '';
    var lectureLinks = TQE.getLectureLinks(state.moduleId, q.framework);
    var fw = mod.frameworks.find(function(f){ return f.id === q.framework; });
    var correctText = q.options.find(function(o){ return o.key === q.correct; })?.text || '';
    var chosenText = q.options.find(function(o){ return o.key === chosen; })?.text || '';

    var initialFollowup;
    if(hasDiag && diag.followup){
      initialFollowup = diag.followup;
    } else {
      initialFollowup = '你選的「' + chosenText.substring(0, 30) + '」，但正確答案是「' + correctText.substring(0, 30) + '」。這兩者的關鍵差異在哪？打字告訴我你的想法，AI 會根據你的回應分析。';
    }

    var headerInfo = hasDiag
      ? '<div class="info red"><strong>你的思路：</strong>' + TQE.escHtml(diag.gap) + '</div>'
      : '<div class="info red"><strong>答案是 ' + q.correct + '</strong>。' + TQE.escHtml(q.explanation || '') + '</div>';

    fb.innerHTML = headerInfo +
      (lectureLinks ? '<div class="info blue" style="margin-top:.5rem;"><strong>去這裡補強：</strong>' + lectureLinks + '</div>' : '') +
      '<div class="tqe-chat" id="chat-' + qid + '">' +
      '<div class="tqe-chat-header">AI 追問引擎</div>' +
      '<div class="tqe-chat-body" id="chatBody-' + qid + '">' +
      '<div class="tqe-chat-msg from-ai">' + TQE.escHtml(initialFollowup) + '</div>' +
      '</div>' +
      '<div class="tqe-chat-input">' +
      '<input type="text" id="chatInput-' + qid + '" placeholder="輸入你的想法..." onkeydown="if(event.key===\'Enter\'){event.preventDefault();TQE_UI.sendChat(\'' + qid + '\');}">' +
      '<button onclick="TQE_UI.sendChat(\'' + qid + '\')">送出</button>' +
      '</div></div>' +
      _reportLink(state.moduleId, qid) +
      '<button class="btn btn-secondary" style="display:block;width:100%;margin-top:.8rem;" onclick="TQE_UI.nextQ()">繼續下一題 →</button>';
  }
}

function nextQ(){
  var mod = TQE.getModule(state.moduleId);
  state.currentQ++;
  if(state.currentQ >= mod.questions.length){
    goReport();
    return;
  }
  var wraps = document.querySelectorAll('#tqePhase3Area [id^="qWrap-"]');
  wraps.forEach(function(w, i){ w.style.display = i === state.currentQ ? '' : 'none'; });
  window.scrollTo(0, document.getElementById('tqePhase3Area').offsetTop);
}

// ─── Phase 4: Report ───
function goReport(){
  TQE.saveProgress('phase3_complete');
  TQE.saveSession();
  _updateStatsAfterPhase3();
  renderReport();
  showScreen('tqeScreenPhase4');
}

function renderReport(){
  var mod = TQE.getModule(state.moduleId);
  if(!mod) return;
  var area = document.getElementById('tqePhase4Area');
  if(!area) return;

  // Calculate per-framework scores
  var fwScores = {};
  mod.frameworks.forEach(function(f){ fwScores[f.id] = { total: 0, count: 0, name: f.name }; });
  mod.questions.forEach(function(q){
    var score = state.phase3.scores[q.id] || 0;
    if(fwScores[q.framework]){ fwScores[q.framework].total += score; fwScores[q.framework].count++; }
  });

  var weakFws = [];
  var correct = mod.questions.filter(function(q){ return state.phase3.answers[q.id] === q.correct; }).length;
  var total = Object.keys(state.phase3.answers).length;
  var pct = total > 0 ? Math.round(correct / total * 100) : 0;
  var elapsed = state.startTime ? Math.round((Date.now() - state.startTime) / 60000) : 0;
  var avgSec = total > 0 ? Math.round(elapsed * 60 / total) : 0;

  var html = '';

  // ── Score ring + KPIs (ResultScreen style) ──
  html += '<div class="result-hero">';
  html += '<div class="result-ring" style="--pct:' + pct + '">';
  html += '<div class="result-ring-inner"><b>' + pct + '</b><span>本次分數</span></div>';
  html += '</div>';
  html += '<div class="result-hero-copy">';
  html += '<div class="label-eyebrow">弱點分析 · ' + TQE.escHtml(mod.name) + '</div>';
  html += '<h1>' + (pct >= 70 ? '表現不錯！' : '需要加強') + '</h1>';
  html += '<div class="result-kpis">';
  html += '<div class="kpi"><b>' + correct + '/' + total + '</b><span>正確題數</span></div>';
  html += '<div class="kpi"><b>' + avgSec + '<span style="font-size:14px;color:var(--text-mute)">s</span></b><span>每題平均</span></div>';
  html += '<div class="kpi"><b>' + pct + '<span style="font-size:14px;color:var(--text-mute)">%</span></b><span>通過機率</span></div>';
  html += '<div class="kpi"><b>' + weakFws.length + '</b><span>弱點數</span></div>';
  html += '</div></div></div>';

  // ── Per-framework breakdown ──
  html += '<div class="breakdown"><h3>各' + TQE.escHtml(TQE.term('framework')) + '熟練度變化</h3>';
  Object.entries(fwScores).forEach(function(entry){
    var fid = entry[0], fs = entry[1];
    var avg = fs.count > 0 ? fs.total / fs.count : 0;
    var isWeak = avg < 3;
    if(isWeak) weakFws.push(fid);
    var barPct = Math.round(avg / 4 * 100);
    var color = isWeak ? 'var(--clay)' : 'var(--forest-500)';
    html += '<div class="breakdown-row">' +
      '<div class="breakdown-name">' + TQE.escHtml(fid + ' ' + fs.name) + '</div>' +
      '<div class="breakdown-bar"><span style="width:' + barPct + '%;background:' + color + '"></span></div>' +
      '<div class="breakdown-pct">' + barPct + '%</div>' +
      '<div class="breakdown-delta">' + avg.toFixed(1) + '/4</div></div>';
  });
  html += '</div>';

  // Radar chart
  var radarLabels = [];
  var radarData = [];
  var radarSelfData = [];
  Object.keys(fwScores).forEach(function(fid){
    var fs = fwScores[fid];
    radarLabels.push(fs.name);
    radarData.push(fs.count > 0 ? Math.round(fs.total / fs.count * 25) : 0);
    radarSelfData.push((state.phase1.ratings[fid] || 0) * 20);
  });

  html += '<div style="max-width:400px;margin:var(--space-5) auto;"><canvas id="tqeRadarChart" width="400" height="400"></canvas></div>';

  state.weakFws = weakFws;

  // ── Recommendation cards ──
  html += '<div class="section-head" style="margin-bottom:var(--space-4);"><div>' +
    '<h2 style="font-size:20px;margin:0;">系統為你準備的下一步</h2></div></div>';
  html += '<div class="recommend-grid">';
  if(weakFws.length > 0){
    var weakNames = weakFws.map(function(fid){ return fwScores[fid].name; }).join('、');
    html += '<div class="recommend"><span class="recommend-tag">建議動作</span>' +
      '<h4>弱項練習：' + TQE.escHtml(weakNames) + '</h4>' +
      '<p>系統已鎖定你的弱點，透過 AI 動態出題加強。</p>' +
      '<div class="recommend-foot"><span>AI 出題</span>' +
      '<button class="btn btn-primary btn-sm" onclick="TQE_UI.goLayer2()">開始</button></div></div>';
  }
  html += '<div class="recommend"><span class="recommend-tag">模擬考</span>' +
    '<h4>計時模擬正式考試</h4>' +
    '<p>按考科範圍完整模擬，驗證你的實力。</p>' +
    '<div class="recommend-foot"><span>75 MIN</span>' +
    '<button class="btn btn-outline btn-sm" onclick="TQE_UI.showExamSelection()">開始模考</button></div></div>';
  html += '</div>';

  html += '<div style="display:flex;justify-content:center;margin-top:var(--space-7);">' +
    '<button class="btn btn-ghost" onclick="TQE_UI.showScreen(\'tqeScreenEntry\');TQE_UI.setEntryView(\'home\');">回首頁</button></div>';

  area.innerHTML = html;
  TQE.saveSession();
  renderRadarChart(radarLabels, radarData, radarSelfData);
}

function renderRadarChart(labels, testData, selfData){
  var canvas = document.getElementById('tqeRadarChart');
  if(!canvas) return;
  if(typeof Chart === 'undefined'){
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
    script.onload = function(){ _drawRadar(canvas, labels, testData, selfData); };
    document.head.appendChild(script);
  } else {
    _drawRadar(canvas, labels, testData, selfData);
  }
}

function _drawRadar(canvas, labels, testData, selfData){
  if(typeof Chart === 'undefined') return;
  new Chart(canvas, {
    type: 'radar',
    data: {
      labels: labels,
      datasets: [
        { label: '測驗表現', data: testData, borderColor: '#0F9D8A', backgroundColor: '#0F9D8A20', borderWidth: 2, pointBackgroundColor: '#0F9D8A' },
        { label: '自評信心', data: selfData, borderColor: '#F9AB00', backgroundColor: '#F9AB0020', borderWidth: 2, borderDash: [5, 5], pointBackgroundColor: '#F9AB00' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      scales: { r: { beginAtZero: true, max: 100, ticks: { stepSize: 25, font: { size: 11 }, backdropColor: 'transparent' }, pointLabels: { font: { size: 13, family: 'Noto Sans TC, sans-serif' } }, grid: { color: '#E8EAED' }, angleLines: { color: '#E8EAED' } } },
      plugins: { legend: { position: 'bottom', labels: { font: { size: 12, family: 'Noto Sans TC, sans-serif' }, padding: 16 } } }
    }
  });
}

// ─── AI Chat (Phase 3) ───
var _chatCooldown = false;

function sendChat(qid){
  if(_chatCooldown) return;
  var input = document.getElementById('chatInput-' + qid);
  if(!input) return;
  var msg = input.value.trim();
  if(!msg) return;

  input.value = '';
  input.blur();
  input.disabled = true;
  var btn = input.parentNode.querySelector('button');
  if(btn){ btn.disabled = true; btn.style.opacity = '.5'; btn.textContent = '送出中'; }

  var body = document.getElementById('chatBody-' + qid);
  body.innerHTML += '<div class="tqe-chat-msg from-user">' + TQE.escHtml(msg) + '</div>';
  body.scrollTop = body.scrollHeight;

  _chatCooldown = true;
  function unlock(){
    _chatCooldown = false;
    if(input){ input.disabled = false; }
    if(btn){ btn.disabled = false; btn.style.opacity = '1'; btn.textContent = '送出'; }
  }
  var unlockTimer = setTimeout(unlock, 3000);

  body.innerHTML += '<div class="tqe-chat-msg from-ai" id="aiLoading-' + qid + '" style="opacity:.5;">思考中...</div>';
  body.scrollTop = body.scrollHeight;

  var mod = TQE.getModule(state.moduleId);
  var q = mod.questions.find(function(x){ return x.id === qid; });
  var chosen = state.phase3.answers[qid];
  var diag = (q.diagnosis && q.diagnosis[chosen]) ? q.diagnosis[chosen] : {};
  var fw = mod.frameworks.find(function(f){ return f.id === q.framework; });

  var chatMsgs = Array.from(body.querySelectorAll('.tqe-chat-msg')).map(function(el){
    var role = el.classList.contains('from-user') ? '學生' : '助教';
    return role + '：' + el.textContent.trim();
  }).filter(function(t){ return t.indexOf('思考中') === -1; }).slice(-6).join('\n');

  var pack = TQE.getConfig().contentPack;
  var prompt = '你是' + (pack ? pack.name : '學習系統') + '的學習助教，用白話、比喻、生活化例子，稱呼學生為「同學」。\n\n' +
    '學生在學習「' + mod.name + '」模組。\n\n' +
    '【原始題目】\n' + q.stem + '\n\n' +
    '【選項】\n' + q.options.map(function(o){ return o.key + '. ' + o.text; }).join('\n') + '\n\n' +
    '學生選了：' + chosen + '（' + (q.options.find(function(o){ return o.key === chosen; }) || {}).text + '）\n' +
    '正確答案：' + q.correct + '（' + (q.options.find(function(o){ return o.key === q.correct; }) || {}).text + '）\n' +
    '學生的認知缺口：' + (diag.gap || '') + '\n' +
    (fw ? '相關概念：' + fw.name + ' — ' + fw.desc + '\n' : '') +
    '\n【對話紀錄】\n' + chatMsgs + '\n\n學生最新回覆：「' + msg + '」\n\n' +
    '用蘇格拉底式提問引導：肯定正確部分，用反例/比喻幫他看到漏掉的維度，用引導問題收尾。3-4 句話，繁體中文，不要 markdown。';

  TQE.callGemini(prompt).then(function(reply){
    var el = document.getElementById('aiLoading-' + qid);
    if(el) el.remove();
    var model = TQE.getLastAIModel();
    var badge = model ? '<span style="font-size:10px;color:var(--text-mute);font-family:var(--font-mono);margin-left:4px;">(' + TQE.escHtml(model) + ')</span>' : '';
    body.innerHTML += '<div class="tqe-chat-msg from-ai">' + TQE.escHtml(reply === '[RATE_LIMIT]' ? 'AI 額度暫時用完，請等 30 秒再試。' : (reply || '抱歉，AI 暫時無法回應。')) + badge + '</div>';
    body.scrollTop = body.scrollHeight;
    clearTimeout(unlockTimer);
    unlock();
  }).catch(function(){
    var el = document.getElementById('aiLoading-' + qid);
    if(el) el.remove();
    body.innerHTML += '<div class="tqe-chat-msg from-ai">抱歉，AI 暫時無法回應。</div>';
    body.scrollTop = body.scrollHeight;
    clearTimeout(unlockTimer);
    unlock();
  });
}

// ─── Layer 2 / Exam: delegate to learn-layer2.js ───
function goLayer2(){
  if(typeof global.TQE_Layer2 !== 'undefined' && global.TQE_Layer2.goLayer2){
    global.TQE_Layer2.goLayer2();
  } else {
    alert('Layer 2 模組未載入');
  }
}

function goExam(){
  if(typeof global.TQE_Layer2 !== 'undefined' && global.TQE_Layer2.goExam){
    global.TQE_Layer2.goExam();
  } else {
    alert('模擬考模組未載入');
  }
}

// ─── Stats Screen (成績總覽) — 按等級分區 ───
function renderStatsScreen(){
  var area = document.getElementById('tqeStatsArea');
  if(!area) return;

  var pack = TQE.getConfig().contentPack;
  if(!pack){ area.innerHTML = ''; return; }

  var modules = TQE.getAllModules();
  var levels = TQE.getLevels();
  var stats = _loadStats();
  var totalAnswered = stats.answered || 0;
  var accuracy = totalAnswered > 0 ? Math.round((stats.correct || 0) / totalAnswered * 100) : 0;
  var streak = stats.streak || 0;
  var examHistory = stats.examHistory || [];
  var subjects = TQE.getSubjects();

  var html = '';

  // ── Empty state ──
  if(totalAnswered === 0 && examHistory.length === 0){
    html += '<div style="text-align:center;padding:var(--space-8) var(--space-4);">';
    html += '<h2 style="color:var(--text-soft);">還沒開始學習</h2>';
    html += '<p style="color:var(--text-mute);margin-bottom:var(--space-5);">完成模組的鑑別測驗或模擬考後，這裡會顯示你的學習歷程與弱點分析。</p>';
    html += '<button class="btn btn-primary btn-lg" onclick="TQE_UI.showScreen(\'tqeScreenEntry\')">選一個模組開始 →</button>';
    html += '</div>';
    area.innerHTML = html;
    return;
  }

  // ── Header + KPIs ──
  html += '<div class="phase-header"><h2>學習成績總覽</h2></div>';

  html += '<div class="result-kpis" style="margin-bottom:var(--space-6);">';
  html += '<div class="kpi"><b>' + totalAnswered + '</b><span>總作答題數</span></div>';
  html += '<div class="kpi"><b>' + accuracy + '<span style="font-size:14px;color:var(--text-mute)">%</span></b><span>平均正確率</span></div>';
  html += '<div class="kpi"><b>' + streak + '</b><span>連續學習天</span></div>';
  var completedModules = 0;
  modules.forEach(function(m){ if(stats.moduleMastery && stats.moduleMastery[m.id] > 0) completedModules++; });
  html += '<div class="kpi"><b>' + completedModules + ' / ' + modules.length + '</b><span>已學模組</span></div>';
  html += '</div>';

  // ── Per-level sections: mastery + radar + exam history ──
  var _radarsToDraw = []; // collect for post-innerHTML drawing

  levels.forEach(function(lv){
    var lvMods = modules.filter(function(m){ return m.level === lv.id; });
    if(lvMods.length === 0) return;

    // Check if this level has any data
    var lvHasData = lvMods.some(function(m){ return stats.moduleMastery && stats.moduleMastery[m.id] > 0; });
    var lvExams = examHistory.filter(function(ex){
      // Match by subject: find subjects belonging to this level
      var lvSubjectNames = subjects.filter(function(s){ return s.level === lv.id; }).map(function(s){ return s.name; });
      return lvSubjectNames.indexOf(ex.subject) >= 0;
    });

    // Login gate for l2
    var lock = lv.requiresLogin && !TQE.isLoggedIn();

    html += '<div class="card card-pad" style="margin-bottom:var(--space-5);">';
    html += '<div style="display:flex;align-items:center;gap:var(--space-3);margin-bottom:var(--space-4);">';
    html += '<h3 style="margin:0;font-size:18px;">' + TQE.escHtml(lv.name) + '</h3>';
    if(lock) html += '<span class="tag">🔒 需登入</span>';
    html += '</div>';

    if(lock && !lvHasData){
      html += '<p style="color:var(--text-mute);font-size:14px;">登入後解鎖中級學習數據。</p>';
      html += '</div>';
      return;
    }

    // ── Mastery bars ──
    lvMods.forEach(function(m){
      var mastery = stats.moduleMastery ? (stats.moduleMastery[m.id] || 0) : 0;
      var barColor = mastery === 0 ? 'var(--ink-300)' : mastery >= 70 ? 'var(--forest-500)' : mastery >= 50 ? 'var(--amber)' : 'var(--clay)';
      var label = mastery === 0 ? '未開始' : mastery + '%';
      html += '<div class="breakdown-row">';
      html += '<div class="breakdown-name" style="min-width:160px;">' + TQE.escHtml(m.id + ' ' + m.name) + '</div>';
      html += '<div class="breakdown-bar"><span style="width:' + Math.max(mastery, 2) + '%;background:' + barColor + '"></span></div>';
      html += '<div class="breakdown-pct">' + label + '</div>';
      html += '</div>';
    });

    // ── Radar chart (per level) ──
    var rLabels = [], rData = [], hasRData = false;
    lvMods.forEach(function(m){
      var mastery = stats.moduleMastery ? (stats.moduleMastery[m.id] || 0) : 0;
      rLabels.push(m.name.length > 8 ? m.name.substring(0, 8) + '…' : m.name);
      rData.push(mastery);
      if(mastery > 0) hasRData = true;
    });

    if(hasRData && lvMods.length >= 3){
      var canvasId = 'tqeStatsRadar-' + lv.id;
      html += '<div style="max-width:350px;margin:var(--space-4) auto 0;"><canvas id="' + canvasId + '" width="350" height="350"></canvas></div>';
      _radarsToDraw.push({ canvasId: canvasId, labels: rLabels, data: rData });
    }

    // ── Exam history for this level ──
    if(lvExams.length > 0){
      html += '<div style="margin-top:var(--space-4);padding-top:var(--space-4);border-top:1px solid var(--border);">';
      html += '<div style="font-size:13px;font-weight:600;color:var(--text-soft);margin-bottom:var(--space-3);">模擬考歷史</div>';
      lvExams.slice().reverse().slice(0, 10).forEach(function(ex, i){
        var passed = ex.score >= 70;
        var date = ex.date || '';
        html += '<div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-2) 0;' + (i < lvExams.length - 1 ? 'border-bottom:1px solid var(--border);' : '') + '">';
        html += '<div class="readiness-ring" style="--pct:' + ex.score + ';width:40px;height:40px;flex-shrink:0;"><span style="font-size:13px;">' + ex.score + '</span></div>';
        html += '<div style="flex:1;">';
        html += '<strong style="font-size:14px;">' + TQE.escHtml(ex.subject || '模擬考') + '</strong>';
        html += '<br><span style="font-size:12px;color:var(--text-mute);">' + date + ' · ' + (ex.correct || 0) + '/' + (ex.total || 0) + ' 題 · ' + (ex.elapsed || 0) + ' 分鐘</span>';
        html += '</div>';
        html += '<span class="tag ' + (passed ? 'tag-accent' : '') + '" style="font-size:11px;">' + (passed ? '通過' : '未通過') + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }

    html += '</div>'; // end card
  });

  // ── Weak Topics (cross-level, action-oriented) ──
  var weakTopics = [];
  modules.forEach(function(m){
    var mastery = stats.moduleMastery ? (stats.moduleMastery[m.id] || 0) : 0;
    if(mastery > 0 && mastery < 60){
      var lv = levels.find(function(l){ return l.id === m.level; });
      weakTopics.push({ id: m.id, name: m.name, mastery: mastery, levelName: lv ? lv.name : '' });
    }
  });
  if(weakTopics.length > 0){
    weakTopics.sort(function(a, b){ return a.mastery - b.mastery; });
    html += '<div class="card card-pad" style="margin-bottom:var(--space-5);">';
    html += '<h3 style="margin:0 0 var(--space-3);">弱點模組（熟練度 &lt; 60%）</h3>';
    weakTopics.forEach(function(w, i){
      html += '<div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-2) 0;' + (i < weakTopics.length - 1 ? 'border-bottom:1px solid var(--border);' : '') + '">';
      html += '<div style="width:24px;height:24px;border-radius:50%;background:var(--clay);color:#fff;display:grid;place-items:center;font-size:12px;font-weight:700;flex-shrink:0;">' + (i + 1) + '</div>';
      html += '<div style="flex:1;"><strong>' + TQE.escHtml(w.name) + '</strong><br><span style="font-size:13px;color:var(--text-mute);">' + w.id + ' · ' + TQE.escHtml(w.levelName) + '</span></div>';
      html += '<div style="font-family:var(--font-mono);font-size:14px;font-weight:600;color:var(--clay);">' + w.mastery + '%</div>';
      html += '</div>';
    });
    html += '<button class="btn btn-primary" style="width:100%;margin-top:var(--space-4);" onclick="TQE_UI.goLayer2()">開始弱項練習 →</button>';
    html += '</div>';
  }

  // ── Score Trend Chart (all exams) ──
  if(examHistory.length >= 2){
    html += '<div class="card card-pad" style="margin-bottom:var(--space-5);">';
    html += '<h3 style="margin:0 0 var(--space-3);">分數趨勢</h3>';
    html += '<div style="max-width:600px;margin:0 auto;"><canvas id="tqeScoreTrend" width="600" height="300"></canvas></div>';
    html += '</div>';
  }

  // ── Actions ──
  html += '<div style="display:flex;gap:var(--space-3);justify-content:center;flex-wrap:wrap;margin-top:var(--space-5);">';
  html += '<button class="btn btn-primary" onclick="TQE_UI.showScreen(\'tqeScreenEntry\')">回首頁</button>';
  html += '<button class="btn btn-outline" onclick="TQE_UI.showExamSelection()">開始模擬考</button>';
  html += '</div>';

  area.innerHTML = html;

  // Draw per-level radar charts
  _radarsToDraw.forEach(function(r){
    _drawStatsRadarById(r.canvasId, r.labels, r.data);
  });

  // Draw score trend line chart
  if(examHistory.length >= 2){
    _drawScoreTrend(examHistory);
  }
}

function _drawStatsRadarById(canvasId, labels, data){
  var canvas = document.getElementById(canvasId);
  if(!canvas) return;
  if(typeof Chart === 'undefined'){
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
    script.onload = function(){ _doDrawStatsRadar(canvas, labels, data); };
    document.head.appendChild(script);
  } else {
    _doDrawStatsRadar(canvas, labels, data);
  }
}

function _doDrawStatsRadar(canvas, labels, data){
  if(typeof Chart === 'undefined') return;
  var style = getComputedStyle(document.documentElement);
  var green = style.getPropertyValue('--forest-600')?.trim() || '#0F9D8A';

  new Chart(canvas, {
    type: 'radar',
    data: {
      labels: labels,
      datasets: [{
        label: '熟練度',
        data: data,
        borderColor: green,
        backgroundColor: green + '20',
        borderWidth: 2,
        pointBackgroundColor: green
      }]
    },
    options: {
      responsive: true,
      scales: {
        r: {
          beginAtZero: true,
          max: 100,
          ticks: { stepSize: 25, font: { size: 11 } },
          pointLabels: { font: { size: 12, family: 'Noto Sans TC' } }
        }
      },
      plugins: { legend: { display: false } }
    }
  });
}

// ─── Score Trend Chart ───
function _drawScoreTrend(examHistory){
  var canvas = document.getElementById('tqeScoreTrend');
  if(!canvas) return;
  if(typeof Chart === 'undefined'){
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js';
    script.onload = function(){ _doDrawScoreTrend(canvas, examHistory); };
    document.head.appendChild(script);
  } else {
    _doDrawScoreTrend(canvas, examHistory);
  }
}

function _doDrawScoreTrend(canvas, examHistory){
  if(typeof Chart === 'undefined') return;
  var labels = examHistory.map(function(ex){ return ex.date || ''; });
  var scores = examHistory.map(function(ex){ return ex.score; });
  var passLine = examHistory.map(function(){ return 70; });

  var style = getComputedStyle(document.documentElement);
  var green = style.getPropertyValue('--forest-600')?.trim() || '#0F9D8A';

  new Chart(canvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: '模擬考分數',
          data: scores,
          borderColor: green,
          backgroundColor: green + '20',
          borderWidth: 2,
          pointBackgroundColor: green,
          pointRadius: 4,
          fill: true,
          tension: 0.3
        },
        {
          label: '及格線 (70)',
          data: passLine,
          borderColor: '#E57373',
          borderWidth: 1.5,
          borderDash: [6, 4],
          pointRadius: 0,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: { stepSize: 10, font: { size: 11 } },
          grid: { color: '#E8EAED' }
        },
        x: {
          ticks: { font: { size: 11 } },
          grid: { display: false }
        }
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { size: 12, family: 'Noto Sans TC' }, padding: 16 }
        }
      }
    }
  });
}

// ─── Question Report UI ───
var REPORT_REASONS = ['答案有誤', '題幹不清楚', '選項重複或矛盾', '超出考試範圍', '其他'];

function _reportLink(moduleId, qid){
  return '<div style="text-align:right;margin-top:var(--space-2);">' +
    '<button class="btn btn-ghost" style="font-size:12px;color:var(--text-mute);padding:2px 6px;" ' +
    'onclick="TQE_UI.showReportMenu(\'' + moduleId + '\',\'' + qid + '\',this)">🚩 題目有誤</button>' +
    '<div id="reportMenu-' + qid + '" style="display:none;margin-top:var(--space-2);text-align:left;padding:var(--space-3);background:var(--bg-soft);border-radius:var(--radius);border:1px solid var(--border);">' +
    '<div style="font-size:13px;font-weight:600;margin-bottom:var(--space-2);">選擇回報原因：</div>' +
    REPORT_REASONS.map(function(r){
      return '<button class="btn btn-outline btn-sm" style="margin:2px;font-size:12px;" ' +
        'onclick="TQE_UI.submitReport(\'' + moduleId + '\',\'' + qid + '\',\'' + r + '\',this)">' + r + '</button>';
    }).join('') +
    '</div></div>';
}

function showReportMenu(moduleId, qid, btn){
  var menu = document.getElementById('reportMenu-' + qid);
  if(!menu) return;
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

function submitReport(moduleId, qid, reason, btn){
  TQE.reportQuestion(moduleId, qid, reason);
  var menu = document.getElementById('reportMenu-' + qid);
  if(menu) menu.innerHTML = '<div style="font-size:13px;color:var(--forest-700);">✅ 已回報，感謝！</div>';
}

// ─── Public API ───
global.TQE_UI = {
  showScreen: showScreen,
  updateTopNav: updateTopNav,
  renderEntry: renderEntry,
  setEntryView: setEntryView,
  selectModule: selectModule,
  startSubjectExam: startSubjectExam,
  showExamSelection: showExamSelection,
  startLearning: startLearning,
  renderLearnScreen: renderLearnScreen,
  _switchLearnTab: _switchLearnTab,
  _learnChooseSide: _learnChooseSide,
  _startPhase3FromLearn: _startPhase3FromLearn,
  rateFramework: rateFramework,
  goPhase2: goPhase2,
  chooseDebateSide: chooseDebateSide,
  goPhase3: goPhase3,
  answerQ: answerQ,
  nextQ: nextQ,
  goReport: goReport,
  sendChat: sendChat,
  showReportMenu: showReportMenu,
  submitReport: submitReport,
  _reportLink: _reportLink,
  goLayer2: goLayer2,
  goExam: goExam,
  renderStatsScreen: renderStatsScreen
};

})(typeof window !== 'undefined' ? window : global);
