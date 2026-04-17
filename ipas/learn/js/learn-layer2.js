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

    // Fallback: fill from content pack pool (target framework questions not yet used)
    var poolQs = [];
    l2.targetFws.forEach(function(fid){
      mod.questions.forEach(function(q){
        if(q.framework === fid && !existingIds[q.id] && !existingIds[q.stem]){
          poolQs.push(q);
        }
      });
    });
    // Shuffle pool
    for(var si = poolQs.length - 1; si > 0; si--){
      var sj = Math.floor(Math.random() * (si + 1));
      var stmp = poolQs[si]; poolQs[si] = poolQs[sj]; poolQs[sj] = stmp;
    }
    // Take from pool
    var poolTaken = poolQs.slice(0, Math.max(0, 10 - (l2.questions.length - l2.currentQ)));
    poolTaken.forEach(function(q){
      var clone = JSON.parse(JSON.stringify(q));
      clone.id = 'POOL-' + q.id;
      clone.source = 'pool';
      l2.questions.push(clone);
      existingIds[q.id] = true;
      existingIds[q.stem] = true;
    });

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
        // Fallback: if pool questions were loaded, use those instead of showing error
        if(l2.questions.length > l2.currentQ){
          if(!silent) renderL2Question();
          return;
        }
        if(!silent && area) area.innerHTML = '<div class="info red">出題失敗（' + e.message + '）<br>' +
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

  // Determine exam size
  var targetTotal = subject ? subject.total : 50;
  var poolSize = 0;
  examModules.forEach(function(m){ poolSize += m.questions.length; });
  targetTotal = Math.min(Math.max(targetTotal, 20), 50);

  // Show scope info
  var scopeEl = document.getElementById('tqeExamLoadProgress');
  var scopeLabel = subject ? subject.name : (examModules[0].examSubject ? examModules[0].examSubject.name : examModules[0].name);
  if(scopeEl) scopeEl.innerHTML = '<strong>範圍：' + scopeLabel + '</strong>（' + targetTotal + ' 題）<br>題庫載入中...';

  // Collect questions from all modules in subject
  var pool = [];
  examModules.forEach(function(m){
    m.questions.forEach(function(q){
      pool.push(Object.assign({}, q, { _sourceModule: m.id }));
    });
  });
  // Shuffle pool
  for(var i = pool.length - 1; i > 0; i--){
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
  }

  // Use all pool questions upfront (AI supplements if needed)
  var fromPool = pool.map(function(q){
    return Object.assign({}, q, { id: 'EX-' + q.id, source: 'pool' });
  });
  exam.questions = fromPool.slice(0, targetTotal);

  if(scopeEl) scopeEl.innerHTML = '<strong>範圍：' + scopeLabel + '</strong>（' + targetTotal + ' 題）<br>題庫已載入 ' + fromPool.length + ' 題，AI 生成中...';

  // Collect all frameworks across subject modules
  var allFrameworks = [];
  var fwIdsSeen = {};
  examModules.forEach(function(m){
    m.frameworks.forEach(function(f){
      if(!fwIdsSeen[f.id]){ fwIdsSeen[f.id] = true; allFrameworks.push(f); }
    });
  });

  var needed = targetTotal - fromPool.length;
  var batchSize = 10;
  var batches = Math.ceil(needed / batchSize);
  // Use first module for prompt context (buildQuestionPrompt needs a module)
  var promptMod = examModules[0];

  var chain = Promise.resolve();
  for(var b = 0; b < batches; b++){
    (function(batchIdx){
      chain = chain.then(function(){
        var count = Math.min(batchSize, needed - batchIdx * batchSize);
        var prompt = TQE.buildQuestionPrompt(promptMod, allFrameworks.map(function(f){ return f.id; }), 3, count);

        return TQE.callGroq(prompt, 8192).then(function(text){
          var aiQs = TQE.parseAIQuestions(text);
          var mapped = aiQs.map(function(q, idx){
            return Object.assign({}, q, {
              id: 'EX-AI-' + (batchIdx * batchSize + idx + 1),
              framework: allFrameworks[Math.floor(Math.random() * allFrameworks.length)]?.id || 'F1',
              source: 'groq', diagnosis: {}
            });
          });
          TQE.postProcessQuestions(mapped);
          exam.questions = exam.questions.concat(mapped);
          cacheQuestions(promptMod.id, 3, mapped);
          if(scopeEl) scopeEl.textContent = '已生成 ' + exam.questions.length + ' / ' + targetTotal + ' 題...';
        }).catch(function(e){
          console.warn('Exam batch failed:', e.message);
        }).then(function(){
          if(batchIdx < batches - 1) return new Promise(function(r){ setTimeout(r, 2000); });
        });
      });
    })(b);
  }

  chain.then(function(){
    // Try cached from first module if still short
    if(exam.questions.length < targetTotal){
      return loadCachedQuestions(promptMod.id, 3, targetTotal - exam.questions.length).then(function(cached){
        exam.questions = exam.questions.concat(cached);
      });
    }
  }).then(function(){
    if(scopeEl) scopeEl.textContent = '組卷完成！共 ' + exam.questions.length + ' 題';

    // Shuffle
    for(var i = exam.questions.length - 1; i > 0; i--){
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = exam.questions[i]; exam.questions[i] = exam.questions[j]; exam.questions[j] = tmp;
    }

    exam.startTime = Date.now();
    exam.timerInterval = setInterval(updateExamTimer, 1000);
    updateExamTimer();
    renderExamQuestion();
  });
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

  // Subject info
  var subjects = TQE.getSubjects();
  var subject = exam.subjectId ? subjects.find(function(s){ return s.id === exam.subjectId; }) : null;
  var examTitle = subject ? subject.name : term('exam');

  var area = document.getElementById('tqeExamResultArea');
  if(!area) return;

  var html = '<div class="phase-header"><div class="phase-tag" style="background:' + (passed ? 'var(--green)' : 'var(--red)') + ';">' + TQE.escHtml(examTitle) + ' 結果</div>' +
    '<h2>' + (passed ? '通過！' : '未通過') + '</h2></div>';

  html += '<div style="display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;margin-bottom:1.5rem;">' +
    '<div class="card" style="min-width:140px;text-align:center;cursor:default;">' +
    '<div style="font-size:3rem;font-weight:900;color:' + (passed ? 'var(--green)' : 'var(--red)') + ';">' + score + '</div>' +
    '<div style="font-size:.85rem;color:var(--g600);">分數（70 及格）</div></div>' +
    '<div class="card" style="min-width:140px;text-align:center;cursor:default;">' +
    '<div style="font-size:2rem;font-weight:900;color:var(--blue);">' + correct + '/' + answered + '</div>' +
    '<div style="font-size:.85rem;color:var(--g600);">答對</div></div>' +
    '<div class="card" style="min-width:140px;text-align:center;cursor:default;">' +
    '<div style="font-size:2rem;font-weight:900;color:var(--gold);">' + elapsed + ' 分</div>' +
    '<div style="font-size:.85rem;color:var(--g600);">用時</div></div></div>';

  html += '<div class="info ' + (passed ? 'green' : 'red') + '" style="text-align:center;font-size:1.1rem;">' +
    '<strong>' + (passed ? '恭喜通過！預估真實考試及格率高' : '未達及格標準，建議回到弱項練習加強') + '</strong></div>';

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

    html += '<h3 style="margin:1.5rem 0 .8rem;">各概念掌握度</h3>';
    Object.keys(fwStats).forEach(function(fid){
      var s = fwStats[fid];
      if(s.total === 0) return;
      var pct = Math.round(s.correct / s.total * 100);
      var color = pct >= 70 ? 'var(--green)' : pct >= 50 ? 'var(--gold)' : 'var(--red)';
      html += '<div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem;">' +
        '<span style="display:inline-block;min-width:50px;text-align:center;padding:.2rem .5rem;border-radius:8px;background:' + color + ';color:#fff;font-weight:700;font-size:.85rem;">' + pct + '%</span>' +
        '<div><strong>' + s.name + '</strong> <span style="color:var(--g400);font-size:.85rem;">' + s.correct + '/' + s.total + '</span></div></div>';
    });

    // Wrong questions review
    var wrongQs = exam.questions.filter(function(q){ return exam.answers[q.id] && exam.answers[q.id] !== q.correct; });
    if(wrongQs.length > 0){
      html += '<h3 style="margin:1.5rem 0 .8rem;">錯題回顧</h3>';
      wrongQs.slice(0, 15).forEach(function(q){
        var yourChoice = q.options.find(function(o){ return o.key === exam.answers[q.id]; });
        var correctChoice = q.options.find(function(o){ return o.key === q.correct; });
        html += '<div class="card" style="cursor:default;border-left:4px solid var(--red);margin-bottom:1rem;">' +
          '<p style="font-weight:700;font-size:.95rem;margin-bottom:.8rem;">' + q.stem + '</p>' +
          '<p style="font-size:.9rem;color:var(--red);margin-bottom:.3rem;"><strong>你選 ' + exam.answers[q.id] + '：</strong>' + (yourChoice ? yourChoice.text : '') + '</p>' +
          '<p style="font-size:.9rem;color:var(--green);margin-bottom:.5rem;"><strong>正確 ' + q.correct + '：</strong>' + (correctChoice ? correctChoice.text : '') + '</p>' +
          (q.explanation ? '<p style="font-size:.9rem;color:var(--navy);background:var(--blue-lt);padding:.5rem .8rem;border-radius:8px;margin-top:.5rem;"><strong>解析：</strong>' + q.explanation + '</p>' : '') +
          '</div>';
      });
    }
  }

  // Actions
  html += '<div style="text-align:center;margin-top:2rem;">' +
    '<button class="btn btn-primary" onclick="TQE_Layer2.goLayer2()" style="margin-right:.5rem;">回到弱項練習</button>' +
    '<button class="btn btn-secondary" onclick="location.reload()">返回首頁</button></div>';

  area.innerHTML = html;
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
