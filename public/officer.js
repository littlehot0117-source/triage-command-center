let officerCode = null;
let currentTriageMethod = 'wizard'; // 'wizard' or 'direct'
let computedColor = null;
let wizardAnswers = {};
let currentWizardStep = 1;

let socket = null;
let hasWebSocket = false;
let systemState = {
  currentCase: { name: '', status: 'idle' },
  patients: []
};

// Web Audio API beep sound feedback
function playTriageBeep(type) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    if (type === 'success') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
      gain.gain.setValueAtTime(0.05, ctx.currentTime);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.stop(ctx.currentTime + 0.2);
    } else if (type === 'error') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, ctx.currentTime);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.stop(ctx.currentTime + 0.4);
    }
  } catch (e) {
    console.warn('Audio feedback blocked:', e);
  }
}

// WebSocket Connection with fallback
function initConnection() {
  const isLocalFile = window.location.protocol === 'file:';
  const host = window.location.host || 'localhost:3000';
  const wsUrl = window.location.protocol === 'https:' ? `wss://${host}` : `ws://${host}`;

  if (isLocalFile) {
    console.log('[Officer] Local File Mode. Linking client-side storage.');
    initLocalMode();
    return;
  }

  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log('[Officer WS] Connected.');
    hasWebSocket = true;
    updateConnectionUI();
  };

  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'init' || message.type === 'STATE_UPDATE') {
        systemState = message.data;
        updateIncidentName();
        const historyPage = document.getElementById('pageHistory');
        if (historyPage && historyPage.style.display === 'block') {
          renderHistory();
        }
      }
    } catch (err) {
      console.error('[Officer WS] Error:', err);
    }
  };

  socket.onclose = () => {
    console.log('[Officer WS] Closed. Falling back to Local Storage.');
    hasWebSocket = false;
    updateConnectionUI();
    initLocalMode();
  };
}

function initLocalMode() {
  const syncState = () => {
    const saved = localStorage.getItem('mci_triage_state');
    if (saved) {
      try {
        systemState = JSON.parse(saved);
        // Clean old Taipei hospital state if it leaks into cache
        if (systemState.hospitals && systemState.hospitals.some(h => h.name === '台大醫院' || h.name === '榮民總醫院')) {
          console.log('[Migration] Taipei hospitals in officer cache. Clearing storage.');
          localStorage.removeItem('mci_triage_state');
          systemState = { currentCase: { name: '', status: 'idle' }, patients: [] };
        }
        updateIncidentName();
      } catch(e) {}
    }
  };
  
  syncState();
  
  window.addEventListener('storage', (e) => {
    if (e.key === 'mci_triage_state') {
      syncState();
    }
  });
}

function updateConnectionUI() {
  const badge = document.getElementById('connStatusBadge');
  const text = document.getElementById('connStatusText');
  const settingsConn = document.getElementById('settingsConnText');
  
  if (hasWebSocket) {
    if (badge) badge.style.background = '#10b981'; // Green
    if (text) text.innerText = '已連線';
    if (settingsConn) settingsConn.innerText = '已連線 (即時同步)';
    if (settingsConn) settingsConn.style.color = '#10b981';
  } else {
    if (badge) badge.style.background = '#ef4444'; // Red
    if (text) text.innerText = '離線模式';
    if (settingsConn) settingsConn.innerText = '離線模式 (LocalStorage 同步)';
    if (settingsConn) settingsConn.style.color = 'var(--text-muted)';
  }
}

function updateIncidentName() {
  const display = document.getElementById('incidentDisplay');
  if (systemState.currentCase && systemState.currentCase.status === 'active') {
    display.innerHTML = `<span class="badge-live">LIVE</span> ${systemState.currentCase.name}`;
  } else {
    display.innerHTML = `⚠️ 指揮中心尚未立案監測`;
  }
}

