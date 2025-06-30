// employee.js - 従業員ページの機能（完全版 - 日付修正版）


// 現在のユーザー情報とグローバル変数
let currentUser = null;
let dailyLimitProcessing = false;

// テナント対応のFirestoreコレクション取得関数（main.jsの統一関数を使用）
function getAttendanceCollection() {
    return window.getTenantFirestore ? window.getTenantFirestore('attendance') : firebase.firestore().collection('attendance');
}

function getBreaksCollection() {
    return window.getTenantFirestore ? window.getTenantFirestore('breaks') : firebase.firestore().collection('breaks');
}

// 変数監視用のプロキシ設定
let _todayAttendanceData = null;
let _currentAttendanceId = null;

// todayAttendanceDataの監視
Object.defineProperty(window, 'todayAttendanceData', {
    get: function() {
        return _todayAttendanceData;
    },
    set: function(value) {
        _todayAttendanceData = value;
    }
});

// currentAttendanceIdの監視
Object.defineProperty(window, 'currentAttendanceId', {
    get: function() {
        return _currentAttendanceId;
    },
    set: function(value) {
        _currentAttendanceId = value;
    }
});

// 🆕 日本時間で確実に今日の日付を取得する関数
function getTodayJST() {
    const now = new Date();
    
    // 日本時間で確実に計算（UTC + 9時間）
    const jstDate = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + (9 * 3600000));
    const today = jstDate.toISOString().split('T')[0];
    
    
    return today;
}

// 🔧 日付と現場設定の復元機能
function restoreDateAndSiteSettings() {
    
    try {
        // LocalStorageから最後に選択した現場名を復元
        const savedSiteName = localStorage.getItem('lastSelectedSite');
        if (savedSiteName) {
            const siteSelect = document.getElementById('site-name');
            if (siteSelect) {
                // 保存された現場名がオプションに存在するかチェック
                const option = Array.from(siteSelect.options).find(opt => opt.value === savedSiteName);
                if (option) {
                    siteSelect.value = savedSiteName;
                } else {
                }
            }
        }
        
        // LocalStorageから最後に入力したメモを復元
        const savedNotes = localStorage.getItem('lastWorkNotes');
        if (savedNotes) {
            const notesTextarea = document.getElementById('work-notes');
            if (notesTextarea) {
                notesTextarea.value = savedNotes;
            }
        }
        
        
    } catch (error) {
    }
}

// 🔧 設定を保存する関数
function saveDateAndSiteSettings() {
    try {
        // 現在選択されている現場名を保存
        const siteSelect = document.getElementById('site-name');
        if (siteSelect && siteSelect.value && siteSelect.value !== '') {
            localStorage.setItem('lastSelectedSite', siteSelect.value);
        }
        
        // 現在のメモを保存
        const notesTextarea = document.getElementById('work-notes');
        if (notesTextarea && notesTextarea.value.trim()) {
            localStorage.setItem('lastWorkNotes', notesTextarea.value);
        }
        
    } catch (error) {
    }
}

// 🔧 現場選択変更の処理
function handleSiteSelection() {
    
    try {
        const siteSelect = document.getElementById('site-name');
        const manualInput = document.getElementById('site-name-manual');
        
        if (!siteSelect || !manualInput) {
            return;
        }
        
        if (siteSelect.value === 'manual-input') {
            // 手動入力モードの場合
            manualInput.style.display = 'block';
            manualInput.required = true;
            manualInput.focus();
        } else {
            // 選択モードの場合
            manualInput.style.display = 'none';
            manualInput.required = false;
            manualInput.value = '';
            
            // 選択した現場名を保存
            saveDateAndSiteSettings();
        }
        
    } catch (error) {
    }
}

// 注意: initEmployeePage関数はファイル末尾で定義されています

