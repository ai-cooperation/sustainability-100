// iPAS 三問法學習系統 — 引擎
// 負責：Firebase 連線、匿名 ID、三問法流程、題目渲染、進度追蹤

(function(global) {
  'use strict';

  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyA9c39MjsSfNmuigun9DnguUaLrM8x3JtM",
    authDomain: "ipas-s100-70a97.firebaseapp.com",
    databaseURL: "https://ipas-s100-70a97-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "ipas-s100-70a97",
    storageBucket: "ipas-s100-70a97.firebasestorage.app",
    messagingSenderId: "583978561603",
    appId: "1:583978561603:web:4376299cd2fa9c8dbca4f6"
  };

  const DB_URL = FIREBASE_CONFIG.databaseURL;

  // ========== 使用者識別（優先 Google uid，否則匿名 odID） ==========
  function getOrCreateOdID() {
    let id = localStorage.getItem('ipas_odID');
    if (!id) {
      id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      localStorage.setItem('ipas_odID', id);
    }
    return id;
  }

  function getUserId() {
    // 登入用戶回傳 uid (以 'g:' 開頭標記 Google 帳號)
    // 匿名用戶回傳 odID (以 'a:' 開頭標記)
    const uid = localStorage.getItem('ipas_uid');
    if (uid) return 'g:' + uid;
    return 'a:' + getOrCreateOdID();
  }

  function isAuthenticated() {
    return !!localStorage.getItem('ipas_uid');
  }

  // ========== Firebase REST API 包裝 ==========
  async function fbGet(path) {
    try {
      const res = await fetch(`${DB_URL}/${path}.json`);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      console.error('fbGet error:', path, e);
      return null;
    }
  }

  async function fbPut(path, data) {
    try {
      const res = await fetch(`${DB_URL}/${path}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return res.ok;
    } catch (e) {
      console.error('fbPut error:', path, e);
      return false;
    }
  }

  async function fbPatch(path, data) {
    try {
      const res = await fetch(`${DB_URL}/${path}.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return res.ok;
    } catch (e) {
      console.error('fbPatch error:', path, e);
      return false;
    }
  }

  // ========== 進度管理（local + Firebase） ==========
  function getProgress() {
    try {
      return JSON.parse(localStorage.getItem('ipas_progress') || '{}');
    } catch { return {}; }
  }

  function saveProgress(progress) {
    localStorage.setItem('ipas_progress', JSON.stringify(progress));
  }

  async function recordAnswer(level, moduleId, qId, correct, chosen) {
    // 1. local 進度
    const progress = getProgress();
    const key = `${level}.${moduleId}`;
    if (!progress[key]) progress[key] = { done: {}, correct: 0, total: 0 };
    progress[key].done[qId] = { correct, chosen, ts: Date.now() };
    progress[key].total = Object.keys(progress[key].done).length;
    progress[key].correct = Object.values(progress[key].done).filter(x => x.correct).length;
    saveProgress(progress);

    // 2. Firebase 盲區統計（全體聚合）
    const statsPath = `learn/analytics/questions/${level}/${moduleId}/${qId}`;
    const cur = await fbGet(statsPath) || { attempts: 0, correct: 0, wrong_choices: {} };
    cur.attempts = (cur.attempts || 0) + 1;
    if (correct) cur.correct = (cur.correct || 0) + 1;
    else {
      cur.wrong_choices = cur.wrong_choices || {};
      cur.wrong_choices[chosen] = (cur.wrong_choices[chosen] || 0) + 1;
    }
    await fbPut(statsPath, cur);

    // 3. 使用者進度（登入用戶存 authed/，匿名存 anon/）
    const userId = getUserId();
    const userKey = userId.startsWith('g:') ? 'authed/' + userId.slice(2) : 'anon/' + userId.slice(2);
    await fbPatch(`learn/users/${userKey}/${level}/${moduleId}`, {
      [qId]: { correct, chosen, ts: Date.now() }
    });
  }

  // ========== 題目回報 ==========
  async function reportQuestion(level, moduleId, qId, reason) {
    const reportPath = `learn/analytics/reports/${level}_${moduleId}_${qId}_${Date.now()}`;
    return await fbPut(reportPath, {
      level, moduleId, qId, reason,
      by: getUserId(), ts: Date.now()
    });
  }

  // ========== 概念維度分析 ==========
  const META_TAGS = new Set(['陷阱','跨章','情境','計算','加強','絕對語','考古題']);

  function getQuestionConcepts(question, concepts) {
    if (!question.tag || !concepts) return [];
    const qTags = question.tag.filter(t => !META_TAGS.has(t));
    const result = [];
    for (let c = 0; c < concepts.length; c++) {
      for (let t = 0; t < concepts[c].tags.length; t++) {
        if (qTags.indexOf(concepts[c].tags[t]) !== -1) {
          result.push(concepts[c].id);
          break;
        }
      }
    }
    return result;
  }

  function getWeakConcepts(level, moduleId) {
    const mods = (LEARN_DATA[level] && LEARN_DATA[level].modules) || [];
    const mod = mods.find(m => m.id === moduleId);
    if (!mod || !mod.concepts) return { concepts: [], scores: {} };

    const progress = getProgress();
    const key = level + '.' + moduleId;
    const done = (progress[key] && progress[key].done) || {};

    const allQs = [...(mod.questions || []), ...(mod.reinforcement || [])];

    const scores = {};
    for (let ci = 0; ci < mod.concepts.length; ci++) {
      scores[mod.concepts[ci].id] = { name: mod.concepts[ci].name, correct: 0, total: 0 };
    }

    for (let qi = 0; qi < allQs.length; qi++) {
      const q = allQs[qi];
      const answer = done[q.id];
      if (!answer) continue;
      const cids = getQuestionConcepts(q, mod.concepts);
      for (let k = 0; k < cids.length; k++) {
        if (scores[cids[k]]) {
          scores[cids[k]].total++;
          if (answer.correct) scores[cids[k]].correct++;
        }
      }
    }

    const weak = [];
    for (let wi = 0; wi < mod.concepts.length; wi++) {
      const s = scores[mod.concepts[wi].id];
      if (s.total > 0 && (s.correct / s.total) < 0.5) {
        weak.push(mod.concepts[wi].id);
      }
    }

    return { concepts: weak, scores };
  }

  // ========== 取得題目（先 static 再 Firebase cache） ==========
  async function getQuestions(level, moduleId) {
    const mod = (LEARN_DATA[level]?.modules || []).find(m => m.id === moduleId);
    const staticQs = [...(mod?.questions || []), ...(mod?.reinforcement || [])];
    // 從 Firebase 取 AI 生成的題目
    const cached = await fbGet(`learn/question_pool/${level}/${moduleId}`);
    const cachedQs = cached ? Object.values(cached) : [];
    return [...staticQs, ...cachedQs];
  }

  // ========== 公開 API ==========
  global.LearnEngine = {
    getOrCreateOdID,
    getUserId,
    isAuthenticated,
    getProgress,
    recordAnswer,
    reportQuestion,
    getQuestions,
    getQuestionConcepts,
    getWeakConcepts,
    fbGet, fbPut, fbPatch,
    DB_URL
  };

})(window);
