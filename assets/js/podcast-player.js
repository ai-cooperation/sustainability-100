/**
 * Global Podcast Player — persistent bottom bar with background playback.
 *
 * Features:
 * - Auto-play next episode
 * - Remember position across sessions (localStorage)
 * - Language toggle (中/EN)
 * - Media Session API for mobile lock-screen controls
 * - Resume from last position on page load
 */
(function () {
  'use strict';

  // ── Config ──
  var STORAGE_KEY = 's100-pod';
  var SAVE_INTERVAL = 5; // seconds between auto-saves

  // ── Elements ──
  var el = {};
  var audio;

  // ── State ──
  var state = {
    idx: -1,       // current PLAYLIST index
    lang: 'zh',    // 'zh' or 'en'
    pos: 0,        // playback position (seconds)
    rate: 1,       // playback rate
    ts: 0          // last save timestamp
  };
  var isPlaying = false;
  var lastSaveTime = 0;
  var resumeBanner = null;

  // ── Init ──
  function init() {
    if (typeof PLAYLIST === 'undefined' || !PLAYLIST.length) return;

    el.gp = document.getElementById('gp');
    audio = document.getElementById('gp-audio');
    el.play = document.getElementById('gp-play');
    el.prev = document.getElementById('gp-prev');
    el.next = document.getElementById('gp-next');
    el.title = document.getElementById('gp-title');
    el.cur = document.getElementById('gp-cur');
    el.dur = document.getElementById('gp-dur');
    el.progress = document.getElementById('gp-progress');
    el.fill = document.getElementById('gp-progress-fill');
    el.lang = document.getElementById('gp-lang');
    el.speed = document.getElementById('gp-speed');
    el.close = document.getElementById('gp-close');

    if (!audio || !el.gp) return;

    bindEvents();
    restoreState();
  }

  // ── Event binding ──
  function bindEvents() {
    el.play.addEventListener('click', togglePlay);
    el.prev.addEventListener('click', prevEpisode);
    el.next.addEventListener('click', nextEpisode);
    el.lang.addEventListener('click', toggleLang);
    el.close.addEventListener('click', closePlayer);

    el.speed.addEventListener('change', function () {
      state.rate = parseFloat(this.value);
      audio.playbackRate = state.rate;
      saveState();
    });

    // Progress bar seek
    el.progress.addEventListener('click', function (e) {
      if (!audio.duration) return;
      var rect = el.progress.getBoundingClientRect();
      var pct = (e.clientX - rect.left) / rect.width;
      pct = Math.max(0, Math.min(1, pct));
      audio.currentTime = pct * audio.duration;
    });

    // Audio events
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', function () {
      el.dur.textContent = fmtTime(audio.duration);
      updateMediaPosition();
    });
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('play', function () {
      isPlaying = true;
      showPlayIcon(false);
      updateMediaSession();
    });
    audio.addEventListener('pause', function () {
      isPlaying = false;
      showPlayIcon(true);
      saveState();
    });

    // Save before page unload
    window.addEventListener('beforeunload', saveState);

    // Wire inline episode player buttons to global player
    wireInlinePlayers();
  }

  // ── Playback ──
  function loadEpisode(idx, lang, startPos) {
    if (idx < 0 || idx >= PLAYLIST.length) return;
    var ep = PLAYLIST[idx];
    var src = lang === 'en' ? ep.en : ep.zh;

    // Fallback if chosen language not available
    if (!src) {
      src = lang === 'en' ? ep.zh : ep.en;
      lang = lang === 'en' ? 'zh' : 'en';
    }
    if (!src) return;

    state.idx = idx;
    state.lang = lang;
    state.pos = startPos || 0;

    audio.src = src;
    audio.playbackRate = state.rate;
    if (startPos) {
      audio.currentTime = startPos;
    }

    // Update UI
    el.title.textContent = ep.id + '  ' + ep.title;
    el.title.href = ep.url;
    el.lang.textContent = lang === 'zh' ? '中' : 'EN';
    el.cur.textContent = fmtTime(state.pos);
    el.dur.textContent = '0:00';
    el.fill.style.width = '0%';

    showPlayer();
    updateMediaSession();
    saveState();
  }

  function playEpisode(idx, lang) {
    loadEpisode(idx, lang || state.lang, 0);
    audio.play().catch(function () {});
  }

  function togglePlay() {
    if (state.idx < 0) {
      // Nothing loaded — start from first episode
      playEpisode(0, state.lang);
      return;
    }
    if (audio.paused) {
      audio.play().catch(function () {});
    } else {
      audio.pause();
    }
  }

  function nextEpisode() {
    var next = state.idx + 1;
    if (next >= PLAYLIST.length) return;
    playEpisode(next, state.lang);
  }

  function prevEpisode() {
    // If more than 3 seconds in, restart current episode
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    var prev = state.idx - 1;
    if (prev < 0) return;
    playEpisode(prev, state.lang);
  }

  function toggleLang() {
    var newLang = state.lang === 'zh' ? 'en' : 'zh';
    var ep = PLAYLIST[state.idx];
    if (!ep) return;

    var src = newLang === 'en' ? ep.en : ep.zh;
    if (!src) return; // language not available

    var pos = audio.currentTime || 0;
    var wasPlaying = !audio.paused;

    state.lang = newLang;
    audio.src = src;
    audio.playbackRate = state.rate;
    audio.currentTime = pos;
    el.lang.textContent = newLang === 'zh' ? '中' : 'EN';

    if (wasPlaying) {
      audio.play().catch(function () {});
    }
    saveState();
    updateMediaSession();
  }

  function onEnded() {
    // Auto-play next episode
    var next = state.idx + 1;
    if (next < PLAYLIST.length) {
      playEpisode(next, state.lang);
    } else {
      isPlaying = false;
      showPlayIcon(true);
      saveState();
    }
  }

  function onTimeUpdate() {
    if (!audio.duration) return;
    var pct = (audio.currentTime / audio.duration) * 100;
    el.fill.style.width = pct + '%';
    el.cur.textContent = fmtTime(audio.currentTime);
    state.pos = audio.currentTime;

    // Throttled save
    var now = Date.now() / 1000;
    if (now - lastSaveTime > SAVE_INTERVAL) {
      lastSaveTime = now;
      saveState();
      updateMediaPosition();
    }
  }

  // ── UI ──
  function showPlayer() {
    el.gp.classList.remove('gp--hidden');
    document.body.classList.add('gp-active');
    // Remove resume banner if present
    if (resumeBanner) {
      resumeBanner.remove();
      resumeBanner = null;
    }
  }

  function closePlayer() {
    audio.pause();
    el.gp.classList.add('gp--hidden');
    document.body.classList.remove('gp-active');
    saveState();
  }

  function showPlayIcon(showPlay) {
    var iconPlay = el.play.querySelector('.gp-icon-play');
    var iconPause = el.play.querySelector('.gp-icon-pause');
    iconPlay.style.display = showPlay ? '' : 'none';
    iconPause.style.display = showPlay ? 'none' : '';
  }

  // ── Wire inline players on episode pages ──
  function wireInlinePlayers() {
    var players = document.querySelectorAll('.podcast-player');
    if (!players.length) return;

    // Detect current episode
    var epIdEl = document.querySelector('.episode-header h1');
    if (!epIdEl) return;
    var match = epIdEl.textContent.match(/EP(\d+)/);
    if (!match) return;
    var epNum = parseInt(match[1], 10);
    var epIdx = -1;
    for (var i = 0; i < PLAYLIST.length; i++) {
      if (PLAYLIST[i].n === epNum) { epIdx = i; break; }
    }
    if (epIdx < 0) return;

    players.forEach(function (player) {
      var lang = player.dataset.lang || 'zh';
      var playBtn = player.querySelector('.play-btn');
      if (!playBtn) return;

      // Clone to remove existing listeners
      var newBtn = playBtn.cloneNode(true);
      playBtn.parentNode.replaceChild(newBtn, playBtn);

      newBtn.addEventListener('click', function () {
        // If global player is on this episode+lang, just toggle
        if (state.idx === epIdx && state.lang === lang) {
          togglePlay();
        } else {
          playEpisode(epIdx, lang);
        }

        // Sync inline icon
        var inlineAudio = player.querySelector('audio');
        if (inlineAudio) inlineAudio.pause();
      });
    });
  }

  // ── Media Session API ──
  function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    var ep = PLAYLIST[state.idx];
    if (!ep) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: ep.id + ' ' + ep.title,
      artist: '低碳永續100講',
      album: ep.series + ' ' + ep.seriesName
    });

    navigator.mediaSession.setActionHandler('play', function () { audio.play(); });
    navigator.mediaSession.setActionHandler('pause', function () { audio.pause(); });
    navigator.mediaSession.setActionHandler('previoustrack', prevEpisode);
    navigator.mediaSession.setActionHandler('nexttrack', nextEpisode);
    navigator.mediaSession.setActionHandler('seekto', function (d) {
      audio.currentTime = d.seekTime;
    });
    navigator.mediaSession.setActionHandler('seekbackward', function (d) {
      audio.currentTime = Math.max(audio.currentTime - (d.seekOffset || 10), 0);
    });
    navigator.mediaSession.setActionHandler('seekforward', function (d) {
      audio.currentTime = Math.min(audio.currentTime + (d.seekOffset || 30), audio.duration || 0);
    });
  }

  function updateMediaPosition() {
    if (!('mediaSession' in navigator) || !audio.duration) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate,
        position: audio.currentTime
      });
    } catch (e) {}
  }

  // ── Persistence ──
  function saveState() {
    if (state.idx < 0) return;
    try {
      state.ts = Math.floor(Date.now() / 1000);
      state.pos = audio.currentTime || state.pos;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {}
  }

  function restoreState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (!saved || saved.idx == null || saved.idx < 0) return;
      if (saved.idx >= PLAYLIST.length) return;

      // Restore state
      state.idx = saved.idx;
      state.lang = saved.lang || 'zh';
      state.pos = saved.pos || 0;
      state.rate = saved.rate || 1;

      // Set speed selector
      el.speed.value = String(state.rate);

      var ep = PLAYLIST[state.idx];
      if (!ep) return;

      // Show resume banner
      var ago = timeSince(saved.ts);
      showResumeBanner(ep, ago);
    } catch (e) {}
  }

  function showResumeBanner(ep, ago) {
    resumeBanner = document.createElement('div');
    resumeBanner.className = 'gp-resume';
    resumeBanner.innerHTML =
      '<strong>繼續收聽</strong> ' +
      ep.id + ' ' + ep.title +
      (ago ? ' <span style="opacity:0.7">(' + ago + ')</span>' : '') +
      ' <span style="opacity:0.7">▶</span>';

    resumeBanner.addEventListener('click', function () {
      loadEpisode(state.idx, state.lang, state.pos);
      audio.play().catch(function () {});
      resumeBanner.remove();
      resumeBanner = null;
    });

    document.body.appendChild(resumeBanner);
    document.body.classList.add('gp-active');
  }

  // ── Helpers ──
  function fmtTime(s) {
    if (!s || isNaN(s)) return '0:00';
    var m = Math.floor(s / 60);
    var sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function timeSince(ts) {
    if (!ts) return '';
    var diff = Math.floor(Date.now() / 1000) - ts;
    if (diff < 60) return '剛才';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分鐘前';
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小時前';
    return Math.floor(diff / 86400) + ' 天前';
  }

  // ── Public API (for inline players) ──
  window.PodcastPlayer = {
    play: function (epId, lang) {
      for (var i = 0; i < PLAYLIST.length; i++) {
        if (PLAYLIST[i].id === epId) {
          playEpisode(i, lang);
          return;
        }
      }
    },
    toggle: togglePlay,
    isActive: function () { return state.idx >= 0; }
  };

  // ── Boot ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
