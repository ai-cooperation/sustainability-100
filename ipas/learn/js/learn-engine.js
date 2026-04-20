// ═══════════════════════════════════════════════════════
//  Three-Question Learning Engine v1.0
//  通用三問法學習引擎 — 領域無關，靠 content pack 驅動
// ═══════════════════════════════════════════════════════

(function(global){
'use strict';

// ─── Config (set by content pack) ───
let _config = {
  contentPack: null,     // content pack object
  apiProxy: '',          // e.g. 'https://api.cooperation.tw'
  firebase: null,        // firebase config object
  teacherEmail: '',
  onPhaseChange: null,   // callback(phase, state)
  containerEl: null,     // root DOM element
};

// ─── State ───
let state = {
  name: '', email: '', uid: null, moduleId: '',
  phase1: { ratings: {} },
  phase2: { choices: {} },
  phase3: { answers: {}, scores: {} },
  phase5: null,
  weakFws: [],
  currentQ: 0,
  startTime: null
};

// ─── Module accessor ───
function getModule(id) {
  if (!_config.contentPack) return null;
  return _config.contentPack.modules.find(m => m.id === id) || null;
}

function getAllModules() {
  return _config.contentPack ? _config.contentPack.modules : [];
}

function getLevels() {
  return _config.contentPack?.levels || [];
}

function getSubjects() {
  return _config.contentPack?.subjects || [];
}

// ─── Session persistence ───
const STORAGE_PREFIX = 'tqe_';

function getStorageKey() {
  const packId = _config.contentPack?.id || 'default';
  return STORAGE_PREFIX + packId + '_session';
}

function saveSession() {
  const data = {
    name: state.name, email: state.email || '',
    moduleId: state.moduleId,
    phase1: state.phase1, phase2: state.phase2,
    phase3: state.phase3, phase5: state.phase5,
    weakFws: state.weakFws, startTime: state.startTime,
    savedAt: Date.now()
  };
  localStorage.setItem(getStorageKey(), JSON.stringify(data));
}

function loadSession() {
  try {
    const raw = localStorage.getItem(getStorageKey());
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (Date.now() - (data.savedAt || 0) > 7 * 24 * 60 * 60 * 1000) return null;
    return data;
  } catch (e) { return null; }
}

function clearSession() {
  localStorage.removeItem(getStorageKey());
}

// ─── Firebase integration ───
let _fb = null; // firebase app reference
let _authUser = null;

function initFirebase(callback) {
  if (!_config.firebase || typeof firebase === 'undefined') {
    if (callback) callback(null);
    return;
  }
  try {
    _fb = firebase.initializeApp(_config.firebase);
    if (_config.firebase.authDomain) {
      // Handle redirect result (mobile login returns here after Google auth)
      firebase.auth().getRedirectResult().then(function(result) {
        if (result && result.user) {
          console.log('Redirect login success:', result.user.email);
        }
      }).catch(function(e) {
        console.warn('Redirect login error:', e.code, e.message);
        const statusEl = document.getElementById('tqeAuthStatus');
        if (statusEl && e.code) statusEl.textContent = 'Redirect 錯誤：' + e.code;
      });

      firebase.auth().onAuthStateChanged(function(user) {
        _authUser = user;
        if (user) {
          state.uid = user.uid;
          state.email = user.email;
          state.name = state.name || user.displayName || '';
        } else {
          _authUser = null;
          state.uid = null;
        }
        if (callback) callback(user);
      });
    } else {
      if (callback) callback(null);
    }
  } catch (e) {
    if (callback) callback(null);
  }
}

function isTeacher() {
  return _authUser && _authUser.email === _config.teacherEmail;
}

function isLoggedIn() {
  return !!_authUser;
}

function googleLogin() {
  if (typeof firebase === 'undefined') return;
  const provider = new firebase.auth.GoogleAuthProvider();
  const statusEl = document.getElementById('tqeAuthStatus');
  if (statusEl) statusEl.textContent = '登入中...';

  // MOBILE: 先嘗試 popup，失敗才 fallback 到 redirect
  firebase.auth().signInWithPopup(provider).then(function(result) {
    if (statusEl) statusEl.textContent = '';
  }).catch(function(e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/popup-closed-by-user' ||
        e.code === 'auth/cancelled-popup-request') {
      if (statusEl) statusEl.textContent = 'Popup 被擋，改用 redirect...';
      firebase.auth().signInWithRedirect(provider);
    } else {
      if (statusEl) statusEl.textContent = '登入失敗：' + e.code;
      console.error('Login failed:', e.code, e.message);
    }
  });
}

function googleLogout() {
  if (typeof firebase === 'undefined') return;
  firebase.auth().signOut();
  state.uid = null;
  state.email = '';
  clearSession();
}

// ─── Firebase data operations ───
function saveProgress(milestone) {
  try {
    if (typeof firebase === 'undefined') return;
    const odID = localStorage.getItem('_tqe_odid') || crypto.randomUUID();
    localStorage.setItem('_tqe_odid', odID);
    const packId = _config.contentPack?.id || 'default';

    const payload = {
      name: state.name,
      module: state.moduleId,
      milestone: milestone,
      phase1_ratings: state.phase1.ratings,
      phase2_choices: state.phase2.choices,
      phase3_answers: state.phase3.answers,
      phase3_scores: state.phase3.scores,
      ts: firebase.database.ServerValue.TIMESTAMP
    };
    if (state.phase5) {
      payload.phase5_answers = state.phase5.answers || {};
      payload.phase5_scores = state.phase5.scores || {};
      payload.weakFws = state.weakFws || [];
    }

    // Anonymous path
    firebase.database().ref(packId + '/' + odID).update(payload);

    // Authenticated user path
    if (state.uid) {
      const mod = state.moduleId;
      const module = getModule(mod);
      const questions = module?.questions || [];
      const correct = questions.filter(function(q) { return state.phase3.answers[q.id] === q.correct; }).length;
      const total = Object.keys(state.phase3.answers).length;
      const accuracy = total > 0 ? correct / total : null;

      const userPayload = {
        email: state.email,
        name: state.name,
        lastActive: firebase.database.ServerValue.TIMESTAMP
      };
      userPayload['modules/' + mod] = {
        milestone: milestone,
        accuracy: accuracy,
        correct: correct,
        total: total,
        weakFws: state.weakFws || [],
        ts: firebase.database.ServerValue.TIMESTAMP
      };
      firebase.database().ref(packId + '/users_auth/' + state.uid).update(userPayload);
    }
  } catch (e) { /* silent */ }
}

function saveBlindSpot(question, chosen, isCorrect) {
  try {
    if (typeof firebase === 'undefined') return;
    const packId = _config.contentPack?.id || 'default';

    // Per-question analytics
    const qRef = firebase.database().ref(packId + '/analytics/questions/' + state.moduleId + '/' + question.id);
    qRef.transaction(function(data) {
      if (!data) data = { attempts: 0, correct: 0, wrong_choices: {} };
      data.attempts = (data.attempts || 0) + 1;
      if (isCorrect) {
        data.correct = (data.correct || 0) + 1;
      } else {
        if (!data.wrong_choices) data.wrong_choices = {};
        data.wrong_choices[chosen] = (data.wrong_choices[chosen] || 0) + 1;
      }
      return data;
    });

    // Per-framework analytics
    if (!isCorrect && question.framework) {
      const fwRef = firebase.database().ref(packId + '/analytics/frameworks/' + state.moduleId + '/' + question.framework);
      fwRef.transaction(function(data) {
        if (!data) data = { total_wrong: 0, gaps: {} };
        data.total_wrong = (data.total_wrong || 0) + 1;
        const gap = question.diagnosis?.[chosen]?.gap || 'unknown';
        if (!data.gaps) data.gaps = {};
        data.gaps[gap] = (data.gaps[gap] || 0) + 1;
        return data;
      });
    }

    // Per-user answer log
    if (state.uid) {
      firebase.database().ref(packId + '/users_auth/' + state.uid + '/answers/' + state.moduleId + '/' + question.id).set({
        chosen: chosen,
        correct: isCorrect,
        ts: firebase.database.ServerValue.TIMESTAMP
      });
    }
  } catch (e) { /* silent */ }
}

// ─── Exam result persistence (logged-in users) ───
function saveExamResult(examData) {
  try {
    if (typeof firebase === 'undefined') return;
    const packId = _config.contentPack?.id || 'default';
    const ts = Date.now();

    // Logged-in: full exam detail under user profile
    if (state.uid) {
      firebase.database().ref(packId + '/users_auth/' + state.uid + '/exams/' + ts).set({
        subject: examData.subject || '',
        subjectId: examData.subjectId || '',
        score: examData.score,
        correct: examData.correct,
        total: examData.total,
        elapsed: examData.elapsed,
        passed: examData.passed,
        weakFrameworks: examData.weakFrameworks || [],
        answers: examData.answers || {},
        wrongCount: (examData.wrongAnswers || []).length,
        ts: firebase.database.ServerValue.TIMESTAMP
      });

      // Update user-level exam summary
      firebase.database().ref(packId + '/users_auth/' + state.uid + '/examSummary').transaction(function(data) {
        if (!data) data = { totalExams: 0, bestScore: 0, avgScore: 0, _totalScore: 0 };
        data.totalExams = (data.totalExams || 0) + 1;
        data._totalScore = (data._totalScore || 0) + examData.score;
        data.avgScore = Math.round(data._totalScore / data.totalExams);
        if (examData.score > (data.bestScore || 0)) data.bestScore = examData.score;
        data.lastExam = examData.subject;
        data.lastDate = new Date().toISOString().slice(0, 10);
        return data;
      });
    }

    // Anonymous aggregate: exam-level analytics (all users)
    firebase.database().ref(packId + '/analytics/exams/' + (examData.subjectId || 'unknown')).transaction(function(data) {
      if (!data) data = { totalAttempts: 0, totalScore: 0, passCount: 0 };
      data.totalAttempts = (data.totalAttempts || 0) + 1;
      data.totalScore = (data.totalScore || 0) + examData.score;
      if (examData.passed) data.passCount = (data.passCount || 0) + 1;
      data.avgScore = Math.round(data.totalScore / data.totalAttempts);
      data.passRate = Math.round(data.passCount / data.totalAttempts * 100);
      return data;
    });
  } catch (e) { /* silent */ }
}

// ─── Question Report ───
function reportQuestion(moduleId, questionId, reason) {
  try {
    if (typeof firebase === 'undefined') return;
    const packId = _config.contentPack?.id || 'default';
    const odID = localStorage.getItem('_tqe_odid') || 'unknown';
    firebase.database().ref(packId + '/analytics/reports').push({
      moduleId: moduleId,
      qId: questionId,
      reason: reason,
      by: state.uid || odID,
      ts: firebase.database.ServerValue.TIMESTAMP
    });
  } catch (e) { /* silent */ }
}

// ─── AI API calls ───
async function callGroq(prompt, maxTokens) {
  const models = ['meta-llama/llama-4-scout-17b-16e-instruct', 'qwen/qwen3-32b'];
  for (const model of models) {
    try {
      const res = await fetch(_config.apiProxy + '/api/groq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens || 4096, temperature: 0.7 })
      });
      if (res.status === 429) continue;
      if (!res.ok) continue;
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '';
    } catch (e) { continue; }
  }
  return callGemini(prompt);
}