function sendAction(type, data) {
  if (hasWebSocket && socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type, data }));
  } else {
    // Local fallback database write
    const saved = localStorage.getItem('mci_triage_state');
    let localState = saved ? JSON.parse(saved) : {};
    if (!localState.patients) localState.patients = [];
    
    if (type === 'ADD_PATIENT') {
      if (!localState.patients.some(p => p.id === data.id)) {
        localState.patients.push({
          id: data.id,
          triageLevel: data.triageLevel,
          gender: data.gender || 'unknown',
          ageGroup: data.ageGroup || 'adult',
          description: data.description || '',
          status: 'waiting',
          location: data.location || '現場',
          timestamp: new Date().toISOString(),
          transportInfo: null
        });
        localStorage.setItem('mci_triage_state', JSON.stringify(localState));
        systemState = localState;
      }
    } else if (type === 'UPDATE_PATIENT') {
      const pIdx = localState.patients.findIndex(p => p.id === data.id);
      if (pIdx !== -1) {
        localState.patients[pIdx] = {
          ...localState.patients[pIdx],
          ...data
        };
        localStorage.setItem('mci_triage_state', JSON.stringify(localState));
        systemState = localState;
      }
    }
  }
}

// Session Officer Management
function selectOfficer(code) {
  officerCode = code;
  sessionStorage.setItem('triage_officer_code', code);
  
  document.getElementById('loginSection').style.display = 'none';
  document.getElementById('triageSection').style.display = 'flex';
  document.getElementById('officerDisplay').innerText = `檢傷官 ${code}`;
  
  // Set tab back to triage
  switchAppTab('triage');
  resetForm();
  
  playTriageBeep('success');
}

function logoutOfficer() {
  sessionStorage.removeItem('triage_officer_code');
  officerCode = null;
  document.getElementById('loginSection').style.display = 'flex';
  document.getElementById('triageSection').style.display = 'none';
}

// App tab switching (App Mode tabs)
function switchAppTab(tabName) {
  document.getElementById('pageTriage').style.display = 'none';
  document.getElementById('pageHistory').style.display = 'none';
  document.getElementById('pageSettings').style.display = 'none';
  
  document.getElementById('navTriage').classList.remove('active');
  document.getElementById('navHistory').classList.remove('active');
  document.getElementById('navSettings').classList.remove('active');
  
  if (tabName === 'triage') {
    document.getElementById('pageTriage').style.display = 'block';
    document.getElementById('navTriage').classList.add('active');
  } else if (tabName === 'history') {
    document.getElementById('pageHistory').style.display = 'block';
    document.getElementById('navHistory').classList.add('active');
    renderHistory();
  } else if (tabName === 'settings') {
    document.getElementById('pageSettings').style.display = 'block';
    document.getElementById('navSettings').classList.add('active');
    
    document.getElementById('settingsOfficerDisplay').innerText = `檢傷官 ${officerCode}`;
    updateConnectionUI();
  }
  
  lucide.createIcons();
}

// Switch Triage UI mode (Wizard vs Direct)
function switchTriageMethod(method) {
  currentTriageMethod = method;
  const tabWizard = document.getElementById('tabWizard');
  const tabDirect = document.getElementById('tabDirect');
  const wizardPanel = document.getElementById('wizardPanel');
  const directPanel = document.getElementById('directPanel');
  
  if (method === 'wizard') {
    tabWizard.className = 'btn';
    tabDirect.className = 'btn btn-secondary';
    wizardPanel.style.display = 'block';
    directPanel.style.display = 'none';
  } else {
    tabWizard.className = 'btn btn-secondary';
    tabDirect.className = 'btn';
    wizardPanel.style.display = 'none';
    directPanel.style.display = 'block';
  }
  
  computedColor = null;
  updateComputedColorUI();
}

// START Triage Wizard Steps
function setWizardStep(stepId) {
  const steps = document.querySelectorAll('.wizard-step');
  steps.forEach(s => s.classList.remove('active'));
  
  const activeStep = document.getElementById('step' + stepId);
  if (activeStep) {
    activeStep.classList.add('active');
  }
  
  let progressText = '步驟';
  if (stepId === 1) progressText = '步驟 1 / 5';
  else if (stepId === 2) progressText = '步驟 2 / 5';
  else if (stepId === '2_5') progressText = '步驟 2.5 / 5';
  else if (stepId === 3) progressText = '步驟 3 / 5';
  else if (stepId === 4) progressText = '步驟 4 / 5';
  else if (stepId === 5) progressText = '步驟 5 / 5';
  
  document.getElementById('stepIndicator').innerText = progressText;
}