// 🔧 修正版 restoreTodayAttendanceState関数（日付修正）
async function restoreTodayAttendanceState() {
    
    try {
        if (!currentUser) {
            return;
        }
        
        // 🎯 修正: JST確実取得
        const today = getTodayJST();
        
        
        // 今日のデータのみを検索
        const todayQuery = getAttendanceCollection()
            .where('userId', '==', currentUser.uid)
            .where('date', '==', today);
        
        const todaySnapshot = await todayQuery.get();
        
        
        if (!todaySnapshot.empty) {
            // 今日のデータが見つかった場合
            let latestRecord = null;
            let latestDoc = null;
            
            todaySnapshot.docs.forEach(doc => {
                const data = doc.data();
                
                if (!latestRecord || 
                    (data.createdAt && (!latestRecord.createdAt || data.createdAt > latestRecord.createdAt))) {
                    latestRecord = data;
                    latestDoc = doc;
                }
            });
            
            // 今日のデータを復元
            currentAttendanceId = latestDoc.id;
            todayAttendanceData = {
                id: latestDoc.id,
                ...latestRecord
            };
            
            await restoreCurrentState(latestRecord);
            
        } else {
            // 今日のデータがない場合は新規出勤待ち状態
            
            currentAttendanceId = null;
            todayAttendanceData = null;
            updateClockButtons('waiting');
            updateStatusDisplay('waiting', null);
        }
        
        // データ設定後の確認
        setTimeout(() => {
            // Debug info available if needed
        }, 100);
        
    } catch (error) {
        
        // エラー時はデフォルト状態
        currentAttendanceId = null;
        todayAttendanceData = null;
        updateClockButtons('waiting');
        updateStatusDisplay('waiting', null);
    }
}

// 現在の状態を復元
async function restoreCurrentState(recordData) {
    
    try {
        // 勤務完了チェック
        if (recordData.endTime || recordData.status === 'completed') {
            updateClockButtons('completed');
            updateStatusDisplay('completed', recordData);
            return;
        }
        
        // 休憩中かどうかチェック
        const breakQuery = getBreaksCollection()
            .where('attendanceId', '==', currentAttendanceId)
            .where('userId', '==', currentUser.uid);
        
        const breakSnapshot = await breakQuery.get();
        
        // アクティブな休憩を検索
        let activeBreakData = null;
        breakSnapshot.docs.forEach(doc => {
            const breakData = doc.data();
            if (!breakData.endTime) {
                activeBreakData = breakData;
            }
        });
        
        if (activeBreakData) {
            updateClockButtons('break');
            updateStatusDisplay('break', recordData, activeBreakData);
        } else {
            updateClockButtons('working');
            updateStatusDisplay('working', recordData);
        }
        
        // 🎯 重要：状態復元後に強制的にボタン表示を更新
        setTimeout(() => {
            const currentStatus = activeBreakData ? 'break' : 'working';
            updateClockButtons(currentStatus);
        }, 100);
        
    } catch (error) {
        updateClockButtons('working');
        updateStatusDisplay('working', recordData);
    }
}

// 🔧 修正版 1日1回制限チェック（制限解除）
async function checkDailyLimit(userId) {
    
    // 🎯 修正: JST確実取得
    const today = getTodayJST();
    
    try {
        // メモリ内チェック（既存データの復元のみ）
        if (todayAttendanceData && todayAttendanceData.date === today) {
            await restoreCurrentState(todayAttendanceData);
            return true; // 制限を解除し、常に打刻を許可
        }
        
        // データベースチェック（既存データの復元のみ）
        const query = getAttendanceCollection()
            .where('userId', '==', userId)
            .where('date', '==', today);
        
        const snapshot = await query.get();
        
        if (!snapshot.empty) {
            const existingRecord = snapshot.docs[0].data();
            
            // グローバル変数を更新
            todayAttendanceData = {
                id: snapshot.docs[0].id,
                ...existingRecord
            };
            currentAttendanceId = snapshot.docs[0].id;
            
            await restoreCurrentState(existingRecord);
            return true; // 制限を解除し、常に打刻を許可
        }
        
        return true; // 制限を解除し、常に打刻を許可
        
    } catch (error) {
        console.error('出勤チェック中にエラーが発生しました:', error);
        return true; // エラー時も打刻を許可
    }
}

// 状態テキスト変換
function getStatusText(status) {
    
    const statusMap = {
        'working': '勤務中',
        'break': '休憩中', 
        'completed': '勤務完了',
        'pending': '処理中',
        'unknown': '不明',
        '': '不明',
        null: '不明',
        undefined: '不明'
    };
    
    // より堅牢な日本語化処理
    if (!status) {
        return '不明';
    }
    
    const lowerStatus = String(status).toLowerCase();
    const result = statusMap[lowerStatus] || statusMap[status] || '不明';
    
    return result;
}

// ユーザー名の表示
function displayUserName() {
    const userNameElement = document.getElementById('user-name');
    if (userNameElement && currentUser) {
        userNameElement.textContent = currentUser.displayName || currentUser.email || 'ユーザー';
    }
}