// Track which AI model was used for the last call
let _lastAIModel = '';
function getLastAIModel() { return _lastAIModel; }

async function callGemini(prompt) {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 8192 }
  });

  // Primary: GemGate ACP (Gemini 3 Flash, best quality for follow-up)
  try {
    const res = await fetch(_config.apiProxy + '/api/gemgate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body
    });
    if (res.ok) {
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (text) {
        _lastAIModel = data.modelVersion || 'GemGate';
        return text;
      }
    }
  } catch (e) { /* fall through */ }

  // Fallback: Workers AI (Cloudflare internal, fast + stable)
  try {
    const res = await fetch(_config.apiProxy + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body
    });
    if (res.ok) {
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (text) {
        _lastAIModel = data.modelVersion || 'Workers AI';
        return text;
      }
    }
  } catch (e) { /* fall through */ }

  _lastAIModel = '';
  return '';
}

// ─── AI question generation ───
function buildQuestionPrompt(module, targetFws, level, count) {
  const pack = _config.contentPack;
  const examInfo = pack?.examInfo || {};
  const qs = pack?.questionStyle || {};
  const optMin = (qs.optionLength || [38, 45])[0];
  const optMax = (qs.optionLength || [38, 45])[1];
  const diffMax = qs.diffMax || 5;
  const stemMin = qs.stemMin || 60;

  const fwInfo = targetFws.map(function(fid) {
    const fw = module.frameworks.find(function(f) { return f.id === fid; });
    return term('framework') + '「' + (fw?.name || fid) + '」：' + (fw?.desc || '');
  }).join('\n');

  const levelDesc = [
    '單一概念情境題，測試基本理解。',
    '雙概念混合題，同時涉及兩個' + term('framework') + '。',
    '企業實務情境題，跨領域混合。選項要「每個都看起來合理」。',
    '陷阱題，選項差異微妙。可用「下列何者錯誤」格式。'
  ][(level || 1) - 1];

  // Randomize answer distribution
  const base = ['A','B','C','D','A','B','C','D','A','B'];
  for (let i = base.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = base[i]; base[i] = base[j]; base[j] = tmp;
  }
  const answerSeq = base.slice(0, count);

  const trends = (examInfo.trends || []).map(function(t) { return '- ' + t; }).join('\n');

  return '你是' + (examInfo.name || '認證考試') + '的專業出題委員。嚴格遵守以下每一條規則，違反任何一條都不合格。\n\n' +
    '【出題範圍】\n' + fwInfo + '\n\n' +
    '【難度】Level ' + level + ' — ' + levelDesc + '\n\n' +
    (trends ? '【考試趨勢】\n' + trends + '\n\n' : '') +
    '【硬性規則 — 必須全部遵守】\n' +
    '1. 題幹：以「某企業/某公司/某工廠」開頭，描述具體實務情境，至少 ' + stemMin + ' 字。\n' +
    '2. 四個選項：每個 ' + optMin + '-' + optMax + ' 字（嚴格），格式「具體做法或判斷，因為＋專業理由」。\n' +
    '3. 四選項的字數差距 ≤ ' + diffMax + ' 字（最長減最短 ≤ ' + diffMax + '）。違反此條最嚴重。\n' +
    '4. 正確答案絕對不可以是四個選項中最長的那個。\n' +
    '5. 答案分布：' + count + ' 題正確答案嚴格依序為 ' + answerSeq.join(',') + '，不可更改。\n' +
    '6. diagnosis：每題必須有恰好 3 個 diagnosis（對應 3 個錯誤選項），每個包含 gap（30-50字）和 followup（40-80字，提到題目具體概念）。\n' +
    '7. 錯誤選項必須是常見誤解，看起來有道理但有一個關鍵錯誤。\n\n' +
    '生成 ' + count + ' 題繁體中文。\n\n' +
    '【範例（注意選項字數均為 40±3 字）】\n[{"stem":"某鋼鐵廠在進行年度碳盤查時，發現廠區內燃煤鍋爐的排放量佔總排放的 60%。盤查團隊需判斷該排放源的分類。下列關於 ISO 14064-1 排放類別的敘述，何者正確？","options":[{"key":"A","text":"該燃煤鍋爐屬於類別二間接排放，因為煤炭是外購能源所以應歸類為輸入能源間接排放"},{"key":"B","text":"該燃煤鍋爐屬於類別一直接排放，因為燃燒過程發生在組織邊界內且由組織直接控制操作"},{"key":"C","text":"該排放應歸入類別三運輸排放，因為煤炭需要透過外部運輸才能送達工廠進行使用燃燒"},{"key":"D","text":"該排放不需納入盤查範圍計算，因為燃煤屬於傳統能源使用而非溫室氣體的主要排放來源"}],"correct":"B","explanation":"自廠燃燒化石燃料屬於類別一直接排放。","diagnosis":{"A":{"gap":"混淆直接燃燒與外購能源的分類邏輯","followup":"煤炭雖然是外購的，但燃燒發生在廠區內——判斷排放類別時，看的是燃燒地點還是燃料來源？"},"C":{"gap":"將燃料運輸與燃料使用的排放混為一談","followup":"煤炭的運輸排放確實存在，但那是運輸公司的排放——鋼鐵廠自己燒煤產生的 CO₂ 該怎麼歸類？"},"D":{"gap":"誤以為傳統能源不屬於溫室氣體盤查範圍","followup":"燃煤產生的 CO₂ 是全球最大的人為排放源之一——為什麼會認為它不需要納入盤查？"}}}]\n\n' +
    '回傳純 JSON（直接以 [ 開頭），英文 key：stem, options([{key,text}]), correct, explanation, diagnosis({key:{gap,followup}})。嚴禁中文 key。';
}

