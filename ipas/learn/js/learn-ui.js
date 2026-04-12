// iPAS 三問法學習系統 — UI 控制
// 負責：tab 切換、模組卡片渲染、答題介面、進度顯示

(function(global) {
  'use strict';

  let currentLevel = 'l2'; // 預設中級（學員主要需求）
  let currentModule = null;
  let currentQuestionIdx = 0;
  let currentQuestions = [];

  // ========== Tab 切換 ==========
  function switchLevel(level) {
    currentLevel = level;
    document.querySelectorAll('.level-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.level === level);
    });
    renderLevelInfo();
    renderModules();
  }

  // ========== 等級資訊 ==========
  function renderLevelInfo() {
    const data = LEARN_DATA[currentLevel];
    const info = document.getElementById('level-info');
    if (!info || !data) return;
    info.innerHTML = `
      <h2>${data.nameFull}</h2>
      <p class="exam-format">📝 ${data.examFormat}</p>
      <p class="focus">🎯 ${data.focus}</p>
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
      </div>

      <section class="three-question-section">
        <div class="q-block framework">
          <h3>🧭 框架問</h3>
          <p>${mod.frameworkQuestion}</p>
        </div>
        <div class="q-block controversy">
          <h3>⚡ 爭議問</h3>
          <p>${mod.controversy}</p>
        </div>
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

  // ========== 初始化 ==========
  function init() {
    LearnEngine.getOrCreateOdID();
    renderLevelInfo();
    renderModules();
    document.querySelectorAll('.level-tab').forEach(tab => {
      tab.addEventListener('click', () => switchLevel(tab.dataset.level));
    });
  }

  global.LearnUI = {
    init,
    switchLevel,
    openModule,
    showQuestion,
    selectOption,
    reportCurrentQ,
    backToModules
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window);
