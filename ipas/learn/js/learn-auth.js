// iPAS 學習系統 — Firebase Auth（Google 登入，可選）
// 匿名用戶仍可使用，登入後可跨裝置同步進度

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';

const firebaseConfig = {
  apiKey: "AIzaSyA9c39MjsSfNmuigun9DnguUaLrM8x3JtM",
  authDomain: "ipas-s100-70a97.firebaseapp.com",
  databaseURL: "https://ipas-s100-70a97-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "ipas-s100-70a97",
  storageBucket: "ipas-s100-70a97.firebasestorage.app",
  messagingSenderId: "583978561603",
  appId: "1:583978561603:web:4376299cd2fa9c8dbca4f6"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

async function signIn() {
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    console.error('登入失敗:', e);
    if (e.code !== 'auth/popup-closed-by-user') {
      alert('登入失敗：' + (e.message || e.code));
    }
  }
}

async function signOutUser() {
  try { await signOut(auth); } catch (e) { console.error(e); }
}

onAuthStateChanged(auth, (user) => {
  const status = document.getElementById('auth-status');
  if (!status) return;
  if (user) {
    // 儲存到 localStorage 供其他 JS 讀
    localStorage.setItem('ipas_uid', user.uid);
    localStorage.setItem('ipas_user_name', user.displayName || '');
    localStorage.setItem('ipas_user_email', user.email || '');
    // 寫入 Firebase 使用者紀錄
    const dbUrl = firebaseConfig.databaseURL;
    fetch(`${dbUrl}/learn/users_profile/${user.uid}.json`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: user.displayName || '',
        email: user.email || '',
        lastLogin: Date.now()
      })
    }).catch(() => {});

    const avatar = user.photoURL ? `<img src="${user.photoURL}" class="avatar">` : '';
    status.innerHTML = `
      <div class="user-info">
        ${avatar}
        <span class="user-name">${user.displayName || '學員'}</span>
        <button class="btn-signout" onclick="LearnAuth.signOut()">登出</button>
      </div>
    `;
  } else {
    localStorage.removeItem('ipas_uid');
    localStorage.removeItem('ipas_user_name');
    localStorage.removeItem('ipas_user_email');
    status.innerHTML = `
      <button class="btn-google" onclick="LearnAuth.signIn()">
        <svg width="16" height="16" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.5-5.2l-6.2-5.2c-2 1.5-4.6 2.4-7.3 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4 5.6l6.2 5.2C41.3 35.1 44 30 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>
        使用 Google 登入（追蹤學習進度）
      </button>
      <span class="auth-hint">匿名也可直接使用</span>
    `;
  }
});

window.LearnAuth = { signIn, signOut: signOutUser };
