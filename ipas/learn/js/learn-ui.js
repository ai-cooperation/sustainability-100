// iPAS 三問法學習系統 — UI 控制
// 負責：tab 切換、模組卡片渲染、答題介面、進度顯示

(function(global) {
  'use strict';

  let currentLevel = (typeof window !== 'undefined' && window.LEARN_LEVEL) || 'l2';
  let currentModule = null;
  let currentQuestionIdx = 0;
  let currentQuestions = [];

  // ========== 等級資訊 ==========
  function renderLevelInfo() {
    const data = LEARN_DATA[currentLevel];
    const info = document.getElementById('level-info');
    if (!info || !data) return;
    info.innerHTML = `
      <h2>${data.nameFull}</h2>
      <p class="exam-format">📝 ${data.examFormat}</p>
      <p class="focus">🎯 ${data.focus}</p>
      ${data.examStyle ? `<p class="exam-style">${data.examStyle}</p>` : ''}
    `;
  }

  // ========== 模組卡片渲染 ==========
  function renderModules() {
    const data = LEARN_DATA[currentLevel];
    const container = document.getElementById('modules-grid');
    if (!container || !data) return;
    const progress = LearnEngine.getProgress();

    container.innerHTML = data.modules.map(mod => {
      const key = `${currentLevel}.${mod.id}`;
      const prog = progress[key] || { correct: 0, total: 0 };
      const qTotal = (mod.questions?.length || 0) + (mod.reinforcement?.length || 0);
      const pct = qTotal > 0 ? Math.round((prog.total / qTotal) * 100) : 0;
      return `
        <div class="module-card" data-module="${mod.id}" onclick="LearnUI.openModule('${mod.id}')">
          <div class="module-id">${mod.id}</div>
          <h3>${mod.name}</h3>
          <p class="module-subject">${mod.subject}</p>
          <p class="module-scope">${mod.scope}</p>
          <div class="module-progress">
            <div class="progress-bar">
              <div class="progress-fill" style="width:${pct}%"></div>
            </div>
            <span class="progress-text">${prog.total}/${qTotal} 題 · 正確 ${prog.correct}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  // ========== 打開模組 → 進入三問法 ==========
  async function openModule(moduleId) {
    const data = LEARN_DATA[currentLevel];
    const mod = data.modules.find(m => m.id === moduleId);
    if (!mod) return;
    currentModule = mod;
    currentQuestions = await LearnEngine.getQuestions(currentLevel, moduleId);

    document.getElementById('modules-view').style.display = 'none';
    document.getElementById('module-view').style.display = 'block';

    document.getElementById('module-view').innerHTML = `
      <button class="back-btn" onclick="LearnUI.backToModules()">← 返回模組</button>
      <div class="module-header">
        <span class="module-id-badge">${mod.id}</span>
        <h2>${mod.name}</h2>
        <p class="module-scope">${mod.scope}</p>
        ${mod.examTips ? `<p class="module-exam-tips">${mod.examTips}</p>` : ''}
      </div>

      <section class="three-question-section">
        ${mod.frameworkQ ? `
        <div class="q-block framework">
          <h3>🧭 框架問</h3>
          <p class="q-block-question">${mod.frameworkQ.question}</p>
          <p class="q-block-hint">${mod.frameworkQ.hint}</p>
          <div class="q-block-answer" id="fwAnswer" style="display:none">
            <p>${mod.frameworkQ.answer}</p>
          </div>
          <button class="btn-reveal" id="fwRevealBtn" onclick="LearnUI._toggleAnswer('fwAnswer','fwRevealBtn')">💡 看參考解析</button>
        </div>` : `
        <div class="q-block framework">
          <h3>🧭 框架問</h3>
          <p>${mod.frameworkQuestion}</p>
        </div>`}

        ${mod.controversyQ ? `
        <div class="q-block controversy">
          <h3>⚡ 爭議問</h3>
          <p class="q-block-scenario">${mod.controversyQ.scenario}</p>
          <div class="side-btns">
            <button class="side-btn" id="sideABtn" onclick="LearnUI._chooseSide('A')">${mod.controversyQ.sideA.label}</button>
            <button class="side-btn" id="sideBBtn" onclick="LearnUI._chooseSide('B')">${mod.controversyQ.sideB.label}</button>
          </div>
          <div class="controversy-reveal" id="controversyReveal" style="display:none">
            <div class="side-argument side-a">
              <strong>🅰️ ${mod.controversyQ.sideA.label}</strong>
              <p>${mod.controversyQ.sideA.argument}</p>
            </div>
            <div class="side-argument side-b">
              <strong>🅱️ ${mod.controversyQ.sideB.label}</strong>
              <p>${mod.controversyQ.sideB.argument}</p>
            </div>
            <div class="controversy-insight">
              <strong>🔍 整合觀點</strong>
              <p>${mod.controversyQ.insight}</p>
            </div>
          </div>
        </div>` : `
        <div class="q-block controversy">
          <h3>⚡ 爭議問</h3>
          <p>${mod.controversy}</p>
        </div>`}
      </section>

      <section class="questions-section">
        <h3>🎯 鑑別題（${currentQuestions.length} 題）</h3>
        ${currentQuestions.length === 0
          ? `<div class="empty-state">
               <p>本模組題庫建置中，敬請期待 🚧</p>
               <p class="hint">中級 MVP 優先推出：L211 / L213 / L222</p>
             </div>`
          : `<div class="question-nav">
               ${currentQuestions.map((_, i) => `<button class="qnav-btn" onclick="LearnUI.showQuestion(${i})">${i+1}</button>`).join('')}
             </div>
             <div id="question-container"></div>`
        }
      </section>
      ${mod.concepts ? `
      <section class="report-trigger" style="margin-top:16px;">
        <button class="btn-primary btn-block" onclick="LearnUI.showReport('${mod.id}')">📊 查看學習報告</button>
      </section>` : ''}
    `;

    if (currentQuestions.length > 0) showQuestion(0);
  }

  function showQuestion(idx) {
    if (idx < 0 || idx >= currentQuestions.length) return;
    currentQuestionIdx = idx;
    const q = currentQuestions[idx];
    const container = document.getElementById('question-container');
    if (!container) return;

    container.innerHTML = `
      <div class="question-card">
        <div class="q-head">
          <span class="q-number">Q${idx + 1}</span>
          <span class="q-type">${q.type || '單選'}</span>
          ${q.epRef ? `<a class="q-epref" href="/sustainability-100/episodes/EP${String(q.epRef).padStart(3,'0')}/" target="_blank">📚 S100 EP${q.epRef}</a>` : ''}
        </div>
        <p class="q-text">${q.q}</p>
        <div class="q-options">
          ${(q.options || []).map((opt, i) => `
            <button class="q-option" data-idx="${i}" onclick="LearnUI.selectOption(${i})">
              <span class="opt-letter">${String.fromCharCode(65 + i)}</span>
              <span class="opt-text">${opt}</span>
            </button>
          `).join('')}
        </div>
        <div id="q-feedback" class="q-feedback" style="display:none"></div>
        <div class="q-actions">
          <button class="q-nav-prev" onclick="LearnUI.showQuestion(${idx - 1})" ${idx === 0 ? 'disabled' : ''}>← 上一題</button>
          <button class="q-report" onclick="LearnUI.reportCurrentQ()">🚩 回報問題</button>
          <button class="q-nav-next" onclick="LearnUI.showQuestion(${idx + 1})" ${idx === currentQuestions.length - 1 ? 'disabled' : ''}>下一題 →</button>
        </div>
      </div>
    `;
  }

  async function selectOption(idx) {
    const q = currentQuestions[currentQuestionIdx];
    const buttons = document.querySelectorAll('.q-option');
    const correct = idx === q.correct;

    buttons.forEach((btn, i) => {
      btn.disabled = true;
      if (i === q.correct) btn.classList.add('correct');
      if (i === idx && !correct) btn.classList.add('wrong');
    });

    const fb = document.getElementById('q-feedback');
    fb.style.display = 'block';
    fb.className = 'q-feedback ' + (correct ? 'correct' : 'wrong');
    fb.innerHTML = `
      <div class="feedback-head">${correct ? '✅ 答對了！' : '❌ 不對'}</div>
      ${q.explain ? `<div class="feedback-explain">${q.explain}</div>` : ''}
      ${q.epRef ? `<div class="feedback-ref">💡 延伸複習：<a href="/sustainability-100/episodes/EP${String(q.epRef).padStart(3,'0')}/" target="_blank">S100 EP${q.epRef}</a></div>` : ''}
    `;

    await LearnEngine.recordAnswer(currentLevel, currentModule.id, q.id || `q${currentQuestionIdx}`, correct, idx);
  }

  async function reportCurrentQ() {
    const reason = prompt('這題哪裡有問題？（例：答案不對、題目不清、超出考試範圍）');
    if (!reason) return;
    const q = currentQuestions[currentQuestionIdx];
    const ok = await LearnEngine.reportQuestion(currentLevel, currentModule.id, q.id || `q${currentQuestionIdx}`, reason);
    alert(ok ? '已回報，感謝回饋！' : '回報失敗，請稍後再試');
  }

  function backToModules() {
    document.getElementById('module-view').style.display = 'none';
    document.getElementById('modules-view').style.display = 'block';
    currentModule = null;
    renderModules(); // 重刷進度
  }

  // ========== 框架問 / 爭議問互動 ==========
  function _toggleAnswer(answerId, btnId) {
    const answer = document.getElementById(answerId);
    const btn = document.getElementById(btnId);
    if (!answer || !btn) return;
    if (answer.style.display === 'none') {
      answer.style.display = 'block';
      btn.textContent = '收起解析';
      btn.classList.add('revealed');
    } else {
      answer.style.display = 'none';
      btn.textContent = '💡 看參考解析';
      btn.classList.remove('revealed');
    }
  }

  function _chooseSide(side) {
    const btnA = document.getElementById('sideABtn');
    const btnB = document.getElementById('sideBBtn');
    const reveal = document.getElementById('controversyReveal');
    if (!btnA || !btnB || !reveal) return;
    btnA.classList.toggle('chosen', side === 'A');
    btnB.classList.toggle('chosen', side === 'B');
    reveal.style.display = 'block';
  }

  // ========== Phase 4 Report + Phase 5 Reinforcement ==========

  function loadChartJs() {
    return new Promise(function(resolve) {
      if (window.Chart) return resolve();
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4';
      s.onload = resolve;
      document.head.appendChild(s);
    });
  }

  async function showReport(moduleId) {
    const data = LEARN_DATA[currentLevel];
    const mod = data.modules.find(m => m.id === moduleId);
    if (!mod || !mod.concepts) return;

    const result = LearnEngine.getWeakConcepts(currentLevel, moduleId);
    const weakIds = result.concepts;
    const scores = result.scores;

    const labels = mod.concepts.map(c => c.name);
    const values = mod.concepts.map(c => {
      const s = scores[c.id];
      return s && s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0;
    });

    document.getElementById('module-view').innerHTML =
      '<button class="back-btn" onclick="LearnUI.backToModules()">← 返回模組</button>' +
      '<div class="report-header"><h2>📊 ' + mod.name + ' — 學習報告</h2></div>' +
      '<div class="report-chart"><canvas id="conceptRadar"></canvas></div>' +
      '<div class="report-scores" id="reportScores"></div>' +
      '<div class="report-weak" id="reportWeak"></div>' +
      '<div class="report-actions" id="reportActions"></div>';

    loadChartJs().then(() => {
      new Chart(document.getElementById('conceptRadar'), {
        type: 'radar',
        data: {
          labels: labels,
          datasets: [{
            label: '正確率 %',
            data: values,
            backgroundColor: 'rgba(45,106,79,.2)',
            borderColor: '#2d6a4f',
            pointBackgroundColor: '#2d6a4f',
            borderWidth: 2
          }]
        },
        options: {
          responsive: true,
          scales: { r: { min: 0, max: 100, ticks: { stepSize: 25 } } },
          plugins: { legend: { display: false } }
        }
      });
    });

    const scoresHtml = mod.concepts.map(c => {
      const s = scores[c.id];
      const pct = s && s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0;
      const lv = pct >= 70 ? 'good' : pct >= 40 ? 'mid' : 'weak';
      const lvText = { good: '掌握良好', mid: '需複習', weak: '需加強' }[lv];
      return '<div class="score-row ' + lv + '">' +
        '<span class="score-name">' + c.name + '</span>' +
        '<span class="score-bar"><span class="score-fill" style="width:' + pct + '%"></span></span>' +
        '<span class="score-pct">' + pct + '%</span>' +
        '<span class="score-badge ' + lv + '">' + lvText + '</span>' +
        '</div>';
    }).join('');
    document.getElementById('reportScores').innerHTML = scoresHtml;

    if (weakIds.length === 0) {
      document.getElementById('reportWeak').innerHTML = '<div class="report-msg good">✅ 表現優秀！所有概念維度都掌握得不錯。</div>';
      document.getElementById('reportActions').innerHTML = '<button class="btn-primary" onclick="LearnUI.backToModules()">返回模組列表</button>';
    } else {
      const weakNames = weakIds.map(id => {
        const found = mod.concepts.find(c => c.id === id);
        return found ? found.name : '';
      }).filter(Boolean);
      document.getElementById('reportWeak').innerHTML =
        '<div class="report-msg weak">⚠️ 發現 ' + weakIds.length + ' 個需要加強的概念維度：<strong>' + weakNames.join('、') + '</strong></div>';
      document.getElementById('reportActions').innerHTML =
        '<button class="btn-primary btn-lg" onclick="LearnUI.startPhase5(\'' + moduleId + '\')">🎯 開始弱項加強練習 →</button>' +
        '<button class="btn-secondary" onclick="LearnUI.backToModules()" style="margin-top:8px;display:block;width:100%;text-align:center;">跳過，返回模組</button>';
    }
  }

  // ========== Phase 5 ==========

  let p5State = null;

  async function startPhase5(moduleId) {
    const data = LEARN_DATA[currentLevel];
    const mod = data.modules.find(m => m.id === moduleId);
    if (!mod) return;

    const result = LearnEngine.getWeakConcepts(currentLevel, moduleId);
    const weakIds = result.concepts;
    if (weakIds.length === 0) return;

    // 收集 reinforcement 題（只取弱項相關的）
    const reinforceQs = (mod.reinforcement || []).filter(q => {
      const cids = LearnEngine.getQuestionConcepts(q, mod.concepts);
      return cids.some(c => weakIds.indexOf(c) !== -1);
    });

    let allQs = reinforceQs.slice();

    // 如果不夠 5 題，用 AI 補
    if (allQs.length < 5 && typeof LearnLayer2 !== 'undefined' && LearnLayer2.generateReinforcement) {
      document.getElementById('module-view').innerHTML =
        '<div class="phase5-loading">' +
        '<h2>🎯 準備弱項加強題...</h2>' +
        '<p>AI 正在根據你的弱項生成針對性題目</p>' +
        '<div class="loading-spinner"></div>' +
        '</div>';
      try {
        const aiQs = await LearnLayer2.generateReinforcement(currentLevel, moduleId, weakIds);
        allQs = allQs.concat(aiQs);
      } catch(e) { console.error('AI reinforcement failed:', e); }
    }

    if (allQs.length === 0) {
      document.getElementById('module-view').innerHTML =
        '<button class="back-btn" onclick="LearnUI.backToModules()">← 返回</button>' +
        '<div class="report-msg">目前沒有加強題可用，請稍後再試。</div>';
      return;
    }

    p5State = { allQs, idx: 0, answers: {}, mod, moduleId, weakIds };
    renderP5Question();
  }

  function renderP5Question() {
    if (!p5State) return;
    if (p5State.idx >= p5State.allQs.length) {
      renderP5Summary();
      return;
    }
    const q = p5State.allQs[p5State.idx];
    const cids = LearnEngine.getQuestionConcepts(q, p5State.mod.concepts);
    let conceptName = '';
    if (cids.length > 0) {
      const found = p5State.mod.concepts.find(c => c.id === cids[0]);
      conceptName = found ? found.name : '';
    }

    document.getElementById('module-view').innerHTML =
      '<div class="phase5-header">' +
        '<span class="phase5-badge">🎯 弱項加強</span>' +
        '<span class="phase5-progress">' + (p5State.idx + 1) + ' / ' + p5State.allQs.length + '</span>' +
      '</div>' +
      (conceptName ? '<div class="phase5-concept">聚焦：' + conceptName + '</div>' : '') +
      '<div class="question-card">' +
        '<p class="q-text">' + q.q + '</p>' +
        '<div class="q-options" id="p5options">' +
          (q.options || []).map((opt, i) =>
            '<button class="q-option" data-idx="' + i + '" onclick="LearnUI._p5answer(' + i + ')">' +
              '<span class="opt-letter">' + String.fromCharCode(65 + i) + '</span>' +
              '<span class="opt-text">' + opt + '</span>' +
              '</button>'
          ).join('') +
        '</div>' +
        '<div id="p5feedback" class="q-feedback" style="display:none"></div>' +
      '</div>';
  }

  function _p5answer(idx) {
    if (!p5State) return;
    const q = p5State.allQs[p5State.idx];
    const correct = idx === q.correct;
    p5State.answers[q.id || p5State.idx] = { correct, chosen: idx };

    const buttons = document.querySelectorAll('#p5options .q-option');
    buttons.forEach((btn, i) => {
      btn.disabled = true;
      if (i === q.correct) btn.classList.add('correct');
      if (i === idx && !correct) btn.classList.add('wrong');
    });

    const fb = document.getElementById('p5feedback');
    fb.style.display = 'block';
    fb.className = 'q-feedback ' + (correct ? 'correct' : 'wrong');
    fb.innerHTML =
      '<div class="feedback-head">' + (correct ? '✅ 答對了！' : '❌ 再想想') + '</div>' +
      (q.explain ? '<div class="feedback-explain">' + q.explain + '</div>' : '') +
      '<button class="btn-primary" onclick="LearnUI._p5next()" style="margin-top:12px;">' +
        (p5State.idx < p5State.allQs.length - 1 ? '下一題 →' : '查看加強結果') +
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
    const keys = Object.keys(p5State.answers);
    const total = keys.length;
    let correct = 0;
    for (let i = 0; i < keys.length; i++) {
      if (p5State.answers[keys[i]].correct) correct++;
    }
    const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
    const msg = pct >= 70
      ? '✅ 加強效果良好！弱項已有明顯改善。'
      : pct >= 40
        ? '⚠️ 還有進步空間，建議回去複習 S100 相關章節。'
        : '❌ 這些概念仍需要加強，建議重新學習相關內容。';
    const mid = p5State.moduleId;

    document.getElementById('module-view').innerHTML =
      '<div class="phase5-summary">' +
        '<h2>🎯 弱項加強完成</h2>' +
        '<div class="summary-score">' +
          '<div class="score-big">' + correct + '/' + total + '</div>' +
          '<div class="score-label">答對</div>' +
        '</div>' +
        '<div class="summary-msg">' + msg + '</div>' +
        '<div class="summary-actions">' +
          '<button class="btn-primary" onclick="LearnUI.showReport(\'' + mid + '\')">📊 重看學習報告</button>' +
          '<button class="btn-secondary" onclick="LearnUI.backToModules()">返回模組列表</button>' +
        '</div>' +
      '</div>';

    p5State = null;
  }

  // ========== 初始化 ==========
  function init() {
    LearnEngine.getOrCreateOdID();
    renderLevelInfo();
    renderModules();
  }

  global.LearnUI = {
    init,
    openModule,
    showQuestion,
    selectOption,
    reportCurrentQ,
    backToModules,
    showReport,
    startPhase5,
    _toggleAnswer,
    _chooseSide,
    _p5answer,
    _p5next
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window);