function parseAIQuestions(text) {
  if (!text || text.trim().length < 10) return [];
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  var jsonStr = jsonMatch[0];

  // Try parse directly first
  var qs = _tryParseArray(jsonStr);

  // If failed, try fixing truncated JSON: find last complete object and close the array
  if (!qs) {
    var lastBrace = jsonStr.lastIndexOf('}');
    if (lastBrace > 0) {
      var truncated = jsonStr.substring(0, lastBrace + 1);
      // Remove trailing comma if any
      truncated = truncated.replace(/,\s*$/, '');
      // Find matching depth
      if (!truncated.endsWith(']')) truncated += ']';
      qs = _tryParseArray(truncated);
    }
  }

  if (!qs) return [];

  // Normalize: support both English and Chinese keys
  return qs.map(function(q) {
    var stem = q.stem || q['題目'] || q['題幹'] || '';
    var correct = q.correct || q['答案'] || q['正確答案'] || '';
    var explanation = q.explanation || q['解析'] || q['說明'] || '';
    var options = q.options;
    if (!Array.isArray(options)) {
      var rawOpts = options || q['選項'] || {};
      options = [];
      ['A','B','C','D'].forEach(function(k) {
        if (rawOpts[k]) options.push({ key: k, text: rawOpts[k], depth: k === correct ? 4 : 2 });
      });
    }
    if (!stem || options.length === 0 || !correct) return null;
    return { stem: stem, options: options, correct: correct, explanation: explanation, diagnosis: q.diagnosis || {} };
  }).filter(Boolean);
}