function wizardAnswer(step, answer) {
  wizardAnswers[step] = answer;
  
  if (step === 1) {
    if (answer === true) {
      finishWizard('green');
    } else {
      setWizardStep(2);
    }
  } 
  else if (step === 2) {
    if (answer === true) {
      setWizardStep(3);
    } else {
      setWizardStep('2_5');
    }
  } 
  else if (step === '2_5') {
    if (answer === true) {
      finishWizard('red');
    } else {
      finishWizard('black');
    }
  } 
  else if (step === 3) {
    if (answer === true) {
      finishWizard('red');
    } else {
      setWizardStep(4);
    }
  } 
  else if (step === 4) {
    if (answer === true) {
      setWizardStep(5);
    } else {
      finishWizard('red');
    }
  } 
  else if (step === 5) {
    if (answer === true) {
      finishWizard('yellow');
    } else {
      finishWizard('red');
    }
  }
}

function finishWizard(color) {
  computedColor = color;
  updateComputedColorUI();
}

// Direct Color override selection
function setDirectColor(color) {
  computedColor = color;
  
  const btns = document.querySelectorAll('.triage-color-btn');
  btns.forEach(btn => {
    btn.style.transform = 'scale(1)';
    btn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.25)';
  });
  
  const selectedBtn = document.querySelector(`.triage-color-btn.${color}`);
  if (selectedBtn) {
    selectedBtn.style.transform = 'scale(1.08)';
    selectedBtn.style.boxShadow = `0 0 20px var(--triage-${color})`;
  }
  
  updateComputedColorUI();
}

function updateComputedColorUI() {
  const resultDisplay = document.getElementById('resultTriageDisplay');
  const badge = document.getElementById('resultColorBadge');
  const submitBtn = document.getElementById('submitTriageBtn');
  
  if (!computedColor) {
    resultDisplay.innerText = '請先完成評估...';
    resultDisplay.style.color = 'var(--text-muted)';
    badge.style.background = '#1e293b';
    badge.style.boxShadow = 'none';
    badge.className = '';
    submitBtn.disabled = true;
  } else {
    submitBtn.disabled = false;
    badge.className = computedColor === 'red' ? 'pulse' : '';
    
    switch(computedColor) {
      case 'red':
        resultDisplay.innerText = '🔴 立即治療 (Immediate)';
        resultDisplay.style.color = 'var(--triage-red)';
        badge.style.background = 'var(--triage-red)';
        badge.style.boxShadow = '0 0 10px var(--triage-red)';
        break;
      case 'yellow':
        resultDisplay.innerText = '🟡 延遲治療 (Delayed)';
        resultDisplay.style.color = 'var(--triage-yellow)';
        badge.style.background = 'var(--triage-yellow)';
        badge.style.boxShadow = '0 0 10px var(--triage-yellow)';
        break;
      case 'green':
        resultDisplay.innerText = '🟢 輕傷 (Minor)';
        resultDisplay.style.color = 'var(--triage-green)';
        badge.style.background = 'var(--triage-green)';
        badge.style.boxShadow = '0 0 10px var(--triage-green)';
        break;
      case 'black':
        resultDisplay.innerText = '⚫ 死亡/期待 (Deceased)';
        resultDisplay.style.color = 'var(--triage-black)';
        badge.style.background = 'var(--triage-black)';
        badge.style.boxShadow = '0 0 10px var(--triage-black)';
        break;
    }
  }
}

