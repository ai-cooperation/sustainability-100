// ═══════════════════════════════════════════════════════
//  Three-Question Engine — Layer 2: Adaptive Practice + Exam
//  Depends on: learn-engine.js, learn-ui.js
// ═══════════════════════════════════════════════════════

(function(global){
'use strict';

var TQE = global.ThreeQuestionEngine;
var UI = global.TQE_UI;
if(!TQE) throw new Error('learn-engine.js must be loaded before learn-layer2.js');
if(!UI) throw new Error('learn-ui.js must be loaded before learn-layer2.js');

var state = TQE.state;

// ─── Terminology (configurable via content pack) ───
function term(key){
  var pack = TQE.getConfig().contentPack;
  var t = pack && pack.terminology ? pack.terminology : {};
  var defaults = {
    framework: '心智模型',
    exam: '模擬考',
    practice: '弱項練習',
    level1: '基礎概念',
    level2: '雙概念混合',
    level3: '企業情境',
    level4: '陷阱題'
  };
  return t[key] || defaults[key] || key;
}

// ─── Question Cache (Firebase) ───
function cacheQuestions(moduleId, level, questions){
  try {
    if(typeof firebase === 'undefined') return;
    var packId = TQE.getConfig().contentPack?.id || 'default';
    questions.forEach(function(q){
      if(!q.id || !q.stem) return;
      firebase.database().ref(packId + '/question_pool/' + moduleId + '/' + q.id).set({
        stem: q.stem, options: q.options, correct: q.correct,
        explanation: q.explanation || '', framework: q.framework || '',
        level: level, source: 'ai_generated',
        created: firebase.database.ServerValue.TIMESTAMP
      });
    });
  } catch(e){ /* silent */ }
}

function loadCachedQuestions(moduleId, level, limit){
  return new Promise(function(resolve){
    try {
      if(typeof firebase === 'undefined') return resolve([]);
      var packId = TQE.getConfig().contentPack?.id || 'default';
      firebase.database().ref(packId + '/question_pool/' + moduleId)
        .orderByChild('level').equalTo(level).limitToFirst(limit || 20).once('value')
        .then(function(snap){
          var cached = [];
          snap.forEach(function(child){
            var q = child.val();
            if(q && q.stem) cached.push(Object.assign({}, q, { id: 'CACHE-' + child.key, source: 'cached' }));
          });
          // Shuffle
          for(var i = cached.length - 1; i > 0; i--){
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = cached[i]; cached[i] = cached[j]; cached[j] = tmp;
          }
          resolve(cached.slice(0, limit || 10));
        }).catch(function(){ resolve([]); });
    } catch(e){ resolve([]); }
  });
}

// ─── Layer 2 State ───
var l2 = {
  level: 1,
  questions: [],
  currentQ: 0,
  answers: {},
  scores: {},
  correctStreak: 0,
  wrongInLevel: 0,
  targetFws: [],
  totalGenerated: 0,
  _reportShown: false
};

var _l2Generating = false;

// ─── Entry ───
function goLayer2(){
  UI.showScreen('tqeScreenLayer2');
  l2 = { level: 1, questions: [], currentQ: 0, answers: {}, scores: {},
    correctStreak: 0, wrongInLevel: 0, targetFws: [].concat(state.weakFws || []),
    totalGenerated: 0, _reportShown: false };

  var mod = TQE.getModule(state.moduleId);
  if(!mod) return;

  if(l2.targetFws.length === 0){
    l2.level = 2;
    l2.targetFws = mod.frameworks.map(function(f){ return f.id; });
  }

  var fwNames = l2.targetFws.map(function(fid){
    var fw = mod.frameworks.find(function(f){ return f.id === fid; });
    return fw ? fw.name : '';
  }).filter(Boolean);

  var subtitleEl = document.getElementById('tqeL2Subtitle');
  if(subtitleEl) subtitleEl.textContent = '聚焦：' + fwNames.join('、');

  var infoEl = document.getElementById('tqeL2Info');
  if(infoEl) infoEl.innerHTML =
    '<strong>Level ' + l2.level + ' — ' + [term('level1'), term('level2'), term('level3'), term('level4')][l2.level - 1] + '</strong><br>' +
    'AI 根據你的弱項動態出題。連續答對 3 題升級難度。每 10 題會出階段報告。';

  renderL2Level();
  generateL2Questions();
}

function renderL2Level(){
  var labels = ['Level 1 ' + term('level1'), 'Level 2 ' + term('level2'), 'Level 3 ' + term('level3'), 'Level 4 ' + term('level4')];
  var el = document.getElementById('tqeL2LevelBar');
  if(!el) return;
  el.innerHTML =
    '<div style="display:flex;gap:4px;margin-bottom:.5rem;">' +
    labels.map(function(_, i){ return '<div style="flex:1;height:6px;border-radius:3px;background:' + (i < l2.level ? 'var(--blue)' : 'var(--g200)') + ';"></div>'; }).join('') +
    '</div>' +
    '<div style="font-size:.85rem;color:var(--g600);text-align:center;">' +
    labels[l2.level - 1] + ' | 已答 ' + Object.keys(l2.answers).length + ' 題 | 連續正確 ' + l2.correctStreak + '</div>';
}

// ─── Question generation ───
function generateL2Questions(silent){
  var area = document.getElementById('tqeL2QuizArea');
  if(!silent && area) area.innerHTML = '<div class="info purple" style="text-align:center;"><strong>AI 正在出題...</strong><br><span style="font-size:.85rem;color:var(--g400);">約需 3-5 秒</span></div>';

  var mod = TQE.getModule(state.moduleId);
  if(!mod) return Promise.resolve();

  var existingIds = {};
  l2.questions.forEach(function(q){ existingIds[q.id] = true; if(q.stem) existingIds[q.stem] = true; });

  return loadCachedQuestions(state.moduleId, l2.level, 10).then(function(rawCached){
    var cached = rawCached.filter(function(q){ return !existingIds[q.id] && !existingIds[q.stem]; });
    cached.forEach(function(q){
      if(!q.diagnosis){
        q.diagnosis = {};
        (q.options || []).filter(function(o){ return o.key !== q.correct; }).forEach(function(o){
          q.diagnosis[o.key] = { gap: q.explanation || '', followup: '想想正確答案考慮了什麼？' };
        });
      }
    });
    l2.questions = l2.questions.concat(cached);

    // No pool fallback — Layer 2 uses only AI-generated new questions
    // This ensures learners don't repeat the same questions from the diagnostic test

    var unanswered = l2.questions.length - l2.currentQ;
    var needed = Math.max(0, 10 - unanswered);
    if(needed <= 0){
      if(!silent) renderL2Question();
      return;
    }

    // Build blind spot context for the prompt
    var blindSpots = l2.targetFws.map(function(fid){
      var wrongQs = mod.questions.filter(function(q){ return q.framework === fid && state.phase3.answers[q.id] !== q.correct; });
      var gaps = wrongQs.map(function(q){
        return state.phase3.answers[q.id] && q.diagnosis && q.diagnosis[state.phase3.answers[q.id]]
          ? q.diagnosis[state.phase3.answers[q.id]].gap : '';
      }).filter(Boolean);
      return gaps.length > 0 ? '學生盲區：' + gaps.join('；') : '';
    }).filter(Boolean).join('\n');

    // Use the engine's standard prompt builder (includes JSON example)
    var prompt = TQE.buildQuestionPrompt(mod, l2.targetFws, l2.level, Math.min(needed, 10));
    // Inject blind spot info before the rules section
    if(blindSpots){
      prompt = prompt.replace('【硬性規則】', '【學生盲區】\n' + blindSpots + '\n\n【硬性規則】');
    }

    var retries = 2;
    function tryGenerate(){
      return TQE.callGroq(prompt).then(function(text){
        var aiQs = TQE.parseAIQuestions(text);
        if(aiQs.length === 0) throw new Error('no valid questions');
        var newQs = aiQs.map(function(q, i){
          // Use AI-generated diagnosis if available, else build fallback from explanation
          var diag = q.diagnosis || {};
          (q.options || []).filter(function(o){ return o.key !== q.correct; }).forEach(function(o){
            if(!diag[o.key] || !diag[o.key].followup){
              var correctText = (q.options.find(function(x){ return x.key === q.correct; }) || {}).text || '';
              diag[o.key] = {
                gap: diag[o.key]?.gap || q.explanation || '',
                followup: '你選的「' + o.text.substring(0, 30) + '」，但正確答案是「' + correctText.substring(0, 30) + '」。這兩者的關鍵差異在哪？'
              };
            }
          });
          return Object.assign({}, q, {
            id: 'L2-' + (l2.totalGenerated + i + 1),
            framework: l2.targetFws[i % l2.targetFws.length] || l2.targetFws[0],
            source: 'groq',
            diagnosis: diag
          });
        });
        TQE.postProcessQuestions(newQs);
        l2.totalGenerated += newQs.length;
        l2.questions = l2.questions.concat(newQs);
        cacheQuestions(state.moduleId, l2.level, newQs);
        if(!silent) renderL2Question();
      }).catch(function(e){
        retries--;
        if(retries > 0) return tryGenerate();
        if(!silent && area) area.innerHTML = '<div class="info red">AI 出題失敗（' + e.message + '）<br>' +
          '<p style="font-size:13px;color:var(--text-soft);margin:var(--space-2) 0;">弱項練習使用 AI 動態出新題，需要網路連線。</p>' +
          '<div style="display:flex;gap:.5rem;margin-top:.8rem;justify-content:center;flex-wrap:wrap;">' +
          '<button class="btn btn-primary" onclick="TQE_Layer2.generateL2Questions()">重試</button>' +
          '<button class="btn btn-secondary" onclick="TQE_Layer2.backToReport()">← 返回報告</button>' +
          '</div></div>';
      });
    }
    return tryGenerate();
  });
}

// ─── Render question ───
function renderL2Question(){
  var area = document.getElementById('tqeL2QuizArea');
  if(!area) return;

  var remaining = l2.questions.length - l2.currentQ;
  if(remaining <= 4 && !_l2Generating && Object.keys(l2.answers).length < 50){
    _l2Generating = true;
    generateL2Questions(true).then(function(){ _l2Generating = false; }).catch(function(){ _l2Generating = false; });
  }

  var answered = Object.keys(l2.answers).length;

  // Every 10 questions → interim report
  if(answered > 0 && answered % 10 === 0 && !l2._reportShown){
    l2._reportShown = true;
    var correct = l2.questions.filter(function(q){ return l2.answers[q.id] === q.correct; }).length;
    var pct = Math.round(correct / answered * 100);
    var color = pct >= 70 ? 'var(--green)' : pct >= 40 ? 'var(--gold)' : 'var(--red)';
    var emoji = pct >= 70 ? '🎯' : pct >= 40 ? '📈' : '💪';
    var msg = pct >= 70 ? '表現不錯！可以挑戰' + term('exam') + '了。'
            : pct >= 40 ? '有進步空間，建議再練 10 題鞏固。'
            : '建議回去看對應講座，再來練習。';
    area.innerHTML =
      '<div class="info blue" style="text-align:center;">' +
      '<strong>' + emoji + ' ' + answered + ' 題階段報告</strong><br>' +
      '<div style="font-size:2rem;font-weight:900;color:' + color + ';margin:.5rem 0;">' + pct + '%</div>' +
      '<div>答對 ' + correct + '/' + answered + ' 題 | 目前 Level ' + l2.level + '</div>' +
      '<div style="margin-top:.5rem;color:var(--g600);">' + msg + '</div>' +
      '<div style="margin-top:1rem;display:flex;gap:.5rem;justify-content:center;flex-wrap:wrap;">' +
      '<button class="btn btn-primary" onclick="TQE_Layer2.generateL2Questions()">繼續練習 10 題 →</button>' +
      '<button class="btn btn-gold" onclick="TQE_Layer2.goExam()">進入' + term('exam') + '（50 題）</button>' +
      '</div></div>';
    return;
  }

  // Skip already-answered
  while(l2.currentQ < l2.questions.length && l2.answers[l2.questions[l2.currentQ].id]){
    l2.currentQ++;
  }

  if(l2.currentQ >= l2.questions.length){
    area.innerHTML = '<div class="info purple" style="text-align:center;"><strong>AI 正在出題...</strong><br><span style="font-size:.85rem;color:var(--g400);">約需 3-5 秒</span></div>';
    if(!_l2Generating) generateL2Questions();
    return;
  }

  var q = l2.questions[l2.currentQ];
  var mod = TQE.getModule(state.moduleId);
  var fw = mod ? mod.frameworks.find(function(f){ return f.id === q.framework; }) : null;

  area.innerHTML =
    '<div class="fade-in">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;">' +
    '<span style="font-size:.85rem;color:var(--g600);">第 ' + (answered + 1) + ' 題' + (fw ? ' | ' + fw.name : '') + '</span>' +
    '<span style="font-size:.8rem;padding:.2rem .6rem;border-radius:8px;background:var(--blue-lt);color:var(--blue);font-weight:700;">Level ' + l2.level + '</span>' +
    '</div>' +
    '<div class="quiz-stem">' + q.stem + '</div>' +
    '<div id="l2Opts-' + q.id + '">' +
    q.options.map(function(o){
      return '<button class="option-btn" onclick="TQE_Layer2.answerL2(\'' + q.id + '\',\'' + o.key + '\')">' +
        '<span class="opt-label">' + o.key + '</span>' + TQE.escHtml(o.text) + '</button>';
    }).join('') +
    '</div>' +
    '<div id="l2Fb-' + q.id + '" style="margin-top:1rem;"></div></div>';

  var progressEl = document.getElementById('tqeL2Progress');
  if(progressEl) progressEl.innerHTML =
    '<span style="font-size:.85rem;color:var(--g400);">答對率：' + calcL2Accuracy() + '% | ' + (10 - (Object.keys(l2.answers).length % 10 || 10)) + ' 題後出階段報告</span>';
}

// ─── Answer L2 ───
function answerL2(qid, chosen){
  var q = l2.questions.find(function(x){ return x.id === qid; });
  if(!q || l2.answers[qid]) return;
  var isCorrect = chosen === q.correct;

  // Lock options
  document.querySelectorAll('#l2Opts-' + qid + ' .option-btn').forEach(function(b){ b.classList.add('locked'); });
  var correctIdx = ['A','B','C','D'].indexOf(q.correct);
  var chosenIdx = ['A','B','C','D'].indexOf(chosen);
  var correctBtn = document.querySelector('#l2Opts-' + qid + ' .option-btn:nth-child(' + (correctIdx + 1) + ')');
  if(correctBtn) correctBtn.classList.add('correct');
  if(!isCorrect){
    var wrongBtn = document.querySelector('#l2Opts-' + qid + ' .option-btn:nth-child(' + (chosenIdx + 1) + ')');
    if(wrongBtn) wrongBtn.classList.add('wrong');
  }

  l2.answers[qid] = chosen;
  l2.scores[qid] = (q.options.find(function(o){ return o.key === chosen; }) || {}).depth || 1;

  // Difficulty adaptation
  if(isCorrect){
    l2.correctStreak++;
    l2.wrongInLevel = 0;
    if(l2.correctStreak >= 3 && l2.level < 4){
      l2.level++;
      l2.correctStreak = 0;
    }
  } else {
    l2.correctStreak = 0;
    l2.wrongInLevel++;
    if(l2.wrongInLevel >= 2 && l2.level > 1){
      l2.level--;
      l2.wrongInLevel = 0;
    }
  }

  // Feedback
  var fb = document.getElementById('l2Fb-' + qid);
  var mod = TQE.getModule(state.moduleId);
  var fw = mod ? mod.frameworks.find(function(f){ return f.id === q.framework; }) : null;

  if(isCorrect){
    fb.innerHTML =
      '<div class="info green"><strong>正確！</strong> ' + (q.explanation || '') + '</div>' +
      (l2.correctStreak === 0 && l2.level > 1 ? '<div class="info blue" style="margin-top:.5rem;"><strong>升級！</strong> 進入 Level ' + l2.level + '</div>' : '') +
      '<button class="btn btn-primary btn-block" onclick="TQE_Layer2.nextL2()" style="margin-top:.5rem;">下一題 →</button>';
  } else {
    var diag = q.diagnosis ? q.diagnosis[chosen] : null;
    var chosenText = (q.options.find(function(o){ return o.key === chosen; }) || {}).text || '';
    var correctText = (q.options.find(function(o){ return o.key === q.correct; }) || {}).text || '';

    // First-round followup: pre-generated, no API
    var initialFollowup;
    if(diag && diag.followup){
      initialFollowup = diag.followup;
    } else {
      initialFollowup = '你選的「' + chosenText.substring(0, 30) + '」，但正確答案是「' + correctText.substring(0, 30) + '」。' +
        '這兩者的關鍵差異在哪？打字告訴我你的想法，AI 會根據你的回應分析。';
    }

    fb.innerHTML =
      '<div class="info red"><strong>答案是 ' + q.correct + '</strong>。' + (q.explanation || '') + '</div>' +
      (diag ? '<div class="info gold" style="margin-top:.5rem;"><strong>你的盲區：</strong>' + diag.gap + '</div>' : '') +
      (fw ? '<div style="margin-top:.5rem;font-size:.9rem;color:var(--g600);">→ 回顧' + term('framework') + '「' + fw.name + '」：' + fw.desc + '</div>' : '') +
      '<div class="tqe-chat" id="l2chat-' + qid + '">' +
      '<div class="tqe-chat-header">AI 追問引擎</div>' +
      '<div class="tqe-chat-body" id="l2chatBody-' + qid + '">' +
      '<div class="tqe-chat-msg from-ai">' + TQE.escHtml(initialFollowup) + '</div>' +
      '</div>' +
      '<div class="tqe-chat-input">' +
      '<input type="text" id="l2chatInput-' + qid + '" placeholder="輸入你的想法..." onkeydown="if(event.key===\'Enter\'){event.preventDefault();TQE_Layer2.sendL2Chat(\'' + qid + '\');}">' +
      '<button onclick="TQE_Layer2.sendL2Chat(\'' + qid + '\')">送出</button>' +
      '</div></div>' +
      '<button class="btn btn-secondary btn-block" onclick="TQE_Layer2.nextL2()" style="margin-top:.5rem;">下一題 →</button>';
  }

  renderL2Level();
  TQE.saveSession();
  TQE.saveBlindSpot(q, chosen, isCorrect);
}

function nextL2(){
  l2.currentQ++;
  l2._reportShown = false;
  renderL2Question();
  var el = document.getElementById('tqeL2QuizArea');
  if(el) window.scrollTo(0, el.offsetTop - 60);
}

function calcL2Accuracy(){
  var total = Object.keys(l2.answers).length;
  if(total === 0) return 0;
  var correct = l2.questions.filter(function(q){ return l2.answers[q.id] === q.correct; }).length;
  return Math.round(correct / total * 100);
}

// ─── L2 AI Chat ───
var _l2ChatCooldown = false;

function sendL2Chat(qid){
  if(_l2ChatCooldown) return;
  var input = document.getElementById('l2chatInput-' + qid);
  if(!input) return;
  var msg = input.value.trim();
  if(!msg) return;

  // Lock UI
  input.value = '';
  input.blur();
  input.disabled = true;
  var btn = input.parentNode.querySelector('button');
  if(btn){ btn.disabled = true; btn.style.opacity = '.5'; btn.textContent = '送出中'; }

  var body = document.getElementById('l2chatBody-' + qid);
  body.innerHTML += '<div class="tqe-chat-msg from-user">' + TQE.escHtml(msg) + '</div>';
  body.scrollTop = body.scrollHeight;

  _l2ChatCooldown = true;
  function unlock(){
    _l2ChatCooldown = false;
    if(input){ input.disabled = false; }
    if(btn){ btn.disabled = false; btn.style.opacity = '1'; btn.textContent = '送出'; }
  }
  var unlockTimer = setTimeout(unlock, 3000);

  body.innerHTML += '<div class="tqe-chat-msg from-ai" id="l2aiLoading-' + qid + '" style="opacity:.5;">思考中...</div>';
  body.scrollTop = body.scrollHeight;

  var q = l2.questions.find(function(x){ return x.id === qid; });
  var mod = TQE.getModule(state.moduleId);
  var fw = mod ? mod.frameworks.find(function(f){ return f.id === q.framework; }) : null;
  var chosen = l2.answers[qid];

  var chatMsgs = Array.from(body.querySelectorAll('.tqe-chat-msg')).map(function(el){
    var role = el.classList.contains('from-user') ? '學生' : '助教';
    return role + '：' + el.textContent.trim();
  }).filter(function(t){ return t.indexOf('思考中') === -1; }).slice(-6).join('\n');

  var pack = TQE.getConfig().contentPack;
  var prompt = '你是' + (pack ? pack.name : '學習系統') + '的學習助教，風格像一個很會教的學長姐 — 用白話、比喻、生活化例子。\n\n' +
    '學生在學習「' + (mod ? mod.name : '') + '」模組。\n\n' +
    '【原始題目】\n' + q.stem + '\n\n' +
    '【選項】\n' + q.options.map(function(o){ return o.key + '. ' + o.text; }).join('\n') + '\n\n' +
    '學生選了：' + chosen + '\n正確答案：' + q.correct + '\n' +
    (fw ? '相關' + term('framework') + '：' + fw.name + ' — ' + fw.desc + '\n' : '') +
    '\n【對話紀錄】\n' + chatMsgs + '\n\n學生最新回覆：「' + msg + '」\n\n' +
    '用蘇格拉底式提問引導：肯定正確部分，用反例/比喻幫他看到漏掉的維度，用引導問題收尾。3-4 句話，繁體中文，不要 markdown。';

  TQE.callGemini(prompt).then(function(reply){
    var el = document.getElementById('l2aiLoading-' + qid);
    if(el) el.remove();
    body.innerHTML += '<div class="tqe-chat-msg from-ai">' + TQE.escHtml(reply === '[RATE_LIMIT]' ? 'AI 額度暫時用完，請等 30 秒再試。' : (reply || '抱歉，AI 暫時無法回應。')) + '</div>';
    body.scrollTop = body.scrollHeight;
    clearTimeout(unlockTimer);
    unlock();
  }).catch(function(){
    var el = document.getElementById('l2aiLoading-' + qid);
    if(el) el.remove();
    body.innerHTML += '<div class="tqe-chat-msg from-ai">抱歉，AI 暫時無法回應，請繼續下一題。</div>';
    body.scrollTop = body.scrollHeight;
    clearTimeout(unlockTimer);
    unlock();
  });
}

// ═══════════════════════════════════════════════════════
//  SIMULATED EXAM (50 questions, 75 min)
// ═══════════════════════════════════════════════════════

var exam = {
  questions: [],
  answers: {},
  currentQ: 0,
  startTime: null,
  timerInterval: null,
  timeLimit: 75 * 60 * 1000
};

function goExam(){
  UI.showScreen('tqeScreenExam');

  // Determine subject and time limit
  var subjects = TQE.getSubjects();
  var subjectId = state.examSubjectId || null;
  var subject = subjectId ? subjects.find(function(s){ return s.id === subjectId; }) : null;
  var duration = subject ? subject.duration : 75;

  exam = { questions: [], answers: {}, currentQ: 0, startTime: null, timerInterval: null, timeLimit: duration * 60 * 1000, subjectId: subjectId };

  var timerEl = document.getElementById('tqeExamTimer');
  if(timerEl) timerEl.textContent = '組卷中...';
  var area = document.getElementById('tqeExamArea');
  var headerLabel = subject ? TQE.escHtml(subject.name) : '';
  if(area) area.innerHTML = '<div class="info purple" style="text-align:center;">' +
    (headerLabel ? '<div style="font-size:1.1rem;font-weight:700;margin-bottom:.5rem;">' + headerLabel + '</div>' : '') +
    '<strong>AI 正在組卷...</strong><br><span id="tqeExamLoadProgress">準備題庫中</span></div>';

  generateExamQuestions();
}

function updateExamTimer(){
  var elapsed = Date.now() - exam.startTime;
  var remaining = Math.max(0, exam.timeLimit - elapsed);
  var min = Math.floor(remaining / 60000);
  var sec = Math.floor((remaining % 60000) / 1000);
  var el = document.getElementById('tqeExamTimer');
  if(el){
    el.textContent = String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
    el.style.color = remaining < 5 * 60 * 1000 ? 'var(--red)' : 'var(--navy)';
  }
  if(remaining <= 0){
    clearInterval(exam.timerInterval);
    finishExam();
  }
}

function generateExamQuestions(){
  // Collect modules: subject-level (multiple modules) or single module fallback
  var subjects = TQE.getSubjects();
  var subjectId = exam.subjectId || null;
  var subject = subjectId ? subjects.find(function(s){ return s.id === subjectId; }) : null;

  var examModules = [];
  if(subject){
    subject.modules.forEach(function(mid){
      var m = TQE.getModule(mid);
      if(m) examModules.push(m);
    });
  }
  if(examModules.length === 0){
    var mod = TQE.getModule(state.moduleId);
    if(mod) examModules.push(mod);
  }
  if(examModules.length === 0) return;

  var targetTotal = subject ? (subject.total || 50) : 50;
  var scopeEl = document.getElementById('tqeExamLoadProgress');
  var scopeLabel = subject ? subject.name : (examModules[0].examSubject ? examModules[0].examSubject.name : examModules[0].name);
  if(scopeEl) scopeEl.innerHTML = '<strong>範圍：' + scopeLabel + '</strong>（' + targetTotal + ' 題）<br>分析學員程度中...';

  // ─── Step 1: Assess learner — per-framework scores + find weak/strong ───
  var fwScoreMap = {}; // fwId → { total, count, name, moduleId, isWeak }
  examModules.forEach(function(m){
    m.frameworks.forEach(function(fw){
      fwScoreMap[fw.id] = { total: 0, count: 0, name: fw.name, moduleId: m.id, desc: fw.desc };
    });
    m.questions.forEach(function(q){
      if(state.phase3.scores && state.phase3.scores[q.id] && fwScoreMap[q.framework]){
        fwScoreMap[q.framework].total += state.phase3.scores[q.id];
        fwScoreMap[q.framework].count++;
      }
    });
  });

  var weakFws = []; // frameworks with avg < 3
  var strongFws = [];
  var allFwIds = Object.keys(fwScoreMap);
  allFwIds.forEach(function(fid){
    var fs = fwScoreMap[fid];
    var avg = fs.count > 0 ? fs.total / fs.count : 2;
    fs.avg = avg;
    fs.isWeak = avg < 3;
    if(fs.isWeak) weakFws.push(fid);
    else strongFws.push(fid);
  });
  // If no Phase 3 data, treat all as neutral
  if(weakFws.length === 0 && strongFws.length === 0){
    weakFws = allFwIds.slice(0, Math.ceil(allFwIds.length / 2));
    strongFws = allFwIds.slice(Math.ceil(allFwIds.length / 2));
  }
  // If everything is weak or everything is strong
  if(weakFws.length === 0) weakFws = allFwIds.slice(0, 1);
  if(strongFws.length === 0) strongFws = allFwIds.slice(-1);

  var totalScore = 0, totalCount = 0;
  allFwIds.forEach(function(fid){ totalScore += fwScoreMap[fid].total; totalCount += fwScoreMap[fid].count; });
  var avgAbility = totalCount > 0 ? totalScore / totalCount : 2;
  var abilityLabel = avgAbility >= 3 ? '進階' : avgAbility >= 1.5 ? '中等' : '基礎';
  var aiLevel = avgAbility >= 3 ? 4 : avgAbility >= 1.5 ? 3 : 2;

  // ─── Step 2: Pool questions — weak-framework prioritized ───
  var weakPool = [];
  var strongPool = [];
  examModules.forEach(function(m){
    m.questions.forEach(function(q){
      var tagged = Object.assign({}, q, { _sourceModule: m.id });
      if(weakFws.indexOf(q.framework) >= 0){
        weakPool.push(tagged);
      } else {
        strongPool.push(tagged);
      }
    });
  });
  // Shuffle each pool
  function _shuffle(arr){
    for(var i = arr.length - 1; i > 0; i--){
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
  }
  _shuffle(weakPool);
  _shuffle(strongPool);

  // Prioritize weak: take all weak, then fill with strong
  var poolSelected = weakPool.concat(strongPool);
  var poolCount = poolSelected.length;

  // If pool alone covers target (S3/S4), cap and prioritize weak
  if(poolCount >= targetTotal){
    exam.questions = poolSelected.slice(0, targetTotal).map(function(q){
      return Object.assign({}, q, { id: 'EX-' + q.id, source: 'pool' });
    });
    _startExamNow(scopeEl);
    return;
  }

  // Pool < target — use all pool, AI fills the rest
  exam.questions = poolSelected.map(function(q){
    return Object.assign({}, q, { id: 'EX-' + q.id, source: 'pool' });
  });
  var needed = targetTotal - poolCount;

  // ─── Step 3: AI generates remaining — one call per 10 questions (reliable) ───
  // Build blind spot context from Phase 3 wrong answers
  var blindSpotLines = [];
  weakFws.forEach(function(fid){
    var fs = fwScoreMap[fid];
    var mod = TQE.getModule(fs.moduleId);
    if(!mod) return;
    var wrongQs = mod.questions.filter(function(q){
      return q.framework === fid && state.phase3.answers && state.phase3.answers[q.id] && state.phase3.answers[q.id] !== q.correct;
    });
    var gaps = wrongQs.map(function(q){
      var chosen = state.phase3.answers[q.id];
      return (q.diagnosis && q.diagnosis[chosen]) ? q.diagnosis[chosen].gap : '';
    }).filter(Boolean);
    if(gaps.length > 0){
      blindSpotLines.push('「' + fs.name + '」盲區：' + gaps.slice(0, 2).join('；'));
    }
  });
  var blindSpotText = blindSpotLines.slice(0, 3).join('\n');

  // Collect all framework info across exam modules (for prompt context)
  var allFwInfo = [];
  examModules.forEach(function(m){
    m.frameworks.forEach(function(f){
      allFwInfo.push({ id: f.id, name: f.name, desc: f.desc, moduleId: m.id });
    });
  });

  if(scopeEl) scopeEl.innerHTML = '<strong>範圍：' + scopeLabel + '</strong><br>' +
    '程度：' + abilityLabel + ' · 弱項 ' + weakFws.length + ' 個框架<br>' +
    '題庫 ' + poolCount + ' 題 + AI 針對弱項生成 ' + needed + ' 題中...';

  var aiDone = false;
  var timeoutId = setTimeout(function(){
    if(!aiDone){
      aiDone = true;
      if(scopeEl) scopeEl.textContent = 'AI 超時，以現有 ' + exam.questions.length + ' 題開考';
      _startExamNow(scopeEl);
    }
  }, 30000);

  // Two calls: weak (10 questions) + strong (10 questions), each ≤10 proven reliable
  var weakBatch = Math.min(needed, 10);
  var strongBatch = Math.min(needed - weakBatch, 10);
  // If needed ≤ 10, all go to weak
  if(needed <= 10){ weakBatch = needed; strongBatch = 0; }

  var pack = TQE.getConfig().contentPack;
  var examName = pack?.examInfo?.name || '認證考試';

  function _buildExamPrompt(targetFwIds, includeBlindSpot, level, count){
    var fwDesc = targetFwIds.map(function(fid){
      var info = allFwInfo.find(function(f){ return f.id === fid; });
      return info ? (TQE.term('framework') + '「' + info.name + '」：' + info.desc) : '';
    }).filter(Boolean).join('\n');

    return '你是' + examName + '的專業出題委員。\n\n' +
      '【出題範圍】\n' + fwDesc + '\n\n' +
      (includeBlindSpot && blindSpotText ? '【學生盲區 — 請針對這些出題】\n' + blindSpotText + '\n\n' : '') +
      '【難度】Level ' + level + '\n\n' +
      '【規則】\n' +
      '1. 題幹以「某企業」開頭，至少 60 字實務情境\n' +
      '2. 選項每個 35-50 字，格式「做法，因為＋理由」，字數差距 ≤ 5 字\n' +
      '3. 正確選項不可是最長的\n' +
      '4. 每個錯誤選項附 diagnosis：{gap: "30-50字", followup: "40-80字"}\n\n' +
      '生成 ' + count + ' 題。回傳純 JSON 以 [ 開頭，key 用英文：stem, options([{key,text}]), correct, explanation, diagnosis。';
  }

  var chain = Promise.resolve();

  // Call 1: Weak frameworks — 針對弱項盲區出題
  if(weakBatch > 0){
    chain = chain.then(function(){
      if(scopeEl) scopeEl.textContent = 'AI 生成弱項題 (1/2)...';
      var prompt = _buildExamPrompt(weakFws, true, aiLevel, weakBatch);
      return _callAndAppendAI(prompt, examModules[0], weakFws, 'weak', scopeEl, targetTotal);
    });
  }

  // Call 2: Strong frameworks — 驗證強項，難度再高一級
  if(strongBatch > 0){
    chain = chain.then(function(){
      if(scopeEl) scopeEl.textContent = 'AI 生成驗證題 (2/2)...';
      var prompt = _buildExamPrompt(strongFws, false, Math.min(aiLevel + 1, 4), strongBatch);
      return _callAndAppendAI(prompt, examModules[0], strongFws, 'strong', scopeEl, targetTotal);
    });
  }

  chain.then(function(){
    if(!aiDone){
      aiDone = true;
      clearTimeout(timeoutId);
      _startExamNow(scopeEl);
    }
  });
}

function _callAndAppendAI(prompt, mod, fwIds, tag, scopeEl, targetTotal){
  return TQE.callGroq(prompt, 8192).then(function(text){
    var aiQs = TQE.parseAIQuestions(text);
    if(scopeEl) scopeEl.textContent = 'AI 已生成 ' + (exam.questions.length + aiQs.length) + ' / ' + targetTotal + ' 題...';
    var mapped = aiQs.map(function(q, idx){
      var diag = q.diagnosis || {};
      (q.options || []).filter(function(o){ return o.key !== q.correct; }).forEach(function(o){
        if(!diag[o.key] || !diag[o.key].followup){
          var correctText = (q.options.find(function(x){ return x.key === q.correct; }) || {}).text || '';
          diag[o.key] = {
            gap: diag[o.key]?.gap || q.explanation || '',
            followup: '你選的「' + o.text.substring(0, 30) + '」，但正確答案是「' + correctText.substring(0, 30) + '」。差異在哪？'
          };
        }
      });
      return Object.assign({}, q, {
        id: 'EX-AI-' + tag + '-' + (idx + 1),
        framework: fwIds[idx % fwIds.length] || 'F1',
        source: 'groq', _sourceModule: mod.id, diagnosis: diag
      });
    });
    TQE.postProcessQuestions(mapped);
    exam.questions = exam.questions.concat(mapped);
    cacheQuestions(mod.id, 3, mapped);
  }).catch(function(e){
    console.warn('Exam AI (' + tag + ') failed:', e.message);
  });
}

// Classify question difficulty by stem length, option complexity, framework depth
function classifyDifficulty(q){
  var stemLen = (q.stem || '').length;
  var avgOptLen = 0;
  (q.options || []).forEach(function(o){ avgOptLen += (o.text || '').length; });
  avgOptLen = q.options ? avgOptLen / q.options.length : 0;
  // Heuristic: longer stem + longer options = harder
  var score = 0;
  if(stemLen > 80) score += 2;
  else if(stemLen > 50) score += 1;
  if(avgOptLen > 42) score += 2;
  else if(avgOptLen > 35) score += 1;
  // depth of wrong options: more depth=2 means more plausible = harder
  var depth2Count = (q.options || []).filter(function(o){ return o.depth === 2; }).length;
  if(depth2Count >= 3) score += 1;

  if(score >= 4) return 'hard';
  if(score >= 3) return 'medium';
  if(score >= 2) return 'easy';
  return 'basic';
}

function _startExamNow(scopeEl){
  var total = exam.questions.length;
  var aiCount = exam.questions.filter(function(q){ return q.source === 'groq'; }).length;
  var poolCount = total - aiCount;
  var label = '組卷完成！共 ' + total + ' 題';
  if(aiCount > 0) label += '（題庫 ' + poolCount + ' + AI 弱項 ' + aiCount + '）';
  else if(total < 50) label += '（AI 出題未成功，以現有題庫作答）';
  if(scopeEl) scopeEl.textContent = label;

  // Shuffle
  for(var i = exam.questions.length - 1; i > 0; i--){
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = exam.questions[i]; exam.questions[i] = exam.questions[j]; exam.questions[j] = tmp;
  }

  exam.startTime = Date.now();
  exam.timerInterval = setInterval(updateExamTimer, 1000);
  updateExamTimer();
  renderExamQuestion();
}

function renderExamQuestion(){
  var area = document.getElementById('tqeExamArea');
  if(!area) return;
  if(exam.currentQ >= exam.questions.length){
    finishExam();
    return;
  }

  var q = exam.questions[exam.currentQ];
  var total = exam.questions.length;

  area.innerHTML =
    '<div class="fade-in">' +
    '<div class="quiz-stem"><span class="q-num">' + (exam.currentQ + 1) + ' / ' + total + '</span>' + q.stem + '</div>' +
    '<div id="examOpts-' + q.id + '">' +
    q.options.map(function(o){
      return '<button class="option-btn" onclick="TQE_Layer2.answerExam(\'' + q.id + '\',\'' + o.key + '\')">' +
        '<span class="opt-label">' + o.key + '</span>' + TQE.escHtml(o.text) + '</button>';
    }).join('') +
    '</div></div>';

  // Nav info
  var loadProgress = document.getElementById('tqeExamLoadProgress');
  if(loadProgress){
    var answeredCount = Object.keys(exam.answers).length;
    loadProgress.innerHTML = '<span style="font-size:.85rem;color:var(--g600);">已答 ' + answeredCount + ' / ' + total + '</span>' +
      (answeredCount >= total - 1 ? ' <button class="btn btn-primary" onclick="TQE_Layer2.finishExam()" style="margin-left:1rem;">交卷</button>' : '');
  }
}

function answerExam(qid, chosen){
  if(exam.answers[qid]) return;
  exam.answers[qid] = chosen;

  document.querySelectorAll('#examOpts-' + qid + ' .option-btn').forEach(function(b){ b.classList.add('locked'); });

  setTimeout(function(){
    exam.currentQ++;
    if(exam.currentQ >= exam.questions.length){
      finishExam();
    } else {
      renderExamQuestion();
      var el = document.getElementById('tqeExamArea');
      if(el) window.scrollTo(0, el.offsetTop - 60);
    }
  }, 300);
}

function finishExam(){
  clearInterval(exam.timerInterval);
  UI.showScreen('tqeScreenExamResult');

  var total = exam.questions.length;
  var answered = Object.keys(exam.answers).length;
  var correct = exam.questions.filter(function(q){ return exam.answers[q.id] === q.correct; }).length;
  var score = total > 0 ? Math.round(correct / total * 100) : 0;
  var passed = score >= 70;
  var elapsed = Math.round((Date.now() - exam.startTime) / 60000);
  var avgSec = answered > 0 ? Math.round(elapsed * 60 / answered) : 0;

  // Subject info
  var subjects = TQE.getSubjects();
  var subject = exam.subjectId ? subjects.find(function(s){ return s.id === exam.subjectId; }) : null;
  var examTitle = subject ? subject.name : term('exam');

  var area = document.getElementById('tqeExamResultArea');
  if(!area) return;

  var html = '';

  // ── Score ring + hero copy ──
  html += '<div class="result-hero">';
  html += '<div class="result-ring" style="--pct:' + score + '">';
  html += '<div class="result-ring-inner"><b>' + score + '</b><span>本次分數</span></div>';
  html += '</div>';
  html += '<div class="result-hero-copy">';
  html += '<div class="label-eyebrow">' + TQE.escHtml(examTitle) + '</div>';
  html += '<h1>' + (passed ? '通過！' : '未通過 — 繼續加油') + '</h1>';
  html += '<p>' + (passed ? '恭喜通過！預估真實考試及格率高。' : '未達 70 分及格標準，建議回到弱項練習加強。') + '</p>';

  // ── KPI row ──
  html += '<div class="result-kpis">';
  html += '<div class="kpi"><b>' + correct + ' / ' + answered + '</b><span>正確題數</span></div>';
  html += '<div class="kpi"><b>' + avgSec + '<span style="font-size:14px;color:var(--text-mute)">s</span></b><span>每題平均</span></div>';
  html += '<div class="kpi"><b>' + score + '<span style="font-size:14px;color:var(--text-mute)">%</span></b><span>通過機率</span></div>';
  html += '<div class="kpi"><b>' + elapsed + '<span style="font-size:14px;color:var(--text-mute)">m</span></b><span>用時</span></div>';
  html += '</div></div></div>';

  // Per-framework accuracy (collect from all exam modules)
  var examModules = [];
  if(subject){
    subject.modules.forEach(function(mid){
      var m = TQE.getModule(mid);
      if(m) examModules.push(m);
    });
  }
  if(examModules.length === 0){
    var mod = TQE.getModule(state.moduleId);
    if(mod) examModules.push(mod);
  }

  var newWeakCount = 0;

  if(examModules.length > 0){
    var fwStats = {};
    examModules.forEach(function(m){
      m.frameworks.forEach(function(f){
        if(!fwStats[f.id]) fwStats[f.id] = { correct: 0, total: 0, name: f.name };
      });
    });
    exam.questions.forEach(function(q){
      if(fwStats[q.framework]){
        fwStats[q.framework].total++;
        if(exam.answers[q.id] === q.correct) fwStats[q.framework].correct++;
      }
    });

    // ── Module breakdown bars ──
    html += '<div class="breakdown"><h3>各' + term('framework') + '掌握度</h3>';
    Object.keys(fwStats).forEach(function(fid){
      var s = fwStats[fid];
      if(s.total === 0) return;
      var pct = Math.round(s.correct / s.total * 100);
      var isWeak = pct < 50;
      if(isWeak) newWeakCount++;
      var barColor = pct >= 70 ? 'var(--forest-500)' : pct >= 50 ? 'var(--amber)' : 'var(--clay)';
      html += '<div class="breakdown-row">' +
        '<div class="breakdown-name">' + TQE.escHtml(s.name) + '</div>' +
        '<div class="breakdown-bar"><span style="width:' + pct + '%;background:' + barColor + '"></span></div>' +
        '<div class="breakdown-pct">' + pct + '%</div>' +
        '<div class="breakdown-delta">' + s.correct + '/' + s.total + '</div></div>';
    });
    html += '</div>';

    // ── Wrong questions review ──
    var wrongQs = exam.questions.filter(function(q){ return exam.answers[q.id] && exam.answers[q.id] !== q.correct; });
    if(wrongQs.length > 0){
      html += '<div class="breakdown"><h3>錯題回顧</h3>';
      wrongQs.slice(0, 15).forEach(function(q){
        var yourChoice = q.options.find(function(o){ return o.key === exam.answers[q.id]; });
        var correctChoice = q.options.find(function(o){ return o.key === q.correct; });
        html += '<div style="padding:var(--space-4) 0;border-bottom:1px solid var(--border);">' +
          '<p style="font-weight:500;font-size:14px;margin:0 0 var(--space-2);">' + TQE.escHtml(q.stem) + '</p>' +
          '<p style="font-size:13px;color:var(--clay);margin:0 0 var(--space-1);"><strong>你選 ' + exam.answers[q.id] + '：</strong>' + TQE.escHtml(yourChoice ? yourChoice.text : '') + '</p>' +
          '<p style="font-size:13px;color:var(--forest-700);margin:0;">' +
          '<strong>正確 ' + q.correct + '：</strong>' + TQE.escHtml(correctChoice ? correctChoice.text : '') + '</p>' +
          (q.explanation ? '<p style="font-size:13px;color:var(--text-soft);margin:var(--space-2) 0 0;padding:var(--space-2) var(--space-3);background:var(--bg-soft);border-radius:var(--radius-sm);border-left:3px solid var(--forest-500);">' + TQE.escHtml(q.explanation) + '</p>' : '') +
          '</div>';
      });
      html += '</div>';
    }
  }

  // ── Recommendation cards ──
  html += '<div class="section-head" style="margin-bottom:var(--space-4);"><div>' +
    '<h2 style="font-size:20px;margin:0;">下一步</h2></div></div>';
  html += '<div class="recommend-grid">';
  html += '<div class="recommend"><span class="recommend-tag">建議動作</span>' +
    '<h4>重看弱項模組</h4>' +
    '<p>回到弱項練習，AI 根據你的錯題動態出題加強。</p>' +
    '<div class="recommend-foot"><span>AI 出題</span>' +
    '<button class="btn btn-primary btn-sm" onclick="TQE_Layer2.goLayer2()">開始</button></div></div>';
  html += '<div class="recommend"><span class="recommend-tag">模擬考</span>' +
    '<h4>排程下次模擬考</h4>' +
    '<p>建議複習後再考一次，預期分數會提升。</p>' +
    '<div class="recommend-foot"><span>75 MIN</span>' +
    '<button class="btn btn-outline btn-sm" onclick="location.reload()">返回首頁</button></div></div>';
  html += '</div>';

  html += '<div style="display:flex;justify-content:center;margin-top:var(--space-7);">' +
    '<button class="btn btn-ghost" onclick="location.reload()">回首頁</button></div>';

  area.innerHTML = html;

  // Save exam result to stats history
  try {
    var statsKey = 'tqe_s100_stats';
    var statsRaw = localStorage.getItem(statsKey);
    var stats = statsRaw ? JSON.parse(statsRaw) : {};
    if(!stats.examHistory) stats.examHistory = [];
    stats.examHistory.push({
      date: new Date().toLocaleDateString('zh-TW'),
      subject: examTitle,
      score: score,
      correct: correct,
      total: total,
      elapsed: elapsed,
      passed: passed
    });
    // Keep last 20 exams
    if(stats.examHistory.length > 20) stats.examHistory = stats.examHistory.slice(-20);
    localStorage.setItem(statsKey, JSON.stringify(stats));
  } catch(e){ /* silent */ }

  TQE.saveSession();
  TQE.saveProgress('exam_complete');
}

// ─── Navigation ───
function backToReport(){
  UI.goReport();
}

// ─── Public API ───
global.TQE_Layer2 = {
  goLayer2: goLayer2,
  backToReport: backToReport,
  goExam: goExam,
  answerL2: answerL2,
  nextL2: nextL2,
  answerExam: answerExam,
  finishExam: finishExam,
  generateL2Questions: generateL2Questions,
  sendL2Chat: sendL2Chat
};

})(typeof window !== 'undefined' ? window : global);
