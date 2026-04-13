// iPAS Layer 2 — AI 動態組卷 + 50 題模擬考
// 複用 AI100 的 Cloudflare Worker proxy（api.cooperation.tw）

(function(global) {
  'use strict';

  const API_PROXY = 'https://api.cooperation.tw';
  const DB_URL = LearnEngine.DB_URL;

  // ========== Groq AI 出題 ==========
  async function callGroq(prompt, maxTokens) {
    const models = ['meta-llama/llama-4-scout-17b-16e-instruct', 'qwen/qwen3-32b'];
    for (const model of models) {
      try {
        const res = await fetch(`${API_PROXY}/api/groq`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: maxTokens || 4096,
            temperature: 0.7
          })
        });
        if (res.status === 429) continue;
        if (!res.ok) continue;
        const data = await res.json();
        return data.choices?.[0]?.message?.content || '';
      } catch (e) { continue; }
    }
    // Fallback to Gemini
    try {
      const res = await fetch(`${API_PROXY}/api/gemini`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, maxOutputTokens: maxTokens || 4096 })
      });
      const data = await res.json();
      return data.text || '';
    } catch (e) { return ''; }
  }

  // ========== 動態生題（根據模組 scope） ==========
  async function generateQuestions(level, moduleId, count) {
    const mod = LEARN_DATA[level]?.modules?.find(m => m.id === moduleId);
    if (!mod) return [];

    const levelName = level === 'l1' ? '初級' : '中級';
    const typeHint = level === 'l1'
      ? '單選題為主，重點在名詞記憶與流程理解'
      : '情境判斷題 + 計算題為主，重點在活用與判斷';

    const examStyleHint = level === 'l2'
      ? `

【必遵守：2026/04/11 首場中級考試實戰風格】
- 題幹變短（60-120 字），不要冗長敘事
- 優先出「跨章節混合題」（例：法規 × 技術 × 管理同時考）
- 主要陷阱型態：「半對半錯」— 選項前半句正確、後半句錯誤（或反之）
- 考「實務適用性」而非「原理知識」（例：不問變頻節能的原理，問何種場景該用）
- 混入具體法條、具體數字（台灣碳費 $300/噸、SBTi 鋼鐵/水泥減率、10%/5% 抵換、25000 tCO₂e 門檻）
- 歸屬題：Scope 1/2/3 判斷常設陷阱（租賃、合資、差旅）
- 計算題：NPV 投資決策、碳費扣減、SBTi 年減率
- 避免純背誦：「下列何者屬於...」這種單點記憶題請少用`
      : '';

    const prompt = `你是 iPAS 淨零碳規劃管理師${levelName}考試出題專家。

模組：${mod.id} ${mod.name}
所屬考科：${mod.subject}
涵蓋：${mod.scope}
${mod.examTips ? '實考重點：' + mod.examTips : ''}

題型要求：${typeHint}
要求：${count} 題選擇題（4 選 1），結合 2026 最新考試趨勢（碳費開徵、CBAM、ISO 14068-1）。
${examStyleHint}

【選項撰寫規則】
1. 每個選項 30-60 字，四個選項字數接近
2. 錯誤選項要有說服力的誤解理由，不能一看就錯
3. 設計「半對半錯」陷阱選項 — 前半句對、後半句錯（或反之）
4. 情境題優先（企業實務場景），純背誦題不得超過 1 題
5. 計算題要給具體數字

回傳純 JSON 陣列（無 markdown code block）：
[{"stem":"題幹","options":["A選項","B選項","C選項","D選項"],"correct":0,"explanation":"30-80字解析，點出陷阱在哪"}]

correct 是正解的 index（0-3）。`;

    try {
      const text = await callGroq(prompt, 8192);
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const questions = JSON.parse(cleaned);
      return questions.map((q, i) => ({
        id: `AI-${moduleId}-${Date.now()}-${i}`,
        type: q.stem.includes('計算') || q.stem.match(/\d{3,}/) ? '情境/計算' : '單選',
        q: q.stem,
        options: q.options,
        correct: q.correct,
        explain: q.explanation,
        source: 'ai_generated',
        ts: Date.now()
      }));
    } catch (e) {
      console.error('generateQuestions failed:', e);
      return [];
    }
  }

  // ========== 寫入 Firebase cache 飛輪 ==========
  async function cacheQuestions(level, moduleId, questions) {
    for (const q of questions) {
      if (!q.id || !q.q) continue;
      await LearnEngine.fbPut(`learn/question_pool/${level}/${moduleId}/${q.id}`, q);
    }
  }

  // ========== 模擬考狀態 ==========
  const exam = {
    level: null,
    moduleIds: [],
    questions: [],
    answers: {},
    currentIdx: 0,
    startTime: 0,
    timeLimit: 0,
    timerInterval: null,
    active: false
  };

  // ========== 開始模擬考 ==========
  async function startExam(level) {
    const data = LEARN_DATA[level];
    if (!data) return;

    exam.level = level;
    exam.moduleIds = data.modules.map(m => m.id);
    exam.questions = [];
    exam.answers = {};
    exam.currentIdx = 0;
    exam.startTime = Date.now();
    exam.timeLimit = level === 'l1' ? 75 * 60 * 1000 : 90 * 60 * 1000;
    exam.active = true;

    document.getElementById('modules-view').style.display = 'none';
    document.getElementById('module-view').style.display = 'none';
    document.getElementById('exam-view').style.display = 'block';
    renderExamLoading();

    await assembleExam(level);
    if (exam.questions.length === 0) {
      alert('組卷失敗，請稍後重試');
      exitExam();
      return;
    }

    exam.timerInterval = setInterval(updateTimer, 1000);
    renderExamQuestion();
  }

  // ========== 組卷：靜態題庫 + AI 生成 + cache 補充 ==========
  async function assembleExam(level) {
    const data = LEARN_DATA[level];
    // 1. 從所有模組靜態題庫抽 25 題
    const allStatic = [];
    for (const mod of data.modules) {
      [...(mod.questions || []), ...(mod.reinforcement || [])].forEach(q => {
        allStatic.push({ ...q, fromModule: mod.id });
      });
    }
    shuffle(allStatic);
    const fromStatic = allStatic.slice(0, Math.min(25, allStatic.length));
    exam.questions = [...fromStatic];
    updateLoadProgress(`已載入靜態題庫 ${fromStatic.length} 題，AI 生成中...`);

    // 2. AI 生成補到 50 題（每模組平均分配）
    const needed = 50 - exam.questions.length;
    if (needed > 0) {
      const perModule = Math.ceil(needed / data.modules.length);
      for (const mod of data.modules) {
        if (exam.questions.length >= 50) break;
        const remain = 50 - exam.questions.length;
        const count = Math.min(perModule, remain);
        if (count <= 0) continue;
        const aiQs = await generateQuestions(level, mod.id, count);
        aiQs.forEach(q => q.fromModule = mod.id);
        exam.questions.push(...aiQs);
        // 飛輪：寫入 cache
        cacheQuestions(level, mod.id, aiQs);
        updateLoadProgress(`組卷中 ${exam.questions.length}/50 題...`);
      }
    }

    // 3. 若還不夠 50，從 cache 補
    if (exam.questions.length < 50) {
      for (const mod of data.modules) {
        if (exam.questions.length >= 50) break;
        const cached = await LearnEngine.fbGet(`learn/question_pool/${level}/${mod.id}`);
        if (cached) {
          const pool = Object.values(cached);
          shuffle(pool);
          exam.questions.push(...pool.slice(0, 50 - exam.questions.length));
        }
      }
    }

    // 全部打散
    shuffle(exam.questions);
    updateLoadProgress(`組卷完成：${exam.questions.length} 題`);
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  // ========== 渲染 ==========
  function renderExamLoading() {
    document.getElementById('exam-view').innerHTML = `
      <div class="exam-loading">
        <h2>📝 ${LEARN_DATA[exam.level].nameFull} 模擬考</h2>
        <p id="exam-load-progress">準備組卷中...</p>
        <div class="loading-spinner"></div>
      </div>
    `;
  }

  function updateLoadProgress(text) {
    const el = document.getElementById('exam-load-progress');
    if (el) el.textContent = text;
  }

  function renderExamQuestion() {
    if (exam.currentIdx >= exam.questions.length) {
      finishExam();
      return;
    }
    const q = exam.questions[exam.currentIdx];
    const total = exam.questions.length;
    const ans = exam.answers[exam.currentIdx];

    document.getElementById('exam-view').innerHTML = `
      <div class="exam-header">
        <span class="exam-title">📝 ${LEARN_DATA[exam.level].name} 模擬考</span>
        <span class="exam-timer" id="exam-timer">${fmtTime(exam.timeLimit)}</span>
        <button class="exam-quit" onclick="LearnLayer2.confirmExit()">離開</button>
      </div>
      <div class="exam-progress">
        <span>第 ${exam.currentIdx + 1} / ${total} 題 · 已答 ${Object.keys(exam.answers).length}</span>
        <div class="exam-progress-bar">
          <div class="exam-progress-fill" style="width:${((exam.currentIdx+1)/total)*100}%"></div>
        </div>
      </div>
      <div class="exam-question">
        <span class="exam-q-meta">${q.fromModule || ''} · ${q.type || '單選'}</span>
        <p class="exam-q-text">${q.q}</p>
        <div class="exam-options">
          ${q.options.map((opt, i) => `
            <button class="exam-option ${ans === i ? 'selected' : ''}" onclick="LearnLayer2.answerExam(${i})">
              <span class="opt-letter">${String.fromCharCode(65+i)}</span>
              <span>${opt}</span>
            </button>
          `).join('')}
        </div>
      </div>
      <div class="exam-nav">
        <button onclick="LearnLayer2.prevQuestion()" ${exam.currentIdx === 0 ? 'disabled' : ''}>← 上一題</button>
        <button onclick="LearnLayer2.nextQuestion()" class="exam-nav-primary">
          ${exam.currentIdx === total - 1 ? '交卷' : '下一題 →'}
        </button>
      </div>
      <div class="exam-grid">
        ${exam.questions.map((_, i) => {
          const a = exam.answers[i];
          const cur = i === exam.currentIdx;
          return `<button class="exam-cell ${a !== undefined ? 'answered' : ''} ${cur ? 'current' : ''}" onclick="LearnLayer2.jumpTo(${i})">${i+1}</button>`;
        }).join('')}
      </div>
    `;
  }

  function answerExam(idx) {
    exam.answers[exam.currentIdx] = idx;
    renderExamQuestion();
  }

  function nextQuestion() {
    if (exam.currentIdx < exam.questions.length - 1) {
      exam.currentIdx++;
      renderExamQuestion();
    } else {
      finishExam();
    }
  }

  function prevQuestion() {
    if (exam.currentIdx > 0) {
      exam.currentIdx--;
      renderExamQuestion();
    }
  }

  function jumpTo(idx) {
    exam.currentIdx = idx;
    renderExamQuestion();
  }

  function fmtTime(ms) {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function updateTimer() {
    const elapsed = Date.now() - exam.startTime;
    const remain = Math.max(0, exam.timeLimit - elapsed);
    const el = document.getElementById('exam-timer');
    if (el) {
      el.textContent = fmtTime(remain);
      el.className = 'exam-timer' + (remain < 5 * 60 * 1000 ? ' warning' : '');
    }
    if (remain <= 0) {
      clearInterval(exam.timerInterval);
      finishExam();
    }
  }

  function finishExam() {
    clearInterval(exam.timerInterval);
    exam.active = false;
    const total = exam.questions.length;
    let correct = 0;
    const detail = [];
    exam.questions.forEach((q, i) => {
      const ans = exam.answers[i];
      const isCorrect = ans === q.correct;
      if (isCorrect) correct++;
      detail.push({ idx: i, q, ans, isCorrect });
    });
    const score = Math.round((correct / total) * 100);
    const passed = score >= 70;
    const elapsed = Date.now() - exam.startTime;

    document.getElementById('exam-view').innerHTML = `
      <div class="exam-result">
        <h2>${passed ? '🎉' : '💪'} 模擬考結果</h2>
        <div class="result-score ${passed ? 'passed' : 'failed'}">
          <div class="score-num">${score}</div>
          <div class="score-label">${passed ? '通過（70 分及格）' : '未通過（70 分及格）'}</div>
        </div>
        <div class="result-stats">
          <div><b>答對</b> ${correct} / ${total}</div>
          <div><b>用時</b> ${fmtTime(elapsed)}</div>
          <div><b>題目來源</b> 靜態 ${exam.questions.filter(q=>!q.source).length} · AI ${exam.questions.filter(q=>q.source==='ai_generated').length}</div>
        </div>
        <div class="result-actions">
          <button class="btn-review" onclick="LearnLayer2.reviewExam()">📋 檢討錯題</button>
          <button class="btn-retry" onclick="LearnLayer2.exitExam()">返回模組</button>
        </div>
        <div id="exam-review" style="display:none"></div>
      </div>
    `;

    // 寫入 Firebase 分析
    LearnEngine.fbPut(
      `learn/analytics/exams/${LearnEngine.getOrCreateOdID()}_${Date.now()}`,
      {
        level: exam.level, score, correct, total,
        elapsed, ts: Date.now()
      }
    );
  }

  function reviewExam() {
    const el = document.getElementById('exam-review');
    if (!el) return;
    const wrong = exam.questions.map((q, i) => ({ q, i, ans: exam.answers[i] }))
      .filter(x => x.ans !== x.q.correct);
    if (wrong.length === 0) {
      el.innerHTML = '<p style="text-align:center;padding:20px;color:var(--green)">🎯 全對！沒有錯題需要檢討</p>';
    } else {
      el.innerHTML = `<h3>錯題檢討（${wrong.length} 題）</h3>` + wrong.map(({ q, i, ans }) => `
        <div class="review-item">
          <div class="review-head">第 ${i + 1} 題</div>
          <p>${q.q}</p>
          <ul>
            ${q.options.map((opt, idx) => `
              <li class="${idx === q.correct ? 'correct' : ''} ${idx === ans ? 'chosen' : ''}">
                ${String.fromCharCode(65 + idx)}. ${opt}
                ${idx === q.correct ? ' ✅ 正解' : ''}
                ${idx === ans ? ' ← 你選' : ''}
              </li>
            `).join('')}
          </ul>
          ${q.explain ? `<div class="review-explain">💡 ${q.explain}</div>` : ''}
        </div>
      `).join('');
    }
    el.style.display = 'block';
  }

  function confirmExit() {
    if (Object.keys(exam.answers).length > 0) {
      if (!confirm('尚有未提交答案，確定離開？')) return;
    }
    exitExam();
  }

  function exitExam() {
    clearInterval(exam.timerInterval);
    exam.active = false;
    document.getElementById('exam-view').style.display = 'none';
    document.getElementById('modules-view').style.display = 'block';
  }

  global.LearnLayer2 = {
    startExam,
    answerExam,
    nextQuestion,
    prevQuestion,
    jumpTo,
    confirmExit,
    exitExam,
    reviewExam
  };

})(window);
