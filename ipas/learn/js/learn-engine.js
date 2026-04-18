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
  if (/iPhone|iPad|Android/i.test(navigator.userAgent)) {
    firebase.auth().signInWithRedirect(provider);
  } else {
    firebase.auth().signInWithPopup(provider).catch(function(e) {
      console.error('Login failed:', e.message);
    });
  }
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

async function callGemini(prompt) {
  try {
    const res = await fetch(_config.apiProxy + '/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 8192 }
      })
    });
    if (!res.ok) {
      if (res.status === 429) return '[RATE_LIMIT]';
      return '';
    }
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch (e) { return ''; }
}

// ─── AI question generation ───
function buildQuestionPrompt(module, targetFws, level, count) {
  const pack = _config.contentPack;
  const examInfo = pack?.examInfo || {};

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

  return '你是' + (examInfo.name || '認證考試') + '的專業出題委員。嚴格遵守以下規則。\n\n' +
    '【學生弱項】\n' + fwInfo + '\n\n' +
    '【難度】Level ' + level + ' — ' + levelDesc + '\n\n' +
    (trends ? '【考試趨勢】\n' + trends + '\n\n' : '') +
    '【硬性規則】\n' +
    '1. 題幹：必須以「某企業/某公司/某團隊」開頭的實務情境，題幹至少 60 字。禁止「下列何者正確」無情境題。\n' +
    '2. 選項：每個 35-50 字，格式「做法，因為/因此＋理由」。四選項字數差距 ≤ 5 字。\n' +
    '3. 錯誤選項的理由要有說服力，不能一看就錯。正確選項不可是最長的。\n' +
    '4. 答案分布：' + count + ' 題正確答案依序為 ' + answerSeq.join(',') + '。\n\n' +
    '5. 每個錯誤選項必須附 diagnosis：gap（30-50字，該選項反映的認知缺口）和 followup（40-80字，針對該選項的引導追問，要提到題目中的具體概念）。\n\n' +
    '生成 ' + count + ' 題繁體中文選擇題。\n\n' +
    '【範例】\n[{"stem":"某零售企業導入 AI 推薦系統後發現，系統對高消費客群的推薦準確率達 92%，但對新客戶的推薦幾乎隨機。資料團隊發現訓練資料中新客戶行為紀錄不足 5%。下列哪種做法最能有效改善此問題？","options":[{"key":"A","text":"蒐集更多新客戶的瀏覽與購買行為資料再重新訓練，因為資料不平衡是推薦失準的根本原因"},{"key":"B","text":"對新客戶使用基於規則的冷啟動策略搭配協同過濾，因為在資料不足時混合方法比純 ML 穩健"},{"key":"C","text":"將高消費客群的模型直接套用到新客戶，因為消費行為的底層模式具有跨客群的通用遷移性"},{"key":"D","text":"增加推薦系統的模型複雜度與隱藏層數量，因為更深的網路能從有限資料中擠出更多特徵資訊"}],"correct":"B","explanation":"冷啟動問題需要混合策略","diagnosis":{"A":{"gap":"混淆了資料量和資料分布問題","followup":"蒐集更多資料確實重要，但新客戶行為模式本身就少——在資料累積期間，推薦系統該怎麼運作？"},"C":{"gap":"忽略了不同客群行為模式的差異性","followup":"高消費客群的偏好（如高價品牌）直接套用到新客戶，結果會是什麼？"},"D":{"gap":"誤認為模型複雜度能彌補資料不足","followup":"資料只有 5% 卻加深網路層數，過擬合的風險是增加還是減少？"}}}]\n\n' +
    '回傳純 JSON（直接以 [ 開頭），key 必須用英文：stem, options（陣列 [{key,text}]）, correct, explanation, diagnosis。嚴禁使用中文 key。';
}

function parseAIQuestions(text) {
  if (!text || text.trim().length < 10) return [];
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const qs = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(qs)) return [];
    // Normalize: support both English keys (stem/options/correct) and Chinese keys (題目/選項/答案)
    return qs.map(function(q) {
      var stem = q.stem || q['題目'] || q['題幹'] || '';
      var correct = q.correct || q['答案'] || q['正確答案'] || '';
      var explanation = q.explanation || q['解析'] || q['說明'] || '';
      var options = q.options;
      // Convert Chinese options format: {"A":"text","B":"text"} → [{key:"A",text:"text"},...]
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
  } catch (e) { return []; }
}

function postProcessQuestions(questions) {
  // Fix correct=longest bias by swapping option text
  questions.forEach(function(q) {
    var lens = q.options.map(function(o) { return { key: o.key, len: o.text.length }; });
    var longest = lens.reduce(function(a, b) { return a.len > b.len ? a : b; });
    if (longest.key === q.correct && lens.length === 4) {
      var wrongs = q.options.filter(function(o) { return o.key !== q.correct; });
      var swap = wrongs[Math.floor(Math.random() * wrongs.length)];
      var correctOpt = q.options.find(function(o) { return o.key === q.correct; });
      var tmpText = correctOpt.text;
      correctOpt.text = swap.text;
      swap.text = tmpText;
      q.correct = swap.key;
    }
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

  // AI
  callGroq: callGroq,
  callGemini: callGemini,
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