// 現在時刻の更新
function updateCurrentTime() {
    const now = new Date();
    
    const dateElement = document.getElementById('current-date');
    const timeElement = document.getElementById('current-time');
    
    if (dateElement) {
        dateElement.textContent = now.toLocaleDateString('ja-JP', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long'
        });
    }
    
    if (timeElement) {
        timeElement.textContent = now.toLocaleTimeString('ja-JP');
    }
}

// イベントリスナーの設定
function setupEmployeeEventListeners() {
    
    const clockInBtn = document.getElementById('clock-in-btn');
    const clockOutBtn = document.getElementById('clock-out-btn');
    const breakStartBtn = document.getElementById('break-start-btn');
    const breakEndBtn = document.getElementById('break-end-btn');
    const logoutBtn = document.getElementById('logout-btn');
    
    if (clockInBtn) clockInBtn.addEventListener('click', handleClockIn);
    if (clockOutBtn) clockOutBtn.addEventListener('click', handleClockOut);
    if (breakStartBtn) breakStartBtn.addEventListener('click', handleBreakStart);
    if (breakEndBtn) breakEndBtn.addEventListener('click', handleBreakEnd);
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
    
}

// 現場選択の設定（直接入力対応）
function setupSiteSelection() {
    // 直接入力に変更したため、特別な設定は不要
}

// サイト一覧を読み込み（テナント設定から）
async function loadSiteOptions() {
    try {
        const tenantId = window.getCurrentTenantId ? window.getCurrentTenantId() : null;
        if (!tenantId) {
            return;
        }
        
        const sites = await window.getTenantSites(tenantId);
        console.log('loadSiteOptions - 取得した現場データ:', sites);
        
        const siteSelect = document.getElementById('site-name');
        console.log('loadSiteOptions - セレクト要素:', siteSelect);
        console.log('loadSiteOptions - 現在のオプション数:', siteSelect?.children.length);
        
        if (siteSelect && sites && sites.length > 0) {
            // 既存のオプションをクリア（最初の1つ「現場を選択してください」のみ残す）
            while (siteSelect.children.length > 1) {
                siteSelect.removeChild(siteSelect.lastChild);
            }
            
            // アクティブなサイトのみを追加（重複チェック付き）
            const activeSites = sites.filter(site => site.active);
            const addedSiteNames = new Set(); // 重複チェック用
            
            activeSites.forEach(site => {
                // 重複チェック
                if (!addedSiteNames.has(site.name)) {
                    addedSiteNames.add(site.name);
                    
                    const option = document.createElement('option');
                    option.value = site.name;
                    option.textContent = `🏢 ${site.name}`;
                    if (site.address) {
                        option.textContent += ` (${site.address})`;
                    }
                    siteSelect.appendChild(option);
                }
            });
            
        }
    } catch (error) {
    }
}

// サイト選択の変更イベント（手動入力は削除済み）
function setupSiteSelection() {
    // 手動入力機能は削除されました
    // 管理者が事前に設定した現場のみ選択可能
}

// 現場名取得関数（管理者設定現場のみ）
function getSiteNameFromSelection() {
    const siteSelect = document.getElementById('site-name');
    
    if (!siteSelect) {
        alert('現場名選択フォームに問題があります。\nページを再読み込みしてください。');
        return null;
    }
    
    const siteName = siteSelect.value.trim();
    if (!siteName) {
        alert('⚠️ 現場を選択してください');
        siteSelect.focus();
        return null;
    }
    
    return siteName;
}