// Render local officer history
function renderHistory() {
  const historyList = document.getElementById('personalHistoryList');
  const historyKey = 'triage_history_' + officerCode;
  const historyItems = JSON.parse(localStorage.getItem(historyKey) || '[]');
  
  document.getElementById('historyCount').innerText = historyItems.length;
  
  if (historyItems.length === 0) {
    historyList.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size:13px; padding:20px 0;">尚無檢傷紀錄</div>`;
  } else {
    const sorted = [...historyItems].reverse();
    historyList.innerHTML = sorted.map(item => {
      // Find latest state from systemState
      const p = systemState.patients.find(x => x.id === item.id) || {
        id: item.id,
        triageLevel: item.color,
        description: item.desc,
        location: item.location,
        gender: 'unknown',
        ageGroup: 'adult'
      };

      const dateStr = new Date(item.timestamp).toLocaleTimeString('zh-TW', { hour12: false });
      const ageGroupZh = p.ageGroup === 'child' ? '兒童' : '成人';
      const genderZh = p.gender === 'male' ? '生理男' : p.gender === 'female' ? '生理女' : '不詳';
      const descText = p.description || '無描述';

      return `
        <div class="history-item ${p.triageLevel}" style="display:flex; justify-content:space-between; align-items:center;">
          <div style="flex:1; text-align:left; padding-right:8px;">
            <div style="font-weight:700; display:flex; align-items:center; gap:8px;">
              患者 ${p.id}
              <button type="button" class="btn btn-secondary btn-sm" style="padding:2px 6px; font-size:10px; height:20px; line-height:1; display:inline-flex; align-items:center; gap:2px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);" onclick="openEditPatientModal('${p.id}')">
                <i data-lucide="edit-3" style="width:10px;height:10px;"></i>修改
              </button>
            </div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">
              ${genderZh} | ${ageGroupZh}
            </div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">
              ${descText} | ${formatLocationLink(p.location)}
            </div>
          </div>
          <div style="text-align:right; display:flex; flex-direction:column; align-items:flex-end; justify-content:center;">
            <span class="triage-badge ${p.triageLevel}" style="font-size:10px; padding:3px 8px;">${getTriageLabel(p.triageLevel)}</span>
            <div style="font-size:10px; color:var(--text-muted); margin-top:6px;">${dateStr}</div>
          </div>
        </div>
      `;
    }).join('');
  }
  lucide.createIcons();
}

function getTriageLabel(color) {
  switch (color) {
    case 'red': return '立即';
    case 'yellow': return '延遲';
    case 'green': return '輕傷';
    case 'black': return '死亡';
    default: return '未知';
  }
}

function resetForm() {
  computedColor = null;
  wizardAnswers = {};
  setWizardStep(1);
  
  const btns = document.querySelectorAll('.triage-color-btn');
  btns.forEach(btn => {
    btn.style.transform = 'scale(1)';
    btn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.25)';
  });
  
  document.getElementById('patientDesc').value = '';
  selectGender('unknown');
  selectAge('adult');
  
  updateComputedColorUI();
}

function submitTriage() {
  if (!computedColor) return;
  
  const desc = document.getElementById('patientDesc').value.trim();
  const gender = document.getElementById('patientGender').value;
  const ageGroup = document.getElementById('patientAge').value;
  const location = document.getElementById('patientLoc').value.trim() || '現場';
  
  const counterKey = 'triage_counter_' + officerCode;
  let counter = parseInt(localStorage.getItem(counterKey) || '1');
  
  const patientId = officerCode + String(counter).padStart(3, '0');
  
  const payload = {
    id: patientId,
    triageLevel: computedColor,
    gender,
    ageGroup,
    description: desc,
    location
  };
  
  sendAction('ADD_PATIENT', payload);
  
  const historyKey = 'triage_history_' + officerCode;
  const history = JSON.parse(localStorage.getItem(historyKey) || '[]');
  history.push({
    id: patientId,
    color: computedColor,
    desc: desc,
    location: location,
    timestamp: new Date().toISOString()
  });
  localStorage.setItem(historyKey, JSON.stringify(history));
  localStorage.setItem(counterKey, String(counter + 1));
  
  playTriageBeep('success');
  
  resetForm();
  renderHistory();
  
  // After triage, switch tab to history to see the submitted result
  switchAppTab('history');
}

// PWA Service Worker Registration
function registerPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then((reg) => {
        console.log('[PWA] Service Worker Registered successfully:', reg.scope);
        const pwaText = document.getElementById('pwaStatusText');
        if (pwaText) pwaText.innerText = '已啟用離線快取';
      })
      .catch((err) => {
        console.error('[PWA] Service Worker Registration failed:', err);
        const pwaText = document.getElementById('pwaStatusText');
        if (pwaText) pwaText.innerText = '未啟用 (本機測試不支援)';
      });
  } else {
    const pwaText = document.getElementById('pwaStatusText');
    if (pwaText) pwaText.innerText = '瀏覽器不支援';
  }
}

