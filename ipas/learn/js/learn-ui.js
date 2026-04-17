// ═══════════════════════════════════════════════════════
//  Three-Question Engine — UI Renderer v1.0
//  Renders Phase 0-5 + Exam using content pack data
//  Depends on: learn-engine.js (ThreeQuestionEngine)
// ═══════════════════════════════════════════════════════

(function(global){
'use strict';

const TQE = global.ThreeQuestionEngine;
if(!TQE) throw new Error('learn-engine.js must be loaded before learn-ui.js');

const state = TQE.state;

// ─── Screen management ───
function showScreen(id){
  document.querySelectorAll('.tqe-screen').forEach(function(s){ s.classList.remove('active'); });
  var el = document.getElementById(id);
  if(el) el.classList.add('active');
  var topBar = document.getElementById('tqeTopBar');
  if(topBar) topBar.style.display = id === 'tqeScreenEntry' ? 'none' : 'block';
  window.scrollTo(0, 0);

  var phases = {
    tqeScreenPhase1:['Phase 1','15'], tqeScreenPhase2:['Phase 2','30'],
    tqeScreenPhase3:['Phase 3','45'], tqeScreenPhase4:['報告','55'],
    tqeScreenPhase5:['加強','65'], tqeScreenLayer2:['練習','85'],
    tqeScreenExam:['模擬考','95'], tqeScreenExamResult:['完成','100']
  };
  if(phases[id]){
    var topPhase = document.getElementById('tqeTopPhase');
    var progressFill = document.getElementById('tqeProgressFill');
    var topTitle = document.getElementById('tqeTopTitle');
    if(topPhase) topPhase.textContent = phases[id][0];
    if(progressFill) progressFill.style.width = phases[id][1] + '%';
    var mod = TQE.getModule(state.moduleId);
    if(topTitle) topTitle.textContent = mod ? mod.name : '';
  }

  if(TQE.getConfig().onPhaseChange) TQE.getConfig().onPhaseChange(id, state);
}

// ─── Entry screen (multi-step navigation) ───
var _entryView = 'home';

function renderEntry(){
  var pack = TQE.getConfig().contentPack;
  if(!pack) return;

  // Toggle teacher link visibility
  var teacherLink = document.getElementById('tqeTeacherLink');
  if(teacherLink) teacherLink.style.display = TQE.isTeacher() ? 'inline-block' : 'none';

  var moduleListEl = document.getElementById('tqeModuleList');
  if(!moduleListEl) return;

  var levels = TQE.getLevels();
  var modules = TQE.getAllModules();
  var subjects = TQE.getSubjects();

  // Group modules by level
  var grouped = {};
  levels.forEach(function(lv){ grouped[lv.id] = []; });
  modules.forEach(function(m){
    var lvId = m.level || 'default';
    if(!grouped[lvId]) grouped[lvId] = [];
    grouped[lvId].push(m);
  });

  var html = '';

  // ── Home: level selection ──
  if(_entryView === 'home'){
    html += '<h3 style="margin-bottom:1rem;">選擇等級</h3>';
    levels.forEach(function(lv){
      var mods = grouped[lv.id] || [];
      var badge = lv.requiresLogin ? '需 Google 登入' : '免登入';
      var bgColor = lv.requiresLogin ? 'var(--purple-lt,#F3E8FD)' : 'var(--blue-lt)';
      var borderColor = lv.requiresLogin ? 'var(--purple,#7C3AED)' : 'var(--blue)';
      var lock = lv.requiresLogin && !TQE.isLoggedIn() ? ' 🔒' : '';
      html += '<div class="card" style="cursor:pointer;border-left:4px solid ' + borderColor + ';margin-bottom:1rem;" onclick="TQE_UI.selectLevel(\'' + lv.id + '\')">' +
        '<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.3rem;">' +
        '<h3 style="margin:0;">' + TQE.escHtml(lv.name) + lock + '</h3>' +
        '<span style="padding:.2rem .6rem;border-radius:8px;font-size:.75rem;font-weight:700;background:' + bgColor + ';color:' + borderColor + ';">' + badge + '</span>' +
        '</div>' +
        '<p style="font-size:.9rem;color:var(--g600);margin:0;">' + TQE.escHtml(lv.description || '') + '</p>' +
        '<p style="font-size:.85rem;color:var(--g400);margin:.3rem 0 0;">' + mods.length + ' 個模組</p>' +
        '</div>';
    });
    moduleListEl.innerHTML = html;
    return;
  }

  // ── Level sub-menu: practice or exam ──
  if(_entryView === 'level-l1' || _entryView === 'level-l2'){
    var lvId = _entryView.replace('level-', '');
    var lv = levels.find(function(l){ return l.id === lvId; });
    var lvName = lv ? lv.name : lvId;

    // Login gate for l2
    if(lvId === 'l2' && !TQE.isLoggedIn()){
      html += _backLink('home');
      html += '<div class="info red" style="text-align:center;margin-top:1rem;">' +
        '<strong>中級需要 Google 登入</strong><br>請先點擊上方 Google 登入按鈕。</div>';
      moduleListEl.innerHTML = html;
      return;
    }

    html += _backLink('home');
    html += '<h3 style="margin-bottom:1rem;">' + TQE.escHtml(lvName) + ' — 選擇模式</h3>';
    html += '<div class="card" style="cursor:pointer;border-left:4px solid var(--blue);margin-bottom:1rem;" onclick="TQE_UI.setEntryView(\'practice-' + lvId + '\')">' +
      '<h3 style="margin:0;">📖 練習（選模組）</h3>' +
      '<p style="font-size:.9rem;color:var(--g600);margin:.3rem 0 0;">依模組逐步學習：框架建立 → 邊界校正 → 鑑別測驗 → 弱項練習</p></div>';
    html += '<div class="card" style="cursor:pointer;border-left:4px solid var(--gold,#F9AB00);margin-bottom:1rem;" onclick="TQE_UI.setEntryView(\'exam-' + lvId + '\')">' +
      '<h3 style="margin:0;">📝 模擬考（選考科）</h3>' +
      '<p style="font-size:.9rem;color:var(--g600);margin:.3rem 0 0;">按考科範圍模擬正式考試，計時作答</p></div>';
    moduleListEl.innerHTML = html;
    return;
  }

  // ── Practice: show modules for the level ──
  if(_entryView === 'practice-l1' || _entryView === 'practice-l2'){
    var lvId = _entryView.replace('practice-', '');
    var lv = levels.find(function(l){ return l.id === lvId; });
    var mods = grouped[lvId] || [];

    html += _backLink('level-' + lvId);
    html += '<h3 style="margin-bottom:1rem;">' + TQE.escHtml(lv ? lv.name : '') + ' — 選擇學習模組</h3>';
    mods.forEach(function(m){
      var examLabel = m.examSubject ? '<p style="font-size:.8rem;color:var(--g400);margin-top:.2rem;">對應考科：' + TQE.escHtml(m.examSubject.name) + '</p>' : '';
      html += '<div class="card" style="cursor:pointer;" onclick="TQE_UI.selectModule(\'' + m.id + '\')">' +
        '<h3>' + TQE.escHtml(m.id + ' — ' + m.name) + '</h3>' +
        '<p>' + (m.frameworks.length) + ' 個框架 | ' + (m.questions.length) + ' 題</p>' +
        examLabel + '</div>';
    });
    moduleListEl.innerHTML = html;
    return;
  }

  // ── Exam: show subjects for the level ──
  if(_entryView === 'exam-l1' || _entryView === 'exam-l2'){
    var lvId = _entryView.replace('exam-', '');
    var lv = levels.find(function(l){ return l.id === lvId; });
    var lvSubjects = subjects.filter(function(s){ return s.level === lvId; });

    // Login gate for l1 exam
    if(lvId === 'l1' && !TQE.isLoggedIn()){
      html += _backLink('level-' + lvId);
      html += '<div class="info red" style="text-align:center;margin-top:1rem;">' +
        '<strong>模擬考需要 Google 登入</strong><br>請先點擊上方 Google 登入按鈕。</div>';
      moduleListEl.innerHTML = html;
      return;
    }

    html += _backLink('level-' + lvId);
    html += '<h3 style="margin-bottom:1rem;">' + TQE.escHtml(lv ? lv.name : '') + ' — 選擇考科</h3>';
    lvSubjects.forEach(function(subj){
      html += '<div class="card" style="cursor:pointer;border-left:4px solid var(--gold,#F9AB00);" onclick="TQE_UI.startSubjectExam(\'' + subj.id + '\')">' +
        '<h3>' + TQE.escHtml(subj.name) + '</h3>' +
        '<p style="font-size:.9rem;color:var(--g600);">' + subj.total + ' 題 | ' + subj.duration + ' 分鐘</p>' +
        '<p style="font-size:.8rem;color:var(--g400);margin-top:.2rem;">涵蓋模組：' + TQE.escHtml(subj.modules.join('、')) + '</p>' +
        '</div>';
    });
    if(lvSubjects.length === 0){
      html += '<div class="info gold" style="text-align:center;">此等級尚無考科設定</div>';
    }
    moduleListEl.innerHTML = html;
    return;
  }

  moduleListEl.innerHTML = '';
}

function _backLink(target){
  return '<a href="#" onclick="event.preventDefault();TQE_UI.setEntryView(\'' + target + '\')" style="display:inline-block;margin-bottom:.8rem;font-size:.9rem;color:var(--blue);text-decoration:none;font-weight:700;">← 返回</a>';
}

function setEntryView(view){
  _entryView = view;
  // Reset start button when navigating
  var btn = document.getElementById('tqeBtnStart');
  if(btn){ btn.disabled = true; btn.textContent = '選擇模組開始學習'; }
  renderEntry();
}

function selectLevel(lvId){
  var levels = TQE.getLevels();
  var lv = levels.find(function(l){ return l.id === lvId; });
  if(lv && lv.requiresLogin && !TQE.isLoggedIn()){
    var authStatus = document.getElementById('tqeAuthStatus');
    if(authStatus) authStatus.innerHTML = '<span style="color:var(--gold);font-weight:700;">此等級需要 Google 登入</span>';
    _entryView = 'level-' + lvId;
    renderEntry();
    return;
  }
  _entryView = 'level-' + lvId;
  renderEntry();
}

function startSubjectExam(subjectId){
  var subjects = TQE.getSubjects();
  var subj = subjects.find(function(s){ return s.id === subjectId; });
  if(!subj) return;

  // Store subject info in state for goExam to use
  state.examSubjectId = subjectId;

  // Set moduleId to first module in subject (for compatibility)
  if(subj.modules.length > 0){
    state.moduleId = subj.modules[0];
  }

  if(typeof global.TQE_Layer2 !== 'undefined' && global.TQE_Layer2.goExam){
    global.TQE_Layer2.goExam();
  } else {
    alert('模擬考模組未載入');
  }
}

function showExamSelection(){
  // Determine the current module's level
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
    if(authStatus) authStatus.innerHTML = '<span style="color:var(--gold);font-weight:700;">此模組需要 Google 登入</span>';
    return;
  }

  state.moduleId = id;
  document.querySelectorAll('#tqeModuleList .card').forEach(function(c){ c.style.borderColor = ''; });
  if(event && event.currentTarget) event.currentTarget.style.borderColor = 'var(--blue)';
  var btn = document.getElementById('tqeBtnStart');
  if(btn){
    btn.textContent = '開始學習：' + module.name + ' →';
    btn.disabled = false;
  }
}

function startLearning(){
  var nameInput = document.getElementById('tqeInputName');
  state.name = nameInput ? (nameInput.value.trim() || '學員') : '學員';
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
    '<div class="phase-tag" style="background:var(--blue);">Phase 1</div>' +
    '<h2>框架建立</h2>' +
    '<p>評估你對每個核心概念的熟悉程度</p></div>';

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

  html += '<button class="btn btn-primary btn-block" id="tqeBtnP1Next" onclick="TQE_UI.goPhase2()" disabled>所有框架都評分後才能繼續 →</button>';
  area.innerHTML = html;
}

function rateFramework(fwId, val){
  state.phase1.ratings[fwId] = val;
  // Update stars UI
  document.querySelectorAll('.star[data-fw="' + fwId + '"]').forEach(function(s){
    s.classList.toggle('lit', parseInt(s.dataset.val) <= val);
  });
  // Check if all rated
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
    '<div class="phase-tag" style="background:var(--gold);">Phase 2</div>' +
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

  html += '<button class="btn btn-primary btn-block" id="tqeBtnP2Next" onclick="TQE_UI.goPhase3()" disabled>全部選完後才能繼續 →</button>';
  area.innerHTML = html;
}

function chooseDebateSide(debateId, side){
  state.phase2.choices[debateId] = side;
  var btns = document.querySelectorAll('#debate-' + debateId + ' .side-btn');
  btns.forEach(function(b){ b.className = 'side-btn'; });
  btns[side === 'A' ? 0 : 1].classList.add('chosen-' + side.toLowerCase());
  var reveal = document.getElementById('reveal-' + debateId);
  if(reveal) reveal.classList.add('show');

  // Check all debates answered
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
    '<div class="phase-tag" style="background:var(--red);">Phase 3</div>' +
    '<h2>鑑別測驗</h2>' +
    '<p>找出你真正的知識缺口</p></div>';

  mod.questions.forEach(function(q, idx){
    var fw = mod.frameworks.find(function(f){ return f.id === q.framework; });
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

  // Lock options
  document.querySelectorAll('#opts-' + qid + ' .option-btn').forEach(function(b){ b.classList.add('locked'); });
  document.getElementById('opt-' + qid + '-' + q.correct).classList.add('correct');
  if(!isCorrect) document.getElementById('opt-' + qid + '-' + chosen).classList.add('wrong');

  // Record
  state.phase3.answers[qid] = chosen;
  var chosenOpt = q.options.find(function(o){ return o.key === chosen; });
  state.phase3.scores[qid] = chosenOpt ? (chosenOpt.depth || 1) : 1;

  // Save blind spot
  TQE.saveBlindSpot(q, chosen, isCorrect);

  var fb = document.getElementById('feedback-' + qid);
  if(isCorrect){
    var fw = mod.frameworks.find(function(f){ return f.id === q.framework; });
    fb.innerHTML = '<div class="info green"><strong>正確！</strong> 對應' + TQE.term('framework') + '「' + (fw ? fw.name : '') + '」。</div>' +
      '<button class="btn btn-primary btn-block" onclick="TQE_UI.nextQ()" style="margin-top:.8rem;">下一題 →</button>';
  } else {
    var diag = q.diagnosis ? q.diagnosis[chosen] : null;
    var hasDiag = diag && diag.gap && diag.gap !== '';
    var lectureLinks = TQE.getLectureLinks(state.moduleId, q.framework);
    var fw = mod.frameworks.find(function(f){ return f.id === q.framework; });
    var correctText = q.options.find(function(o){ return o.key === q.correct; })?.text || '';
    var chosenText = q.options.find(function(o){ return o.key === chosen; })?.text || '';

    // First-round followup: ALWAYS use pre-generated text (no API call)
    var initialFollowup;
    if(hasDiag && diag.followup){
      initialFollowup = diag.followup;
    } else {
      // Smart fallback using question content (still no API)
      initialFollowup = '你選的「' + chosenText.substring(0, 30) + '」，但正確答案是「' + correctText.substring(0, 30) + '」。' +
        '這兩者的關鍵差異在哪？打字告訴我你的想法，AI 會根據你的回應分析。';
    }

    var headerInfo = hasDiag
      ? '<div class="info red"><strong>你的思路：</strong>' + TQE.escHtml(diag.gap) + '</div>'
      : '<div class="info red"><strong>答案是 ' + q.correct + '</strong>。' + TQE.escHtml(q.explanation || '') + '</div>';

    fb.innerHTML = headerInfo +
      (lectureLinks ? '<div class="info blue" style="margin-top:.5rem;"><strong>📖 去這裡補強：</strong>' + lectureLinks + '</div>' : '') +
      '<div class="tqe-chat" id="chat-' + qid + '">' +
      '<div class="tqe-chat-header">AI 追問引擎</div>' +
      '<div class="tqe-chat-body" id="chatBody-' + qid + '">' +
      '<div class="tqe-chat-msg from-ai">' + TQE.escHtml(initialFollowup) + '</div>' +
      '</div>' +
      '<div class="tqe-chat-input">' +
      '<input type="text" id="chatInput-' + qid + '" placeholder="輸入你的想法..." onkeydown="if(event.key===\'Enter\'){event.preventDefault();TQE_UI.sendChat(\'' + qid + '\');}">' +
      '<button onclick="TQE_UI.sendChat(\'' + qid + '\')">送出</button>' +
      '</div></div>' +
      '<button class="btn btn-secondary btn-block" onclick="TQE_UI.nextQ()" style="margin-top:.8rem;">繼續下一題 →</button>';
  }
}

function nextQ(){
  var mod = TQE.getModule(state.moduleId);
  state.currentQ++;
  if(state.currentQ >= mod.questions.length){
    goReport();
    return;
  }
  // Hide current, show next
  var wraps = document.querySelectorAll('#tqePhase3Area [id^="qWrap-"]');
  wraps.forEach(function(w, i){ w.style.display = i === state.currentQ ? '' : 'none'; });
  window.scrollTo(0, document.getElementById('tqePhase3Area').offsetTop);
}

// ─── Phase 4: Report ───
function goReport(){
  TQE.saveProgress('phase3_complete');
  TQE.saveSession();
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
  var html = '<div class="phase-header fade-in"><div class="phase-tag" style="background:var(--green);">報告</div><h2>弱點分析</h2></div>';

  // Overall stats
  var correct = mod.questions.filter(function(q){ return state.phase3.answers[q.id] === q.correct; }).length;
  var total = Object.keys(state.phase3.answers).length;
  var pct = total > 0 ? Math.round(correct / total * 100) : 0;
  html += '<div style="text-align:center;margin:1rem 0;">' +
    '<div style="font-size:3rem;font-weight:900;color:' + (pct >= 70 ? 'var(--green)' : pct >= 40 ? 'var(--gold)' : 'var(--red)') + ';">' + pct + '%</div>' +
    '<div>答對 ' + correct + '/' + total + ' 題</div></div>';

  // Per-framework breakdown
  html += '<div style="margin:1.5rem 0;">';
  Object.entries(fwScores).forEach(function(entry){
    var fid = entry[0], fs = entry[1];
    var avg = fs.count > 0 ? fs.total / fs.count : 0;
    var isWeak = avg < 3;
    if(isWeak) weakFws.push(fid);
    var barPct = Math.round(avg / 4 * 100);
    var color = isWeak ? 'var(--red)' : 'var(--green)';
    html += '<div style="margin-bottom:.8rem;">' +
      '<div style="display:flex;justify-content:space-between;font-size:.9rem;">' +
      '<span>' + TQE.escHtml(fid + ' ' + fs.name) + '</span>' +
      '<span style="font-weight:700;color:' + color + ';">' + avg.toFixed(1) + '/4</span></div>' +
      '<div style="background:var(--g100);border-radius:4px;height:6px;margin-top:.2rem;">' +
      '<div style="height:100%;border-radius:4px;width:' + barPct + '%;background:' + color + ';"></div></div></div>';
  });
  html += '</div>';

  // Radar chart
  var radarLabels = [];
  var radarData = [];
  var radarSelfData = [];
  Object.keys(fwScores).forEach(function(fid){
    var fs = fwScores[fid];
    radarLabels.push(fs.name);
    radarData.push(fs.count > 0 ? Math.round(fs.total / fs.count * 25) : 0); // normalize to 0-100
    radarSelfData.push((state.phase1.ratings[fid] || 0) * 20); // 1-5 → 0-100
  });

  html += '<div style="max-width:400px;margin:1.5rem auto;"><canvas id="tqeRadarChart" width="400" height="400"></canvas></div>';

  state.weakFws = weakFws;

  // Actions
  html += '<div style="text-align:center;margin-top:2rem;">';
  if(weakFws.length > 0){
    html += '<p style="color:var(--red);margin-bottom:1rem;">需加強：' + weakFws.map(function(fid){ return fwScores[fid].name; }).join('、') + '</p>';
    html += '<button class="btn btn-primary" onclick="TQE_UI.goLayer2()">弱項練習 →</button> ';
  }
  html += '<button class="btn btn-gold" onclick="TQE_UI.showExamSelection()">模擬考（選考科） →</button>';
  html += '</div>';

  area.innerHTML = html;
  TQE.saveSession();

  // Render radar chart (Chart.js)
  renderRadarChart(radarLabels, radarData, radarSelfData);
}

function renderRadarChart(labels, testData, selfData){
  var canvas = document.getElementById('tqeRadarChart');
  if(!canvas) return;

  // Load Chart.js if not already loaded
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
  var style = getComputedStyle(document.documentElement);
  var blue = style.getPropertyValue('--blue').trim() || '#1A73E8';
  var gold = style.getPropertyValue('--gold').trim() || '#F9AB00';

  new Chart(canvas, {
    type: 'radar',
    data: {
      labels: labels,
      datasets: [
        {
          label: '測驗表現',
          data: testData,
          borderColor: blue,
          backgroundColor: blue + '20',
          borderWidth: 2,
          pointBackgroundColor: blue
        },
        {
          label: '自評信心',
          data: selfData,
          borderColor: gold,
          backgroundColor: gold + '20',
          borderWidth: 2,
          borderDash: [5, 5],
          pointBackgroundColor: gold
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      scales: {
        r: {
          beginAtZero: true,
          max: 100,
          ticks: { stepSize: 25, font: { size: 11 }, backdropColor: 'transparent' },
          pointLabels: { font: { size: 13, family: 'Noto Sans TC, sans-serif' } },
          grid: { color: '#E8EAED' },
          angleLines: { color: '#E8EAED' }
        }
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { size: 12, family: 'Noto Sans TC, sans-serif' }, padding: 16 }
        }
      }
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

  // Lock UI: clear input + visually disable button + input
  input.value = '';
  input.blur();
  input.disabled = true;
  var btn = input.parentNode.querySelector('button');
  if(btn){ btn.disabled = true; btn.style.opacity = '.5'; btn.textContent = '送出中'; }

  var body = document.getElementById('chatBody-' + qid);
  body.innerHTML += '<div class="tqe-chat-msg from-user">' + TQE.escHtml(msg) + '</div>';
  body.scrollTop = body.scrollHeight;

  _chatCooldown = true;
  // Unlock after 3s + reply received
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
  var prompt = '你是' + (pack ? pack.name : '學習系統') + '的學習助教，風格像一個很會教的學長姐 — 用白話、比喻、生活化例子。\n\n' +
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
    body.innerHTML += '<div class="tqe-chat-msg from-ai">' + TQE.escHtml(reply === '[RATE_LIMIT]' ? 'AI 額度暫時用完，請等 30 秒再試。' : (reply || '抱歉，AI 暫時無法回應。')) + '</div>';
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

// ─── Phase 5 / Layer 2 / Exam: delegate to learn-layer2.js ───
// These are provided by the layer2 module

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

// ─── Public API ───
global.TQE_UI = {
  showScreen: showScreen,
  renderEntry: renderEntry,
  setEntryView: setEntryView,
  selectLevel: selectLevel,
  selectModule: selectModule,
  startSubjectExam: startSubjectExam,
  showExamSelection: showExamSelection,
  startLearning: startLearning,
  rateFramework: rateFramework,
  goPhase2: goPhase2,
  chooseDebateSide: chooseDebateSide,
  goPhase3: goPhase3,
  answerQ: answerQ,
  nextQ: nextQ,
  goReport: goReport,
  sendChat: sendChat,
  goLayer2: goLayer2,
  goExam: goExam
};

})(typeof window !== 'undefined' ? window : global);