// 🔧 修正版 handleClockIn関数（日付修正完全版）
async function handleClockIn() {
    
    // 二重実行防止
    if (dailyLimitProcessing) {
        alert('処理中です。しばらくお待ちください。');
        return;
    }
    
    dailyLimitProcessing = true;
    
    // ボタンを即座に無効化
    const clockInBtn = document.getElementById('clock-in-btn');
    const originalText = clockInBtn ? clockInBtn.textContent : '出勤';
    
    // ボタン状態を保存・変更する関数
    function setButtonProcessing() {
        if (clockInBtn) {
            clockInBtn.disabled = true;
            clockInBtn.textContent = '処理中...';
            clockInBtn.style.opacity = '0.5';
        }
    }
    
    // ボタン状態を復元する関数
    function restoreButton() {
        if (clockInBtn) {
            clockInBtn.disabled = false;
            clockInBtn.textContent = originalText;
            clockInBtn.style.opacity = '1';
        }
        dailyLimitProcessing = false;
    }
    
    setButtonProcessing();
    
    try {
        if (!currentUser) {
            throw new Error('ユーザーが認証されていません');
        }
        
        // 🚨 重要：1日1回制限チェック
        const canClockIn = await checkDailyLimit(currentUser.uid);
        if (!canClockIn) {
            restoreButton();
            return;
        }
        
        // 現場選択チェック
        const siteName = getSiteNameFromSelection();
        
        if (!siteName) {
            restoreButton();
            return;
        }
        
        // 🎯 日付生成を修正（JST確実対応）
        const now = new Date();
        
        // 🆕 修正: getTodayJST()を使用
        const today = getTodayJST();
        
        // デバッグ用ログ available if needed
        
        const workNotesElement = document.getElementById('work-notes');
        const workNotes = workNotesElement ? workNotesElement.value.trim() : '';
        
        const attendanceData = {
            userId: currentUser.uid,
            userEmail: currentUser.email,
            date: today,  // 🎯 修正された日付
            siteName: siteName,
            startTime: now.toLocaleTimeString('ja-JP'),
            status: 'working',
            notes: workNotes,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            // デバッグ用
            clientTimestamp: now.toISOString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        };
        
        
        // Firestoreに保存
        const docRef = await getAttendanceCollection()
            .add(attendanceData);
        
        
        // グローバル変数更新
        currentAttendanceId = docRef.id;
        todayAttendanceData = {
            id: docRef.id,
            ...attendanceData,
            createdAt: now,
            updatedAt: now
        };
        
        // UI更新
        updateClockButtons('working');
        updateStatusDisplay('working', todayAttendanceData);
        
        alert(`✅ 出勤しました！\n現場: ${siteName}\n時刻: ${attendanceData.startTime}\n日付: ${today}`);
        
        // フォームをクリア
        if (workNotesElement) workNotesElement.value = '';
        
        // 最近の記録を更新
        loadRecentRecordsSafely();
        
        // 処理完了
        dailyLimitProcessing = false;
        
    } catch (error) {
        alert('出勤処理中にエラーが発生しました。\n' + error.message);
        
        restoreButton();
    }
}

