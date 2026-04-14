// iPAS 三問法學習系統 — UI 控制（5 Phase 完整流程）
// Phase 0: 模組列表 → Phase 1: 框架卡片+自評 → Phase 2: 爭議選邊
// → Phase 3: 鑑別題+AI追問 → Phase 4: 報告(雷達圖) → Phase 5: 弱項加強

(function(global) {
  'use strict';

  let currentLevel = (typeof window !== 'undefined' && window.LEARN_LEVEL) || 'l2';
  let currentModule = null;
  let currentQuestions = [];

  let state = {
    moduleId: null,
    phase: 0,
    phase1: { ratings: {} },
    phase2: { choice: null },
    phase3: { answers: {}, currentQ: 0 },
    weakConcepts: [],
    startTime: 0
  };

  // ========== 等級資訊 ==========
  function renderLevelInfo() {
    var data = LEARN_DATA[currentLevel];
    var info = document.getElementById('level-info');
    if (!info || !data) return;
    info.innerHTML =
      '<h2>' + data.nameFull + '</h2>' +
      '<p class="exam-format">\u{1F4DD} ' + data.examFormat + '</p>' +
      '<p class="focus">\u{1F3AF} ' + data.focus + '</p>' +
      (data.examStyle ? '<p class="exam-style">' + data.examStyle + '</p>' : '');
  }

  // ========== 模組卡片渲染 ==========
  function renderModules() {
    var data = LEARN_DATA[currentLevel];
    var container = document.getElementById('modules-grid');
    if (!container || !data) return;
    var progress = LearnEngine.getProgress();

    container.innerHTML = data.modules.map(function(mod) {
      var key = currentLevel + '.' + mod.id;
      var prog = progress[key] || { correct: 0, total: 0 };
      var qTotal = (mod.questions ? mod.questions.length : 0) + (mod.reinforcement ? mod.reinforcement.length : 0);
      var pct = qTotal > 0 ? Math.round((prog.total / qTotal) * 100) : 0;
      return '<div class="module-card" data-module="' + mod.id + '" onclick="LearnUI.openModule(\'' + mod.id + '\')">' +
        '<div class="module-id">' + mod.id + '</div>' +
        '<h3>' + mod.name + '</h3>' +
        '<p class="module-subject">' + mod.subject + '</p>' +
        '<p class="module-scope">' + mod.scope + '</p>' +
        '<div class="module-progress">' +
          '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
          '<span class="progress-text">' + prog.total + '/' + qTotal + ' \u984C \u00B7 \u6B63\u78BA ' + prog.correct + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // ========== Phase 0 → openModule ==========
  function openModule(moduleId) {
    var data = LEARN_DATA[currentLevel];
    var mod = data.modules.find(function(m) { return m.id === moduleId; });
    if (!mod) return;
    currentModule = mod;

    state = {
      moduleId: moduleId,
      phase: 1,
      phase1: { ratings: {} },
      phase2: { choice: null },
      phase3: { answers: {}, currentQ: 0 },
      weakConcepts: [],
      startTime: Date.now()
    };

    document.getElementById('modules-view').style.display = 'none';
    document.getElementById('module-view').style.display = 'block';

    // L2 有 concepts + frameworkQ → 完整三問法
    // L1 沒有 → 直接跳 Phase 3
    if (mod.concepts && mod.frameworkQ) {
      renderPhase1();
    } else {
      state.phase = 3;
      currentQuestions = (mod.questions || []).slice();
      renderPhase3();
    }
  }

  // ========== Phase 1: 框架卡片 + 自評星等 ==========
  function renderPhase1() {
    state.phase = 1;
    var mod = currentModule;

    var cardsHtml = mod.concepts.map(function(c, i) {
      var starsHtml = [1,2,3,4,5].map(function(s) {
        return '<span class="star" data-fw="' + c.id + '" data-val="' + s + '" onclick="LearnUI._rateFw(\'' + c.id + '\',' + s + ')">\u2605</span>';
      }).join('');
      return '<div class="fw-card" id="fw-' + c.id + '">' +
        '<span class="fw-num">' + (i + 1) + '</span>' +
        '<span class="fw-title">' + c.name + '</span>' +
        '<div class="fw-desc">\u6DB5\u84CB\uFF1A' + c.tags.slice(0, 5).join('\u3001') + '</div>' +
        '<div class="self-rate">' +
          '<span class="rate-label">\u719F\u6089\u5EA6\uFF1A</span>' +
          starsHtml +
        '</div>' +
      '</div>';
    }).join('');

    document.getElementById('module-view').innerHTML =
      '<div class="phase-bar">' +
        '<span class="phase-tag" style="background:var(--blue)">Phase 1</span>' +
        '<span class="phase-label">\u6846\u67B6\u8A8D\u8B58</span>' +
        '<div class="phase-progress"><div class="phase-fill" style="width:20%"></div></div>' +
      '</div>' +
      '<button class="back-btn" onclick="LearnUI.backToModules()">\u2190 \u8FD4\u56DE\u6A21\u7D44</button>' +
      '<div class="module-header">' +
        '<span class="module-id-badge">' + mod.id + '</span>' +
        '<h2>' + mod.name + '</h2>' +
      '</div>' +
      '<div class="phase-intro">' +
        '<h3>\u{1F9ED} \u6846\u67B6\u554F</h3>' +
        '<p class="q-block-question">' + mod.frameworkQ.question + '</p>' +
        '<p class="q-block-hint">' + mod.frameworkQ.hint + '</p>' +
      '</div>' +
      '<h3 style="margin:16px 0 8px;">\u6838\u5FC3\u6982\u5FF5\uFF08\u8ACB\u81EA\u8A55\u719F\u6089\u5EA6\uFF09</h3>' +
      '<div id="conceptCards">' + cardsHtml + '</div>' +
      '<button class="btn-primary btn-block" id="btnToP2" disabled onclick="LearnUI._goPhase2()">' +
        '\u5168\u90E8\u8A55\u5B8C\u5F8C\u7E7C\u7E8C \u2192 \u722D\u8B70\u63A2\u7D22' +
      '</button>';
  }

  function _rateFw(conceptId, val) {
    state.phase1.ratings[conceptId] = val;
    var stars = document.querySelectorAll('.star[data-fw="' + conceptId + '"]');
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      if (parseInt(s.dataset.val, 10) <= val) {
        s.classList.add('lit');
      } else {
        s.classList.remove('lit');
      }
    }
    var needed = currentModule.concepts.length;
    var rated = Object.keys(state.phase1.ratings).length;
    var btn = document.getElementById('btnToP2');
    if (btn) btn.disabled = rated < needed;
  }

  // ========== Phase 2: 爭議選邊 ==========
  function _goPhase2() {
    state.phase = 2;
    renderPhase2();
  }

  function renderPhase2() {
    var mod = currentModule;
    var cq = mod.controversyQ;

    document.getElementById('module-view').innerHTML =
      '<div class="phase-bar">' +
        '<span class="phase-tag" style="background:var(--gold)">Phase 2</span>' +
        '<span class="phase-label">\u722D\u8B70\u63A2\u7D22</span>' +
        '<div class="phase-progress"><div class="phase-fill" style="width:40%"></div></div>' +
      '</div>' +
      '<button class="back-btn" onclick="LearnUI.backToModules()">\u2190 \u8FD4\u56DE\u6A21\u7D44</button>' +
      '<div class="phase-intro">' +
        '<h3>\u26A1 \u722D\u8B70\u554F</h3>' +
        '<p class="q-block-scenario">' + cq.scenario + '</p>' +
      '</div>' +
      '<p style="font-size:13px;color:var(--muted);margin-bottom:12px;">\u9078\u4E00\u908A\uFF0C\u770B\u770B\u96D9\u65B9\u600E\u9EBC\u8AAA\uFF1A</p>' +
      '<div class="side-btns">' +
        '<button class="side-btn" id="sideABtn" onclick="LearnUI._chooseSide(\'A\')">\u{1F170}\uFE0F ' + cq.sideA.label + '</button>' +
        '<button class="side-btn" id="sideBBtn" onclick="LearnUI._chooseSide(\'B\')">\u{1F171}\uFE0F ' + cq.sideB.label + '</button>' +
      '</div>' +
      '<div id="debateReveal" style="display:none">' +
        '<div class="side-argument side-a">' +
          '<strong>\u{1F170}\uFE0F ' + cq.sideA.label + '</strong>' +
          '<p>' + cq.sideA.argument + '</p>' +
        '</div>' +
        '<div class="side-argument side-b">' +
          '<strong>\u{1F171}\uFE0F ' + cq.sideB.label + '</strong>' +
          '<p>' + cq.sideB.argument + '</p>' +
        '</div>' +
        '<div class="controversy-insight">' +
          '<strong>\u{1F50D} \u6574\u5408\u89C0\u9EDE</strong>' +
          '<p>' + cq.insight + '</p>' +
        '</div>' +
        '<button class="btn-primary btn-block" style="margin-top:16px;" onclick="LearnUI._goPhase3()">' +
          '\u7E7C\u7E8C \u2192 \u9451\u5225\u984C' +
        '</button>' +
      '</div>';
  }

  function _chooseSide(side) {
    state.phase2.choice = side;
    var btnA = document.getElementById('sideABtn');
    var btnB = document.getElementById('sideBBtn');
    if (btnA) {
      if (side === 'A') { btnA.classList.add('chosen'); } else { btnA.classList.remove('chosen'); }
    }
    if (btnB) {
      if (side === 'B') { btnB.classList.add('chosen'); } else { btnB.classList.remove('chosen'); }
    }
    var reveal = document.getElementById('debateReveal');
    if (reveal) reveal.style.display = 'block';
  }

  // ========== Phase 3: 鑑別題 + AI 追問 ==========
  function _goPhase3() {
    state.phase = 3;
    state.phase3 = { answers: {}, currentQ: 0 };
    currentQuestions = (currentModule.questions || []).slice();
    renderPhase3();
  }

  function renderPhase3() {
    var mod = currentModule;
    var total = currentQuestions.length;
    var answeredKeys = Object.keys(state.phase3.answers);
    var answered = answeredKeys.length;

    if (total === 0) {
      document.getElementById('module-view').innerHTML =
        '<button class="back-btn" onclick="LearnUI.backToModules()">\u2190 \u8FD4\u56DE\u6A21\u7D44</button>' +
        '<div class="empty-state">' +
          '<p>\u672C\u6A21\u7D44\u984C\u5EAB\u5EFA\u7F6E\u4E2D\uFF0C\u656C\u8ACB\u671F\u5F85 \u{1F6A7}</p>' +
        '</div>';
      return;
    }

    var pct = 20 + (answered / total) * 40;

    var navHtml = currentQuestions.map(function(q, i) {
      var done = state.phase3.answers[q.id] !== undefined;
      var correct = done && state.phase3.answers[q.id].correct;
      var cls = 'qnav-btn';
      if (done) cls += correct ? ' done-correct' : ' done-wrong';
      if (i === state.phase3.currentQ) cls += ' current';
      return '<button class="' + cls + '" onclick="LearnUI._goToQ(' + i + ')">' + (i + 1) + '</button>';
    }).join('');

    var finishBtn = '';
    if (answered >= total) {
      finishBtn = '<div style="text-align:center;margin-top:20px;">' +
        '<button class="btn-primary btn-lg" onclick="LearnUI._goPhase4()">\u{1F4CA} \u67E5\u770B\u5B78\u7FD2\u5831\u544A \u2192</button>' +
      '</div>';
    }

    document.getElementById('module-view').innerHTML =
      '<div class="phase-bar">' +
        '<span class="phase-tag" style="background:var(--green)">Phase 3</span>' +
        '<span class="phase-label">\u9451\u5225\u984C ' + answered + '/' + total + '</span>' +
        '<div class="phase-progress"><div class="phase-fill" style="width:' + pct + '%"></div></div>' +
      '</div>' +
      '<button class="back-btn" onclick="LearnUI.backToModules()">\u2190 \u8FD4\u56DE\u6A21\u7D44</button>' +
      '<div class="question-nav">' + navHtml + '</div>' +
      '<div id="question-container"></div>' +
      finishBtn;

    _renderCurrentQ();
  }

  function _goToQ(idx) {
    state.phase3.currentQ = idx;
    renderPhase3();
  }

  function _renderCurrentQ() {
    var idx = state.phase3.currentQ;
    if (idx >= currentQuestions.length) return;
    var q = currentQuestions[idx];
    var container = document.getElementById('question-container');
    if (!container) return;

    var answered = state.phase3.answers[q.id];

    var optionsHtml = (q.options || []).map(function(opt, i) {
      var cls = 'q-option';
      if (answered) {
        cls += ' locked';
        if (i === q.correct) cls += ' correct';
        if (i === answered.chosen && !answered.correct) cls += ' wrong';
      }
      var handler = answered ? 'disabled' : 'onclick="LearnUI._answerQ(\'' + q.id + '\',' + i + ')"';
      return '<button class="' + cls + '" data-idx="' + i + '" ' + handler + '>' +
        '<span class="opt-letter">' + String.fromCharCode(65 + i) + '</span>' +
        '<span class="opt-text">' + opt + '</span>' +
      '</button>';
    }).join('');

    var feedbackHtml = answered ? _buildFeedback(q, answered) : '';

    container.innerHTML =
      '<div class="question-card">' +
        '<div class="q-head">' +
          '<span class="q-number">Q' + (idx + 1) + '</span>' +
          '<span class="q-type">' + (q.type || '\u55AE\u9078') + '</span>' +
          (q.epRef ? '<a class="q-epref" href="/sustainability-100/episodes/EP' + String(q.epRef).padStart(3, '0') + '/" target="_blank">\u{1F4DA} S100 EP' + q.epRef + '</a>' : '') +
        '</div>' +
        '<p class="q-text">' + q.q + '</p>' +
        '<div class="q-options" id="qOptions">' + optionsHtml + '</div>' +
        '<div id="qFeedback">' + feedbackHtml + '</div>' +
      '</div>';
  }

  function _buildFeedback(q, answered) {
    if (answered.correct) {
      return '<div class="q-feedback correct">' +
        '<div class="feedback-head">\u2705 \u6B63\u78BA\uFF01</div>' +
        (q.explain ? '<div class="feedback-explain">' + q.explain + '</div>' : '') +
        (q.epRef ? '<div class="feedback-ref">\u{1F4A1} \u5EF6\u4F38\u8907\u7FD2\uFF1A<a href="/sustainability-100/episodes/EP' + String(q.epRef).padStart(3, '0') + '/" target="_blank">S100 EP' + q.epRef + '</a></div>' : '') +
        '<button class="btn-primary" onclick="LearnUI._nextQ()" style="margin-top:8px;">\u4E0B\u4E00\u984C \u2192</button>' +
      '</div>';
    }

    var chosenLetter = String.fromCharCode(65 + answered.chosen);
    var correctLetter = String.fromCharCode(65 + q.correct);
    return '<div class="q-feedback wrong">' +
      '<div class="feedback-head">\u274C \u4E0D\u5C0D</div>' +
      (q.explain ? '<div class="feedback-explain">' + q.explain + '</div>' : '') +
      (q.epRef ? '<div class="feedback-ref">\u{1F4A1} \u5EF6\u4F38\u8907\u7FD2\uFF1A<a href="/sustainability-100/episodes/EP' + String(q.epRef).padStart(3, '0') + '/" target="_blank">S100 EP' + q.epRef + '</a></div>' : '') +
      '<div class="ai-chat" id="aiChat">' +
        '<div class="ai-chat-header">\u{1F916} AI \u8FFD\u554F\u5F15\u64CE</div>' +
        '<div class="ai-chat-body" id="aiChatBody">' +
          '<div class="ai-msg from-ai">\u4F60\u9078\u4E86 ' + chosenLetter + '\uFF0C\u4F46\u6B63\u78BA\u7B54\u6848\u662F ' + correctLetter + '\u3002\u60F3\u60F3\u770B\u5169\u8005\u7684\u5DEE\u7570\u5728\u54EA\uFF1F\u6709\u4EC0\u9EBC\u7591\u554F\u53EF\u4EE5\u554F\u6211\u3002</div>' +
        '</div>' +
        '<div class="ai-input-row">' +
          '<input type="text" id="aiChatInput" placeholder="\u8F38\u5165\u4F60\u7684\u60F3\u6CD5..." onkeydown="if(event.key===\'Enter\'){event.preventDefault();LearnUI._sendChat();}">' +
          '<button onclick="LearnUI._sendChat()">\u9001\u51FA</button>' +
        '</div>' +
      '</div>' +
      '<button class="btn-secondary" onclick="LearnUI._nextQ()" style="margin-top:8px;">\u7E7C\u7E8C\u4E0B\u4E00\u984C \u2192</button>' +
    '</div>';
  }

  function _answerQ(qId, chosenIdx) {
    var q = currentQuestions.find(function(x) { return x.id === qId; });
    if (!q) return;
    if (state.phase3.answers[qId]) return; // already answered
    var correct = chosenIdx === q.correct;
    state.phase3.answers[qId] = { correct: correct, chosen: chosenIdx, ts: Date.now() };

    LearnEngine.recordAnswer(currentLevel, state.moduleId, qId, correct, chosenIdx);

    renderPhase3();
  }

  function _nextQ() {
    var next = state.phase3.currentQ + 1;
    // Find next unanswered
    while (next < currentQuestions.length && state.phase3.answers[currentQuestions[next].id]) {
      next++;
    }
    if (next >= currentQuestions.length) {
      // All answered or no more unanswered — go to last
      next = currentQuestions.length - 1;
    }
    state.phase3.currentQ = next;
    renderPhase3();
  }

  // ========== AI 追問（Gemini via Cloudflare Worker） ==========
  var _chatCooldown = false;

  function _sendChat() {
    if (_chatCooldown) return;
    var input = document.getElementById('aiChatInput');
    if (!input) return;
    var msg = input.value.trim();
    if (!msg) return;
    input.value = '';

    var body = document.getElementById('aiChatBody');
    if (!body) return;
    body.innerHTML += '<div class="ai-msg from-user">' + _escapeHtml(msg) + '</div>';
    body.innerHTML += '<div class="ai-msg from-ai" id="aiLoading" style="opacity:.5">\u601D\u8003\u4E2D...</div>';
    body.scrollTop = body.scrollHeight;

    _chatCooldown = true;
    setTimeout(function() { _chatCooldown = false; }, 6000);

    var q = currentQuestions[state.phase3.currentQ];
    var chosen = state.phase3.answers[q.id] ? state.phase3.answers[q.id].chosen : 0;

    // Collect chat history
    var msgs = body.querySelectorAll('.ai-msg');
    var historyParts = [];
    for (var i = 0; i < msgs.length; i++) {
      var el = msgs[i];
      var text = el.textContent.trim();
      if (text.indexOf('\u601D\u8003\u4E2D') !== -1) continue;
      var role = el.classList.contains('from-user') ? '\u5B78\u751F' : '\u52A9\u6559';
      historyParts.push(role + '\uFF1A' + text);
    }
    var history = historyParts.slice(-6).join('\n');

    var optionsText = (q.options || []).map(function(o, idx) {
      return String.fromCharCode(65 + idx) + '. ' + o;
    }).join('\n');

    var prompt = '\u4F60\u662F iPAS \u6DE8\u96F6\u78B3\u898F\u5283\u7BA1\u7406\u5E2B\u8003\u8A66\u7684\u5B78\u7FD2\u52A9\u6559\u3002\u7528\u767D\u8A71\u3001\u6BD4\u55BB\u3001\u751F\u6D3B\u5316\u4F8B\u5B50\u4F86\u89E3\u91CB\u3002\n\n' +
      '\u6A21\u7D44\uFF1A' + currentModule.name + '\n' +
      '\u984C\u76EE\uFF1A' + q.q + '\n' +
      '\u9078\u9805\uFF1A\n' + optionsText + '\n' +
      '\u5B78\u751F\u9078\u4E86\uFF1A' + String.fromCharCode(65 + chosen) + '\n' +
      '\u6B63\u78BA\u7B54\u6848\uFF1A' + String.fromCharCode(65 + q.correct) + '\n' +
      (q.explain ? '\u89E3\u6790\uFF1A' + q.explain + '\n' : '') +
      '\n\u5C0D\u8A71\u7D00\u9304\uFF1A\n' + history + '\n' +
      '\n\u5B78\u751F\u6700\u65B0\u56DE\u8986\uFF1A\u300C' + msg + '\u300D\n' +
      '\n\u7528\u84C7\u683C\u62C9\u5E95\u5F0F\u63D0\u554F\u5F15\u5C0E\uFF1A\n' +
      '1. \u80AF\u5B9A\u56DE\u8986\u4E2D\u6B63\u78BA\u7684\u90E8\u5206\n' +
      '2. \u7528\u5177\u9AD4\u4F8B\u5B50\u5E6B\u4ED6\u770B\u5230\u907A\u6F0F\n' +
      '3. \u4E0D\u76F4\u63A5\u7D66\u7B54\u6848\uFF0C\u7528\u5F15\u5C0E\u554F\u984C\u6536\u5C3E\n' +
      '3-4 \u53E5\u8A71\uFF0C\u7E41\u9AD4\u4E2D\u6587\uFF0C\u4E0D\u7528 markdown\u3002';

    _callGemini(prompt).then(function(reply) {
      var loading = document.getElementById('aiLoading');
      if (loading) loading.remove();
      var b = document.getElementById('aiChatBody');
      if (b) {
        b.innerHTML += '<div class="ai-msg from-ai">' + (reply || '\u62B1\u6B49\uFF0CAI \u66AB\u6642\u7121\u6CD5\u56DE\u61C9\u3002') + '</div>';
        b.scrollTop = b.scrollHeight;
      }
    }).catch(function() {
      var loading = document.getElementById('aiLoading');
      if (loading) loading.remove();
      var b = document.getElementById('aiChatBody');
      if (b) {
        b.innerHTML += '<div class="ai-msg from-ai">\u9023\u7DDA\u932F\u8AA4\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66\u3002</div>';
        b.scrollTop = b.scrollHeight;
      }
    });
  }

  function _callGemini(prompt) {
    var API = 'https://api.cooperation.tw';
    return fetch(API + '/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 4096, temperature: 0.7 }
      })
    }).then(function(res) {
      if (!res.ok) return '';
      return res.json().then(function(data) {
        return (data.candidates && data.candidates[0] && data.candidates[0].content &&
                data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
                data.candidates[0].content.parts[0].text) || '';
      });
    }).catch(function() { return ''; });
  }

  function _escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  // ========== Phase 4: 報告（雷達圖 + 自評對比） ==========
  function _goPhase4() {
    state.phase = 4;
    showReport(state.moduleId);
  }

  function loadChartJs() {
    return new Promise(function(resolve) {
      if (window.Chart) return resolve();
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4';
      s.onload = resolve;
      document.head.appendChild(s);
    });
  }

  function showReport(moduleId) {
    var data = LEARN_DATA[currentLevel];
    var mod = data.modules.find(function(m) { return m.id === moduleId; });
    if (!mod || !mod.concepts) return;

    var result = LearnEngine.getWeakConcepts(currentLevel, moduleId);
    var weakIds = result.concepts;
    var scores = result.scores;

    var labels = mod.concepts.map(function(c) { return c.name; });
    var values = mod.concepts.map(function(c) {
      var s = scores[c.id];
      return s && s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0;
    });

    // Self-assessment data from Phase 1 (if available)
    var hasSelfRatings = Object.keys(state.phase1.ratings).length > 0;
    var selfValues = mod.concepts.map(function(c) {
      return (state.phase1.ratings[c.id] || 0) * 20; // 1-5 → 20-100
    });

    document.getElementById('module-view').innerHTML =
      '<div class="phase-bar">' +
        '<span class="phase-tag" style="background:var(--blue)">Phase 4</span>' +
        '<span class="phase-label">\u5B78\u7FD2\u5831\u544A</span>' +
        '<div class="phase-progress"><div class="phase-fill" style="width:80%"></div></div>' +
      '</div>' +
      '<button class="back-btn" onclick="LearnUI.backToModules()">\u2190 \u8FD4\u56DE\u6A21\u7D44</button>' +
      '<div class="report-header"><h2>\u{1F4CA} ' + mod.name + ' \u2014 \u5B78\u7FD2\u5831\u544A</h2></div>' +
      '<div class="report-chart"><canvas id="conceptRadar"></canvas></div>' +
      '<div class="report-scores" id="reportScores"></div>' +
      '<div class="report-weak" id="reportWeak"></div>' +
      '<div class="report-actions" id="reportActions"></div>';

    loadChartJs().then(function() {
      var datasets = [{
        label: '\u6E2C\u9A57\u8868\u73FE',
        data: values,
        backgroundColor: 'rgba(45,106,79,.2)',
        borderColor: '#2d6a4f',
        pointBackgroundColor: '#2d6a4f',
        borderWidth: 2
      }];

      if (hasSelfRatings) {
        datasets.push({
          label: '\u81EA\u8A55\u719F\u6089\u5EA6',
          data: selfValues,
          backgroundColor: 'rgba(249,171,0,.15)',
          borderColor: '#f77f00',
          pointBackgroundColor: '#f77f00',
          borderWidth: 2,
          borderDash: [5, 5]
        });
      }

      new Chart(document.getElementById('conceptRadar'), {
        type: 'radar',
        data: {
          labels: labels,
          datasets: datasets
        },
        options: {
          responsive: true,
          scales: { r: { min: 0, max: 100, ticks: { stepSize: 25 } } },
          plugins: { legend: { display: hasSelfRatings } }
        }
      });
    });

    var scoresHtml = mod.concepts.map(function(c) {
      var s = scores[c.id];
      var pct = s && s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0;
      var lv = pct >= 70 ? 'good' : pct >= 40 ? 'mid' : 'weak';
      var lvText = { good: '\u638C\u63E1\u826F\u597D', mid: '\u9700\u8907\u7FD2', weak: '\u9700\u52A0\u5F37' }[lv];
      return '<div class="score-row ' + lv + '">' +
        '<span class="score-name">' + c.name + '</span>' +
        '<span class="score-bar"><span class="score-fill" style="width:' + pct + '%"></span></span>' +
        '<span class="score-pct">' + pct + '%</span>' +
        '<span class="score-badge ' + lv + '">' + lvText + '</span>' +
      '</div>';
    }).join('');
    document.getElementById('reportScores').innerHTML = scoresHtml;

    if (weakIds.length === 0) {
      document.getElementById('reportWeak').innerHTML = '<div class="report-msg good">\u2705 \u8868\u73FE\u512A\u79C0\uFF01\u6240\u6709\u6982\u5FF5\u7DAD\u5EA6\u90FD\u638C\u63E1\u5F97\u4E0D\u932F\u3002</div>';
      document.getElementById('reportActions').innerHTML = '<button class="btn-primary" onclick="LearnUI.backToModules()">\u8FD4\u56DE\u6A21\u7D44\u5217\u8868</button>';
    } else {
      var weakNames = weakIds.map(function(id) {
        var found = mod.concepts.find(function(c) { return c.id === id; });
        return found ? found.name : '';
      }).filter(Boolean);
      document.getElementById('reportWeak').innerHTML =
        '<div class="report-msg weak">\u26A0\uFE0F \u767C\u73FE ' + weakIds.length + ' \u500B\u9700\u8981\u52A0\u5F37\u7684\u6982\u5FF5\u7DAD\u5EA6\uFF1A<strong>' + weakNames.join('\u3001') + '</strong></div>';
      document.getElementById('reportActions').innerHTML =
        '<button class="btn-primary btn-lg" onclick="LearnUI.startPhase5(\'' + moduleId + '\')">\u{1F3AF} \u958B\u59CB\u5F31\u9805\u52A0\u5F37\u7DF4\u7FD2 \u2192</button>' +
        '<button class="btn-secondary" onclick="LearnUI.backToModules()" style="margin-top:8px;display:block;width:100%;text-align:center;">\u8DF3\u904E\uFF0C\u8FD4\u56DE\u6A21\u7D44</button>';
    }
  }

  // ========== Phase 5: 弱項加強 ==========
  var p5State = null;

  function startPhase5(moduleId) {
    var data = LEARN_DATA[currentLevel];
    var mod = data.modules.find(function(m) { return m.id === moduleId; });
    if (!mod) return;

    var result = LearnEngine.getWeakConcepts(currentLevel, moduleId);
    var weakIds = result.concepts;
    if (weakIds.length === 0) return;

    var reinforceQs = (mod.reinforcement || []).filter(function(q) {
      var cids = LearnEngine.getQuestionConcepts(q, mod.concepts);
      return cids.some(function(c) { return weakIds.indexOf(c) !== -1; });
    });

    var allQs = reinforceQs.slice();

    // If not enough, try AI generation
    if (allQs.length < 5 && typeof LearnLayer2 !== 'undefined' && LearnLayer2.generateReinforcement) {
      document.getElementById('module-view').innerHTML =
        '<div class="phase5-loading">' +
          '<h2>\u{1F3AF} \u6E96\u5099\u5F31\u9805\u52A0\u5F37\u984C...</h2>' +
          '<p>AI \u6B63\u5728\u6839\u64DA\u4F60\u7684\u5F31\u9805\u751F\u6210\u91DD\u5C0D\u6027\u984C\u76EE</p>' +
          '<div class="loading-spinner"></div>' +
        '</div>';
      LearnLayer2.generateReinforcement(currentLevel, moduleId, weakIds).then(function(aiQs) {
        allQs = allQs.concat(aiQs || []);
        _startP5(allQs, mod, moduleId, weakIds);
      }).catch(function() {
        _startP5(allQs, mod, moduleId, weakIds);
      });
    } else {
      _startP5(allQs, mod, moduleId, weakIds);
    }
  }

  function _startP5(allQs, mod, moduleId, weakIds) {
    if (allQs.length === 0) {
      document.getElementById('module-view').innerHTML =
        '<button class="back-btn" onclick="LearnUI.backToModules()">\u2190 \u8FD4\u56DE</button>' +
        '<div class="report-msg">\u76EE\u524D\u6C92\u6709\u52A0\u5F37\u984C\u53EF\u7528\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66\u3002</div>';
      return;
    }
    p5State = { allQs: allQs, idx: 0, answers: {}, mod: mod, moduleId: moduleId, weakIds: weakIds };
    renderP5Question();
  }

  function renderP5Question() {
    if (!p5State) return;
    if (p5State.idx >= p5State.allQs.length) {
      renderP5Summary();
      return;
    }
    var q = p5State.allQs[p5State.idx];
    var cids = LearnEngine.getQuestionConcepts(q, p5State.mod.concepts);
    var conceptName = '';
    if (cids.length > 0) {
      var found = p5State.mod.concepts.find(function(c) { return c.id === cids[0]; });
      conceptName = found ? found.name : '';
    }

    document.getElementById('module-view').innerHTML =
      '<div class="phase-bar">' +
        '<span class="phase-tag" style="background:var(--red)">Phase 5</span>' +
        '<span class="phase-label">\u5F31\u9805\u52A0\u5F37 ' + (p5State.idx + 1) + '/' + p5State.allQs.length + '</span>' +
        '<div class="phase-progress"><div class="phase-fill" style="width:' + (80 + (p5State.idx / p5State.allQs.length) * 20) + '%"></div></div>' +
      '</div>' +
      (conceptName ? '<div class="phase5-concept">\u805A\u7126\uFF1A' + conceptName + '</div>' : '') +
      '<div class="question-card">' +
        '<p class="q-text">' + q.q + '</p>' +
        '<div class="q-options" id="p5options">' +
          (q.options || []).map(function(opt, i) {
            return '<button class="q-option" data-idx="' + i + '" onclick="LearnUI._p5answer(' + i + ')">' +
              '<span class="opt-letter">' + String.fromCharCode(65 + i) + '</span>' +
              '<span class="opt-text">' + opt + '</span>' +
            '</button>';
          }).join('') +
        '</div>' +
        '<div id="p5feedback" class="q-feedback" style="display:none"></div>' +
      '</div>';
  }

  function _p5answer(idx) {
    if (!p5State) return;
    var q = p5State.allQs[p5State.idx];
    var correct = idx === q.correct;
    p5State.answers[q.id || p5State.idx] = { correct: correct, chosen: idx };

    var buttons = document.querySelectorAll('#p5options .q-option');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].disabled = true;
      if (i === q.correct) buttons[i].classList.add('correct');
      if (i === idx && !correct) buttons[i].classList.add('wrong');
    }

    var fb = document.getElementById('p5feedback');
    fb.style.display = 'block';
    fb.className = 'q-feedback ' + (correct ? 'correct' : 'wrong');
    fb.innerHTML =
      '<div class="feedback-head">' + (correct ? '\u2705 \u7B54\u5C0D\u4E86\uFF01' : '\u274C \u518D\u60F3\u60F3') + '</div>' +
      (q.explain ? '<div class="feedback-explain">' + q.explain + '</div>' : '') +
      '<button class="btn-primary" onclick="LearnUI._p5next()" style="margin-top:12px;">' +
        (p5State.idx < p5State.allQs.length - 1 ? '\u4E0B\u4E00\u984C \u2192' : '\u67E5\u770B\u52A0\u5F37\u7D50\u679C') +
      '</button>';

    LearnEngine.recordAnswer(currentLevel, p5State.moduleId, q.id || ('p5_' + p5State.idx), correct, idx);
  }

  function _p5next() {
    if (!p5State) return;
    p5State.idx++;
    renderP5Question();
  }

  function renderP5Summary() {
    if (!p5State) return;
    var keys = Object.keys(p5State.answers);
    var total = keys.length;
    var correct = 0;
    for (var i = 0; i < keys.length; i++) {
      if (p5State.answers[keys[i]].correct) correct++;
    }
    var pct = total > 0 ? Math.round((correct / total) * 100) : 0;
    var msg = pct >= 70
      ? '\u2705 \u52A0\u5F37\u6548\u679C\u826F\u597D\uFF01\u5F31\u9805\u5DF2\u6709\u660E\u986F\u6539\u5584\u3002'
      : pct >= 40
        ? '\u26A0\uFE0F \u9084\u6709\u9032\u6B65\u7A7A\u9593\uFF0C\u5EFA\u8B70\u56DE\u53BB\u8907\u7FD2 S100 \u76F8\u95DC\u7AE0\u7BC0\u3002'
        : '\u274C \u9019\u4E9B\u6982\u5FF5\u4ECD\u9700\u8981\u52A0\u5F37\uFF0C\u5EFA\u8B70\u91CD\u65B0\u5B78\u7FD2\u76F8\u95DC\u5167\u5BB9\u3002';
    var mid = p5State.moduleId;

    document.getElementById('module-view').innerHTML =
      '<div class="phase5-summary">' +
        '<h2>\u{1F3AF} \u5F31\u9805\u52A0\u5F37\u5B8C\u6210</h2>' +
        '<div class="summary-score">' +
          '<div class="score-big">' + correct + '/' + total + '</div>' +
          '<div class="score-label">\u7B54\u5C0D</div>' +
        '</div>' +
        '<div class="summary-msg">' + msg + '</div>' +
        '<div class="summary-actions">' +
          '<button class="btn-primary" onclick="LearnUI.showReport(\'' + mid + '\')">\u{1F4CA} \u91CD\u770B\u5B78\u7FD2\u5831\u544A</button>' +
          '<button class="btn-secondary" onclick="LearnUI.backToModules()">\u8FD4\u56DE\u6A21\u7D44\u5217\u8868</button>' +
        '</div>' +
      '</div>';

    p5State = null;
  }

  // ========== 返回 / 初始化 ==========
  function backToModules() {
    document.getElementById('module-view').style.display = 'none';
    document.getElementById('modules-view').style.display = 'block';
    currentModule = null;
    state.phase = 0;
    renderModules();
  }

  function init() {
    LearnEngine.getOrCreateOdID();
    renderLevelInfo();
    renderModules();
  }

  // ========== 匯出 ==========
  global.LearnUI = {
    init: init,
    openModule: openModule,
    backToModules: backToModules,
    showReport: showReport,
    startPhase5: startPhase5,
    _rateFw: _rateFw,
    _goPhase2: _goPhase2,
    _chooseSide: _chooseSide,
    _goPhase3: _goPhase3,
    _goToQ: _goToQ,
    _answerQ: _answerQ,
    _nextQ: _nextQ,
    _sendChat: _sendChat,
    _goPhase4: _goPhase4,
    _p5answer: _p5answer,
    _p5next: _p5next
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window);