// Gender and Age Group Selection Handlers
function selectGender(gender) {
  const input = document.getElementById('patientGender');
  if (input) input.value = gender;
  
  const btnMale = document.getElementById('genderBtnMale');
  const btnFemale = document.getElementById('genderBtnFemale');
  const btnUnknown = document.getElementById('genderBtnUnknown');
  
  if (btnMale) btnMale.classList.remove('active');
  if (btnFemale) btnFemale.classList.remove('active');
  if (btnUnknown) btnUnknown.classList.remove('active');
  
  if (gender === 'male' && btnMale) {
    btnMale.classList.add('active');
  } else if (gender === 'female' && btnFemale) {
    btnFemale.classList.add('active');
  } else if (gender === 'unknown' && btnUnknown) {
    btnUnknown.classList.add('active');
  }
}

function selectAge(age) {
  const input = document.getElementById('patientAge');
  if (input) input.value = age;
  
  const btnAdult = document.getElementById('ageBtnAdult');
  const btnChild = document.getElementById('ageBtnChild');
  
  if (btnAdult) btnAdult.classList.remove('active');
  if (btnChild) btnChild.classList.remove('active');
  
  if (age === 'adult' && btnAdult) {
    btnAdult.classList.add('active');
  } else if (age === 'child' && btnChild) {
    btnChild.classList.add('active');
  }
}

// Edit Patient Modal Helpers
let editComputedColor = null;

function openEditPatientModal(patientId) {
  const p = systemState.patients.find(x => x.id === patientId);
  if (!p) {
    alert('找不到該傷患資料，無法進行修改！');
    return;
  }
  
  document.getElementById('editPatientId').value = patientId;
  document.getElementById('editModalTitle').innerText = `✏️ 修改傷患 ${patientId} 紀錄`;
  document.getElementById('editPatientDesc').value = p.description || '';
  document.getElementById('editPatientLoc').value = p.location || '現場';
  
  // Set triage level
  setEditColor(p.triageLevel);
  
  // Set gender
  selectEditGender(p.gender || 'unknown');
  
  // Set age
  selectEditAge(p.ageGroup || 'adult');
  
  document.getElementById('editPatientModal').classList.add('show');
  lucide.createIcons();
}

function setEditColor(color) {
  editComputedColor = color;
  document.getElementById('editPatientTriage').value = color;
  
  const btns = document.querySelectorAll('.edit-triage-btn');
  btns.forEach(btn => {
    btn.classList.remove('active');
    btn.style.transform = 'scale(1)';
    btn.style.boxShadow = 'none';
    btn.style.border = '1px solid rgba(255,255,255,0.05)';
  });
  
  let activeBtn = null;
  if (color === 'red') activeBtn = document.querySelector('.edit-triage-btn.red');
  else if (color === 'yellow') activeBtn = document.querySelector('.edit-triage-btn.yellow');
  else if (color === 'green') activeBtn = document.querySelector('.edit-triage-btn.green');
  else if (color === 'black') activeBtn = document.querySelector('.edit-triage-btn.black');
  
  if (activeBtn) {
    activeBtn.classList.add('active');
    activeBtn.style.transform = 'scale(1.04)';
    activeBtn.style.boxShadow = `0 0 15px var(--triage-${color})`;
    activeBtn.style.border = `2px solid var(--triage-${color === 'black' ? 'slate' : color})`;
  }
}

function selectEditGender(gender) {
  document.getElementById('editPatientGender').value = gender;
  
  const btnMale = document.getElementById('editGenderBtnMale');
  const btnFemale = document.getElementById('editGenderBtnFemale');
  const btnUnknown = document.getElementById('editGenderBtnUnknown');
  
  const btns = document.querySelectorAll('.edit-gender-btn');
  btns.forEach(b => b.classList.remove('active'));
  
  if (gender === 'male' && btnMale) btnMale.classList.add('active');
  else if (gender === 'female' && btnFemale) btnFemale.classList.add('active');
  else if (gender === 'unknown' && btnUnknown) btnUnknown.classList.add('active');
}