// 退勤処理（1日1回制限対応）
async function handleClockOut() {
    
    try {
        if (!currentUser || !currentAttendanceId) {
            alert('出勤記録が見つかりません');
            return;
        }
        
        const now = new Date();
        
        const updateData = {
            endTime: now.toLocaleTimeString('ja-JP'),
            status: 'completed',
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        
        await getAttendanceCollection()
            .doc(currentAttendanceId)
            .update(updateData);
        
        
        // グローバル変数更新
        todayAttendanceData = {
            ...todayAttendanceData,
            endTime: now.toLocaleTimeString('ja-JP'),
            status: 'completed'
        };
        
        // UI更新
        updateClockButtons('completed');
        updateStatusDisplay('completed', todayAttendanceData);
        
        alert('お疲れさまでした！');
        
        // 最近の記録を更新
        loadRecentRecordsSafely();
        
    } catch (error) {
        alert('退勤記録でエラーが発生しました: ' + error.message);
    }
}

// 🔧 修正版 休憩開始処理（日付修正）
async function handleBreakStart() {
    
    try {
        if (!currentUser || !currentAttendanceId) {
            alert('出勤記録が見つかりません');
            return;
        }
        
        // 既存の休憩記録チェック
        const breakQuery = getBreaksCollection()
            .where('attendanceId', '==', currentAttendanceId)
            .where('userId', '==', currentUser.uid);
        
        const breakSnapshot = await breakQuery.get();
        
        // アクティブな休憩があるかチェック
        let hasActiveBreak = false;
        breakSnapshot.docs.forEach(doc => {
            const breakData = doc.data();
            if (!breakData.endTime) {
                hasActiveBreak = true;
            }
        });
        
        if (hasActiveBreak) {
            alert('既に休憩中です');
            return;
        }
        
        const now = new Date();
        
        const breakData = {
            attendanceId: currentAttendanceId,
            userId: currentUser.uid,
            startTime: now.toLocaleTimeString('ja-JP'),
            date: getTodayJST(), // 🎯 修正: JST確実取得
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        await getBreaksCollection()
            .add(breakData);
        
        // 勤怠記録のステータスを更新
        await getAttendanceCollection()
            .doc(currentAttendanceId)
            .update({ 
                status: 'break',
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        
        // グローバル変数更新
        todayAttendanceData.status = 'break';
        
        alert('休憩を開始しました');
        updateClockButtons('break');
        updateStatusDisplay('break', todayAttendanceData, breakData);
        
    } catch (error) {
        alert('休憩記録でエラーが発生しました: ' + error.message);
    }
}

// 休憩終了処理
async function handleBreakEnd() {
    
    try {
        if (!currentUser || !currentAttendanceId) {
            alert('出勤記録が見つかりません');
            return;
        }
        
        const breakQuery = getBreaksCollection()
            .where('attendanceId', '==', currentAttendanceId)
            .where('userId', '==', currentUser.uid);
        
        const breakSnapshot = await breakQuery.get();
        
        // アクティブな休憩記録を探す
        let activeBreakDoc = null;
        breakSnapshot.docs.forEach(doc => {
            const breakData = doc.data();
            if (!breakData.endTime) {
                activeBreakDoc = doc;
            }
        });
        
        if (activeBreakDoc) {
            const now = new Date();
            
            await activeBreakDoc.ref.update({
                endTime: now.toLocaleTimeString('ja-JP'),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
        } else {
            alert('休憩記録が見つかりませんでした');
            return;
        }
        
        // 勤怠記録のステータスを勤務中に戻す
        await getAttendanceCollection()
            .doc(currentAttendanceId)
            .update({ 
                status: 'working',
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        
        // グローバル変数更新
        todayAttendanceData.status = 'working';
        
        alert('休憩を終了しました');
        updateClockButtons('working');
        updateStatusDisplay('working', todayAttendanceData);
        
    } catch (error) {
        alert('休憩終了記録でエラーが発生しました: ' + error.message);
    }
}

// updateClockButtons関数
function updateClockButtons(status) {
    
    const clockInBtn = document.getElementById('clock-in-btn');
    const clockOutBtn = document.getElementById('clock-out-btn');
    const breakStartBtn = document.getElementById('break-start-btn');
    const breakEndBtn = document.getElementById('break-end-btn');
    
    // 全ボタンの特殊クラスをリセット
    [clockInBtn, clockOutBtn, breakStartBtn, breakEndBtn].forEach(btn => {
        if (btn) {
            btn.classList.remove('break-active', 'processing');
            btn.disabled = false;
        }
    });
    
    switch (status) {
        case 'waiting':
            // 出勤ボタンのみ有効
            if (clockInBtn) {
                clockInBtn.disabled = false;
                clockInBtn.textContent = '出勤';
            }
            if (clockOutBtn) {
                clockOutBtn.disabled = true;
                clockOutBtn.textContent = '退勤';
            }
            if (breakStartBtn) {
                breakStartBtn.disabled = true;
                breakStartBtn.textContent = '休憩開始';
            }
            if (breakEndBtn) {
                breakEndBtn.disabled = true;
                breakEndBtn.textContent = '休憩終了';
            }
            break;
            
        case 'working':
            // 出勤済み、退勤・休憩開始が有効
            if (clockInBtn) {
                clockInBtn.disabled = true;
                clockInBtn.textContent = '出勤済み';
            }
            if (clockOutBtn) {
                clockOutBtn.disabled = false;
                clockOutBtn.textContent = '退勤';
            }
            if (breakStartBtn) {
                breakStartBtn.disabled = false;
                breakStartBtn.textContent = '休憩開始';
            }
            if (breakEndBtn) {
                breakEndBtn.disabled = true;
                breakEndBtn.textContent = '休憩終了';
            }
            break;
            
        case 'break':
            // 出勤済み、退勤・休憩終了が有効
            if (clockInBtn) {
                clockInBtn.disabled = true;
                clockInBtn.textContent = '出勤済み';
            }
            if (clockOutBtn) {
                clockOutBtn.disabled = false;
                clockOutBtn.textContent = '退勤';
            }
            if (breakStartBtn) {
                breakStartBtn.disabled = true;
                breakStartBtn.textContent = '休憩中';
                breakStartBtn.classList.add('break-active'); // 🎨 特殊スタイル適用
            }
            if (breakEndBtn) {
                breakEndBtn.disabled = false;
                breakEndBtn.textContent = '休憩終了';
            }
            break;
            
        case 'completed':
            // 全ボタン無効（勤務完了）
            if (clockInBtn) {
                clockInBtn.disabled = true;
                clockInBtn.textContent = '本日勤務完了';
            }
            if (clockOutBtn) {
                clockOutBtn.disabled = true;
                clockOutBtn.textContent = '退勤済み';
            }
            if (breakStartBtn) {
                breakStartBtn.disabled = true;
                breakStartBtn.textContent = '勤務終了';
            }
            if (breakEndBtn) {
                breakEndBtn.disabled = true;
                breakEndBtn.textContent = '勤務終了';
            }
            break;
    }
    
    // 🎯 強制的にスタイルを再適用（キャッシュ問題対策）
    setTimeout(() => {
        [clockInBtn, clockOutBtn, breakStartBtn, breakEndBtn].forEach(btn => {
            if (btn) {
                // フォーカスを一瞬当てて外してスタイル更新を強制
                const originalTabIndex = btn.tabIndex;
                btn.tabIndex = -1;
                btn.focus();
                btn.blur();
                btn.tabIndex = originalTabIndex;
            }
        });
    }, 50);
    
}

// ステータス表示更新
function updateStatusDisplay(status, attendanceData, breakData = null) {
    const clockStatus = document.getElementById('clock-status');
    
    if (clockStatus) {
        let statusHtml = '';
        
        switch (status) {
            case 'working':
                statusHtml = `
                    <div class="status-working">
                        <h4>💼 勤務中です</h4>
                        <p>現場: ${attendanceData.siteName}</p>
                        <p>出勤時刻: ${attendanceData.startTime}</p>
                    </div>
                `;
                break;
                
            case 'break':
                statusHtml = `
                    <div class="status-break">
                        <h4>⏸️ 休憩中です</h4>
                        <p>現場: ${attendanceData.siteName}</p>
                        <p>休憩開始: ${breakData ? breakData.startTime : '不明'}</p>
                    </div>
                `;
                break;
                
            case 'completed':
                statusHtml = `
                    <div class="status-completed">
                        <h4>✅ 本日は退勤済みです。</h4>
                        <p>現場: ${attendanceData.siteName}</p>
                        <p>勤務時間: ${attendanceData.startTime} - ${attendanceData.endTime}</p>
                        <p>お疲れさまでした。</p>
                    </div>
                `;
                break;
                
            default:
                statusHtml = `
                    <div class="status-waiting">
                        <h4>⏰ 出勤ボタンを押してください</h4>
                        <p>現場を選択して出勤してください</p>
                    </div>
                `;
        }
        
        clockStatus.innerHTML = statusHtml;
    }
}

// 最近の記録を安全に読み込み（直近3日間のみ）
async function loadRecentRecordsSafely() {
    console.log('loadRecentRecordsSafely called');
    
    const recentList = document.getElementById('recent-list');
    if (!recentList) {
        console.error('recent-list element not found');
        return;
    }
    
    try {
        if (!currentUser) {
            console.log('currentUser not set, showing welcome message');
            showWelcomeMessage();
            return;
        }
        
        console.log('Loading records for user:', currentUser.uid);
        
        // 直近3日間の日付範囲を計算
        const today = getTodayJST();
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 2); // 今日含めて3日間
        const threeDaysAgoString = threeDaysAgo.toISOString().split('T')[0];
        
        
        // インデックス不要の簡素化クエリ（ユーザーIDのみでフィルター）
        const query = getAttendanceCollection()
            .where('userId', '==', currentUser.uid)
            .limit(20); // 多めに取得してクライアント側でフィルター
        
        const snapshot = await query.get();
        console.log('Query completed, docs found:', snapshot.size);
        
        // クライアント側で直近3日間でフィルター
        const filteredDocs = [];
        snapshot.docs.forEach(doc => {
            const data = doc.data();
            const recordDate = data.date;
            console.log('Processing record:', { id: doc.id, date: recordDate });
            if (recordDate && recordDate >= threeDaysAgoString && recordDate <= today) {
                filteredDocs.push(doc);
            }
        });
        
        console.log('Filtered docs:', filteredDocs.length);
        
        // 擬似的なsnapshot作成
        const filteredSnapshot = {
            empty: filteredDocs.length === 0,
            size: filteredDocs.length,
            docs: filteredDocs
        };
        
        if (filteredSnapshot.empty) {
            console.log('No recent records found, showing welcome message');
            showWelcomeMessage();
            return;
        }
        
        console.log('Displaying records');
        displayRecentRecords(filteredSnapshot);
        
    } catch (error) {
        console.error('Error loading recent records:', error);
        handleRecordLoadError(error);
    }
}

// ウェルカムメッセージの表示
function showWelcomeMessage() {
    const recentList = document.getElementById('recent-list');
    if (recentList) {
        recentList.innerHTML = `
            <div class="welcome-message">
                <h4>🎯 勤怠システムへようこそ</h4>
                <p>まだ勤怠記録がありません</p>
                <p><strong>出勤ボタンを押して勤務を開始しましょう</strong></p>
                <div class="usage-tips">
                    <h5>📝 使い方:</h5>
                    <ol>
                        <li>現場を選択してください</li>
                        <li>出勤ボタンをクリック</li>
                        <li>休憩時は休憩ボタンを使用</li>
                        <li>退勤時は退勤ボタンをクリック</li>
                    </ol>
                    <p><strong>🔒 注意: 1日1回のみ出勤可能です</strong></p>
                </div>
            </div>
        `;
    }
}

// 最近の記録を表示
function displayRecentRecords(snapshot) {
    const recentList = document.getElementById('recent-list');
    if (!recentList) return;
    
    const records = [];
    // カスタムスナップショットオブジェクトに対応
    if (snapshot.docs && Array.isArray(snapshot.docs)) {
        snapshot.docs.forEach(doc => {
            records.push({ id: doc.id, ...doc.data() });
        });
    } else if (snapshot.forEach) {
        // 元のFirestoreスナップショット形式
        snapshot.forEach(doc => {
            records.push({ id: doc.id, ...doc.data() });
        });
    }
    
    // 日付でソート
    records.sort((a, b) => {
        const dateA = a.date || '';
        const dateB = b.date || '';
        return dateB.localeCompare(dateA);
    });

    let html = '';
    records.forEach(record => {
        const statusText = getStatusText(record.status);
        
        html += `
            <div class="record-item">
                <div class="record-header">
                    <span class="record-date">${record.date || '日付不明'}</span>
                    <span class="record-status status-${record.status || 'unknown'}">${statusText}</span>
                </div>
                <div class="record-details">
                    <div class="record-site">📍 ${record.siteName || '現場不明'}</div>
                    <div class="record-time">
                        ⏰ 出勤: ${record.startTime || '不明'}
                        ${record.endTime ? ` / 退勤: ${record.endTime}` : ' (勤務中)'}
                    </div>
                    ${record.notes ? `<div class="record-notes">📝 ${record.notes}</div>` : ''}
                </div>
            </div>
        `;
    });
    
    recentList.innerHTML = html;
}

// 記録読み込みエラーの処理
function handleRecordLoadError(error) {
    
    const recentList = document.getElementById('recent-list');
    if (recentList) {
        recentList.innerHTML = `
            <div class="error-message">
                <h4>⚠️ データ読み込みエラー</h4>
                <p>記録の読み込みで問題が発生しました</p>
                <p><strong>出勤・退勤機能は正常に動作します</strong></p>
                <button onclick="loadRecentRecordsSafely()" class="retry-btn">🔄 再試行</button>
                <details class="error-details">
                    <summary>エラー詳細</summary>
                    <code>${error.message || 'Unknown error'}</code>
                </details>
            </div>
        `;
    }
}

// エラーメッセージの表示
function showErrorMessage(message) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'error-notification';
    errorDiv.innerHTML = `
        <div class="error-content">
            <h4>⚠️ エラー</h4>
            <p>${message}</p>
        </div>
    `;
    errorDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #fee;
        border: 1px solid #fcc;
        border-radius: 8px;
        padding: 15px;
        max-width: 300px;
        z-index: 9999;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    `;
    
    document.body.appendChild(errorDiv);
    
    setTimeout(() => {
        if (errorDiv.parentNode) {
            errorDiv.parentNode.removeChild(errorDiv);
        }
    }, 5000);
}

// ログアウト処理
function handleLogout() {
    if (confirm('ログアウトしますか？')) {
        // 🎯 明示的なログアウトフラグを設定
        window.explicitLogout = true;
        
        firebase.auth().signOut()
            .then(() => {
                // 変数クリアは onAuthStateChanged で実行される
                if (typeof window.showPage === 'function') {
                    window.showPage('login');
                } else {
                    window.location.href = 'index.html';
                }
            })
            .catch((error) => {
                alert('ログアウトでエラーが発生しました');
                window.explicitLogout = false; // エラー時はフラグをリセット
            });
    }
}

// データ取得を強制実行する関数
async function forceDataReload() {
    
    // 現在の変数をクリア
    currentAttendanceId = null;
    todayAttendanceData = null;
    
    // 状態復元を実行
    await restoreTodayAttendanceState();
    
    // 結果確認
    setTimeout(() => {
        // Debug info available if needed
    }, 200);
}

// グローバルエラーハンドリング
window.addEventListener('unhandledrejection', function(event) {
    if (event.reason && event.reason.code) {
        
        // インデックスエラーなどを無視
        if (event.reason.code === 'failed-precondition' || 
            event.reason.code === 'permission-denied') {
            event.preventDefault();
        }
    }
});

// 初期化実行
document.addEventListener('DOMContentLoaded', function() {
    // Firebase が読み込まれるまで少し待つ
    setTimeout(initEmployeePage, 500);
});

// デバッグ用関数
function debugCurrentState() {
    
    // ボタンの現在の状態を確認
    const clockInBtn = document.getElementById('clock-in-btn');
    const clockOutBtn = document.getElementById('clock-out-btn');
    const breakStartBtn = document.getElementById('break-start-btn');
    const breakEndBtn = document.getElementById('break-end-btn');
    
    // Button state info available if needed
    
    // 🆕 正確な今日の日付チェック
    const today = getTodayJST();
}

// 強制的に勤務中状態に修正する緊急関数
function forceWorkingState() {
    
    if (todayAttendanceData) {
        updateClockButtons('working');
        updateStatusDisplay('working', todayAttendanceData);
    } else {
        
        // todayAttendanceDataがない場合は再取得を試行
        restoreTodayAttendanceState();
    }
}

// 状態を強制リセットして再初期化する関数
function forceStateReset() {
    
    // グローバル変数をクリア
    currentAttendanceId = null;
    todayAttendanceData = null;
    
    // 状態を再取得
    setTimeout(() => {
        restoreTodayAttendanceState();
    }, 100);
}

// 🆕 正確な日付でのテスト関数
function testTodayDate() {
    const today = getTodayJST();
    
    // 今日のデータを検索
    const query = getAttendanceCollection()
        .where('userId', '==', currentUser.uid)
        .where('date', '==', today);
    
    query.get().then(snapshot => {
        if (snapshot.empty) {
        } else {
            snapshot.docs.forEach(doc => {
            });
        }
    });
}

/**
 * 従業員ページの初期化関数
 */
async function initEmployeePage() {
    
    try {
        // 現在のユーザーを設定
        const user = firebase.auth().currentUser;
        if (user) {
            currentUser = user;
            window.currentUser = user;
        }
        
        // 時刻表示の開始
        updateDateTime();
        setInterval(updateDateTime, 1000);
        
        // 現場オプションを読み込み
        await loadSiteOptions();
        
        // 日付と現場設定の復元
        restoreDateAndSiteSettings();
        
        // 今日の勤怠状態を復元
        restoreTodayAttendanceState();
        
        // UI要素の設定
        setupEmployeeEventListeners();
        
        // 最近の記録を読み込み
        setTimeout(() => {
            loadRecentRecordsSafely();
        }, 1000);
        
    } catch (error) {
        showErrorMessage('従業員ページの初期化に失敗しました');
    }
}

/**
 * 従業員ページのイベントリスナー設定
 */
function setupEmployeeEventListeners() {
    // 出勤ボタン
    const clockInBtn = document.getElementById('clock-in-btn');
    if (clockInBtn && !clockInBtn.hasAttribute('data-listener-set')) {
        clockInBtn.addEventListener('click', handleClockIn);
        clockInBtn.setAttribute('data-listener-set', 'true');
    }
    
    // 退勤ボタン
    const clockOutBtn = document.getElementById('clock-out-btn');
    if (clockOutBtn && !clockOutBtn.hasAttribute('data-listener-set')) {
        clockOutBtn.addEventListener('click', handleClockOut);
        clockOutBtn.setAttribute('data-listener-set', 'true');
    }
    
    // 休憩開始ボタン
    const breakStartBtn = document.getElementById('break-start-btn');
    if (breakStartBtn && !breakStartBtn.hasAttribute('data-listener-set')) {
        breakStartBtn.addEventListener('click', handleBreakStart);
        breakStartBtn.setAttribute('data-listener-set', 'true');
    }
    
    // 休憩終了ボタン
    const breakEndBtn = document.getElementById('break-end-btn');const breakendbtn = document.getElementById（ 'break-end-btn'）;
    if (breakEndBtn && !breakEndBtn.hasAttribute('data-listener-set')) {
        breakEndBtn.addEventListener('click', handleBreakEnd);
        breakEndBtn.setAttribute('data-listener-set', 'true');
    }
    
    // 現場選択の変更
    const siteSelect = document.getElementById('site-name');
    if (siteSelect && !siteSelect.hasAttribute('data-listener-set')) {
        siteSelect.addEventListener('change', handleSiteSelection);
        siteSelect.setAttribute('data-listener-set', 'true');
    }
    
    // ログアウトボタン
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn && !logoutBtn.hasAttribute('data-listener-set')) {
        logoutBtn.addEventListener('click', handleLogout);
        logoutBtn.setAttribute('data-listener-set', 'true');
    }
}