function _tryParseArray(str) {
  try {
    var arr = JSON.parse(str);
    return Array.isArray(arr) ? arr : null;
  } catch (e) { return null; }
}

function postProcessQuestions(questions) {
  const pack = _config.contentPack;
  const qs = pack?.questionStyle || {};
  const optMin = (qs.optionLength || [38, 45])[0];
  const optMax = (qs.optionLength || [38, 45])[1];
  const diffMax = qs.diffMax || 5;

  questions.forEach(function(q) {
    if (!q.options || q.options.length < 4) return;

    // 1. Fix correct=longest: swap text so correct is NOT the single longest
    var lens = q.options.map(function(o) { return { key: o.key, len: o.text.length }; });
    var longest = lens.reduce(function(a, b) { return a.len > b.len ? a : b; });
    if (longest.key === q.correct) {
      var wrongs = q.options.filter(function(o) { return o.key !== q.correct; });
      var swap = wrongs[Math.floor(Math.random() * wrongs.length)];
      var correctOpt = q.options.find(function(o) { return o.key === q.correct; });
      // Swap text, depth, and update diagnosis keys
      var tmpText = correctOpt.text;
      var tmpDepth = correctOpt.depth;
      correctOpt.text = swap.text;
      correctOpt.depth = swap.depth;
      swap.text = tmpText;
      swap.depth = tmpDepth;
      // Move diagnosis: old correct key becomes wrong (needs diagnosis), old swap key becomes correct (remove diagnosis)
      var newDiag = {};
      var oldDiag = q.diagnosis || {};
      ['A','B','C','D'].forEach(function(k) {
        if (k === swap.key) return; // new correct, skip
        if (k === q.correct && oldDiag[swap.key]) { newDiag[k] = oldDiag[swap.key]; }
        else if (oldDiag[k]) { newDiag[k] = oldDiag[k]; }
        else { newDiag[k] = { gap: q.explanation || '概念混淆', followup: '請重新思考這個選項與正確答案的差異。' }; }
      });
      q.diagnosis = newDiag;
      q.correct = swap.key;
    }

    // 2. Ensure diagnosis has exactly 3 entries (one per wrong option)
    if (!q.diagnosis || typeof q.diagnosis !== 'object') q.diagnosis = {};
    ['A','B','C','D'].forEach(function(k) {
      if (k === q.correct) {
        delete q.diagnosis[k]; // correct answer should not have diagnosis
        return;
      }
      if (!q.diagnosis[k] || !q.diagnosis[k].gap) {
        var wrongOpt = q.options.find(function(o) { return o.key === k; });
        var correctOpt = q.options.find(function(o) { return o.key === q.correct; });
        q.diagnosis[k] = {
          gap: '混淆了「' + (wrongOpt ? wrongOpt.text.substring(0, 20) : k) + '」與正確概念的差異',
          followup: '你選的「' + (wrongOpt ? wrongOpt.text.substring(0, 25) : '') + '」，但正確答案是「' + (correctOpt ? correctOpt.text.substring(0, 25) : '') + '」。關鍵差異在哪？'
        };
      }
    });

    // 3. Set depth: correct=4, plausible wrongs=2, obvious wrong=1
    q.options.forEach(function(o) {
      if (!o.depth) o.depth = (o.key === q.correct) ? 4 : 2;
    });
  });
  return questions;
}