function selectEditAge(age) {
  document.getElementById('editPatientAge').value = age;
  
  const btnAdult = document.getElementById('editAgeBtnAdult');
  const btnChild = document.getElementById('editAgeBtnChild');
  
  const btns = document.querySelectorAll('.edit-age-btn');
  btns.forEach(b => b.classList.remove('active'));
  
  if (age === 'adult' && btnAdult) btnAdult.classList.add('active');
  else if (age === 'child' && btnChild) btnChild.classList.add('active');
}

function closeEditPatientModal() {
  document.getElementById('editPatientModal').classList.remove('show');
}

function saveEditPatient() {
  const patientId = document.getElementById('editPatientId').value;
  const triageLevel = editComputedColor;
  const description = document.getElementById('editPatientDesc').value.trim();
  const gender = document.getElementById('editPatientGender').value;
  const ageGroup = document.getElementById('editPatientAge').value;
  const location = document.getElementById('editPatientLoc').value.trim() || '現場';
  
  if (!triageLevel) {
    alert('請選擇檢傷等級！');
    return;
  }
  
  const payload = {
    id: patientId,
    triageLevel,
    gender,
    ageGroup,
    description,
    location
  };
  
  // Update central state
  sendAction('UPDATE_PATIENT', payload);
  
  // Update local triage history list item cache (to sync offline cache)
  const historyKey = 'triage_history_' + officerCode;
  const history = JSON.parse(localStorage.getItem(historyKey) || '[]');
  const hIdx = history.findIndex(x => x.id === patientId);
  if (hIdx !== -1) {
    history[hIdx].color = triageLevel;
    history[hIdx].desc = description;
    history[hIdx].location = location;
    localStorage.setItem(historyKey, JSON.stringify(history));
  }
  
  // Re-render local list view
  renderHistory();
  closeEditPatientModal();
  alert(`已成功修改傷患 ${patientId} 的檢傷紀錄！`);
}

// GPS Positioning and Geolocation helpers
function formatLocationLink(loc) {
  if (!loc) return '現場';
  const geoRegex = /(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/;
  const match = loc.match(geoRegex);
  
  if (match) {
    const lat = match[1];
    const lng = match[2];
    return `<a href="https://www.google.com/maps/search/?api=1&query=${lat},${lng}" target="_blank" style="color:var(--primary); text-decoration:underline; font-weight:600; display:inline-flex; align-items:center; gap:2px;"><i data-lucide="map-pin" style="width:10px;height:10px;"></i>${loc}</a>`;
  }
  return loc;
}

function getCurrentGPS(inputId, btnId) {
  const btn = document.getElementById(btnId);
  const input = document.getElementById(inputId);
  if (!btn || !input) return;
  
  const originalHTML = btn.innerHTML;
  btn.innerHTML = '<span style="font-size:10px;">定位中...</span>';
  btn.disabled = true;
  
  if (!navigator.geolocation) {
    alert('您的瀏覽器不支援 GPS 定位功能！');
    btn.innerHTML = originalHTML;
    btn.disabled = false;
    return;
  }
  
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude.toFixed(6);
      const lng = position.coords.longitude.toFixed(6);
      
      // Set the input field value to the latitude and longitude
      input.value = `${lat}, ${lng}`;
      
      btn.innerHTML = originalHTML;
      btn.disabled = false;
      
      // Play audio feedback
      playTriageBeep('success');
      lucide.createIcons();
    },
    (error) => {
      let errMsg = '定位失敗！';
      if (error.code === error.PERMISSION_DENIED) {
        errMsg = '定位失敗，請允許此網頁讀取您的 GPS 位置權限！';
      } else if (error.code === error.POSITION_UNAVAILABLE) {
        errMsg = '無法獲取目前位置資訊！';
      } else if (error.code === error.TIMEOUT) {
        errMsg = '獲取定位逾時，請重試！';
      }
      alert(errMsg);
      btn.innerHTML = originalHTML;
      btn.disabled = false;
      playTriageBeep('error');
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    }
  );
}

document.addEventListener('DOMContentLoaded', () => {
  initConnection();
  registerPWA();
  
  const savedCode = sessionStorage.getItem('triage_officer_code');
  if (savedCode) {
    selectOfficer(savedCode);
  }
  
  document.getElementById('submitTriageBtn').addEventListener('click', submitTriage);
  
  lucide.createIcons();
});