// ─── Terminology ───
function term(key) {
  var t = _config.contentPack?.terminology || {};
  var defaults = { framework: '心智模型', exam: '模擬考' };
  return t[key] || defaults[key] || key;
}

// ─── Utility ───
function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

function getLectureLinks(moduleId, frameworkId) {
  var module = getModule(moduleId);
  if (!module) return '';
  var fw = module.frameworks.find(function(f) { return f.id === frameworkId; });
  if (!fw || !fw.lectures || fw.lectures.length === 0) return '';
  var baseUrl = module.lectureBaseUrl || '/lectures/';
  return fw.lectures.map(function(l) {
    return '<a href="' + baseUrl + l.id.toLowerCase() + '/" target="_blank" ' +
      'style="display:inline-block;margin:.2rem .3rem .2rem 0;padding:.2rem .6rem;background:var(--white);' +
      'border:1px solid var(--blue);border-radius:6px;font-size:.85rem;color:var(--blue);text-decoration:none;">' +
      escHtml(l.title) + ' →</a>';
  }).join('');
}

// ─── Public API ───
global.ThreeQuestionEngine = {
  // Init
  init: function(config) {
    _config = Object.assign(_config, config);
    // Apply theme colors if provided
    var theme = _config.contentPack?.theme;
    if (theme) {
      var root = document.documentElement;
      if (theme.primary) root.style.setProperty('--blue', theme.primary);
      if (theme.primaryLt) root.style.setProperty('--blue-lt', theme.primaryLt);
      if (theme.navy) root.style.setProperty('--navy', theme.navy);
      if (theme.green) root.style.setProperty('--green', theme.green);
      if (theme.gold) root.style.setProperty('--gold', theme.gold);
      if (theme.red) root.style.setProperty('--red', theme.red);
      if (theme.purple) root.style.setProperty('--purple', theme.purple);
    }
    return this;
  },

  // State
  state: state,
  getModule: getModule,
  getAllModules: getAllModules,
  getLevels: getLevels,
  getSubjects: getSubjects,
  getConfig: function() { return _config; },

  // Session
  saveSession: saveSession,
  loadSession: loadSession,
  clearSession: clearSession,

  // Auth
  initFirebase: initFirebase,
  isTeacher: isTeacher,
  isLoggedIn: isLoggedIn,
  googleLogin: googleLogin,
  googleLogout: googleLogout,
  getAuthUser: function() { return _authUser; },

  // Data
  saveProgress: saveProgress,
  saveBlindSpot: saveBlindSpot,
  saveExamResult: saveExamResult,
  reportQuestion: reportQuestion,

  // AI
  callGroq: callGroq,
  callGemini: callGemini,
  getLastAIModel: getLastAIModel,
  buildQuestionPrompt: buildQuestionPrompt,
  parseAIQuestions: parseAIQuestions,
  postProcessQuestions: postProcessQuestions,

  // Terminology
  term: term,

  // Utility
  escHtml: escHtml,
  getLectureLinks: getLectureLinks
};

})(typeof window !== 'undefined' ? window : global);
