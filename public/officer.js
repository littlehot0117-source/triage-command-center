let officerCode = null;
let currentTriageMethod = 'direct'; // 'wizard', 'jumpstart', or 'direct'
let computedColor = null;
let wizardAnswers = {};
let currentWizardStep = 1;
let jumpstartAnswers = {};
let currentJumpStartStep = 1;

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
const DEFAULT_OFFICERS = [
  { name: '嘉明', code: 'A' },
  { name: '南廷', code: 'B' },
  { name: '意婷', code: 'C' },
  { name: '詠翔', code: 'D' },
  { name: '俊璋', code: 'E' },
  { name: '睿聰', code: 'F' },
  { name: '岳峰', code: 'G' },
  { name: '郁智', code: 'H' }
];

let officersList = JSON.parse(localStorage.getItem('triage_officers_list'));
if (!officersList) {
  officersList = DEFAULT_OFFICERS;
  localStorage.setItem('triage_officers_list', JSON.stringify(officersList));
}

function renderOfficerSelectGrid() {
  const grid = document.getElementById('officerSelectGrid');
  if (!grid) return;
  
  grid.innerHTML = officersList.map(o => `
    <button class="login-btn" style="font-size: 14px; padding: 12px 8px; font-weight:700;" onclick="selectOfficer('${o.code}', '${o.name}')">
      ${o.name} (${o.code})
    </button>
  `).join('');
  
  // Re-run lucide for icons inside the selection overlay
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function addNewOfficer() {
  const input = document.getElementById('newOfficerInput');
  if (!input) return;
  const name = input.value.trim();
  if (!name) {
    alert('請輸入檢傷官姓名！');
    return;
  }
  
  // 檢查是否重複
  if (officersList.some(o => o.name === name)) {
    alert('該檢傷官姓名已存在！');
    return;
  }
  
  // 尋找下一個未使用的代號字母
  const usedCodes = new Set(officersList.map(o => o.code));
  let nextCode = '';
  for (let i = 65; i <= 90; i++) { // A-Z
    const letter = String.fromCharCode(i);
    if (!usedCodes.has(letter)) {
      nextCode = letter;
      break;
    }
  }
  
  if (!nextCode) {
    nextCode = 'Z' + String.fromCharCode(65 + (usedCodes.size % 26));
  }
  
  officersList.push({ name, code: nextCode });
  localStorage.setItem('triage_officers_list', JSON.stringify(officersList));
  
  input.value = '';
  renderOfficerSelectGrid();
  playTriageBeep('success');
}

function selectOfficer(code, name) {
  officerCode = code;
  sessionStorage.setItem('triage_officer_code', code);
  
  // 頁面重整時，若無傳入 name，從 LocalStorage 反查
  let officerName = name;
  if (!officerName) {
    const list = JSON.parse(localStorage.getItem('triage_officers_list')) || DEFAULT_OFFICERS;
    const found = list.find(o => o.code === code);
    officerName = found ? found.name : '';
  }
  
  if (officerName) {
    sessionStorage.setItem('triage_officer_name', officerName);
  }
  
  document.getElementById('loginSection').style.display = 'none';
  document.getElementById('triageSection').style.display = 'flex';
  
  const display = document.getElementById('officerDisplay');
  if (display) {
    display.innerText = officerName ? `檢傷官: ${officerName} (${code})` : `檢傷官 ${code}`;
  }
  
  const settingsDisplay = document.getElementById('settingsOfficerDisplay');
  if (settingsDisplay) {
    settingsDisplay.innerText = officerName ? `${officerName} (${code})` : `檢傷官 ${code}`;
  }
  
  // Set tab back to triage
  switchAppTab('triage');
  resetForm();
  
  playTriageBeep('success');
}

function logoutOfficer() {
  sessionStorage.removeItem('triage_officer_code');
  sessionStorage.removeItem('triage_officer_name');
  officerCode = null;
  document.getElementById('loginSection').style.display = 'flex';
  document.getElementById('triageSection').style.display = 'none';
  renderOfficerSelectGrid();
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

// Switch Triage UI mode (START vs JumpSTART vs Direct)
function switchTriageMethod(method) {
  currentTriageMethod = method;
  const tabWizard = document.getElementById('tabWizard');
  const tabJumpStart = document.getElementById('tabJumpStart');
  const tabDirect = document.getElementById('tabDirect');
  
  const wizardPanel = document.getElementById('wizardPanel');
  const jumpstartPanel = document.getElementById('jumpstartPanel');
  const directPanel = document.getElementById('directPanel');
  
  if (tabWizard) tabWizard.className = method === 'wizard' ? 'btn' : 'btn btn-secondary';
  if (tabJumpStart) tabJumpStart.className = method === 'jumpstart' ? 'btn' : 'btn btn-secondary';
  if (tabDirect) tabDirect.className = method === 'direct' ? 'btn' : 'btn btn-secondary';
  
  if (wizardPanel) wizardPanel.style.display = method === 'wizard' ? 'block' : 'none';
  if (jumpstartPanel) jumpstartPanel.style.display = method === 'jumpstart' ? 'block' : 'none';
  if (directPanel) directPanel.style.display = method === 'direct' ? 'block' : 'none';
  
  computedColor = null;
  updateComputedColorUI();
  
  // Reset step views on tab switch
  setWizardStep(1);
  setJumpStartStep(1);
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

// JumpSTART Triage Wizard Steps
function setJumpStartStep(stepId) {
  currentJumpStartStep = stepId;
  const steps = document.querySelectorAll('#jumpstartPanel .wizard-step');
  steps.forEach(s => s.classList.remove('active'));
  
  const activeStep = document.getElementById('stepJ' + stepId);
  if (activeStep) {
    activeStep.classList.add('active');
  }
  
  let progressText = '步驟';
  if (stepId === 1) progressText = '步驟 1 / 5';
  else if (stepId === 2) progressText = '步驟 2 / 5';
  else if (stepId === '2_5') progressText = '步驟 2.5 / 5';
  else if (stepId === '2_6') progressText = '步驟 2.6 / 5';
  else if (stepId === 3) progressText = '步驟 3 / 5';
  else if (stepId === 4) progressText = '步驟 4 / 5';
  else if (stepId === 5) progressText = '步驟 5 / 5';
  
  const indicator = document.getElementById('jumpstartStepIndicator');
  if (indicator) indicator.innerText = progressText;
}

function jumpstartAnswer(step, answer) {
  jumpstartAnswers[step] = answer;
  
  if (step === 1) {
    if (answer === true) {
      finishWizard('green');
      selectAge('child');
    } else {
      setJumpStartStep(2);
    }
  } 
  else if (step === 2) {
    if (answer === true) {
      setJumpStartStep(3);
    } else {
      setJumpStartStep('2_5');
    }
  } 
  else if (step === '2_5') {
    if (answer === 'breathes') {
      finishWizard('red');
      selectAge('child');
    } else if (answer === 'no_pulse') {
      finishWizard('black');
      selectAge('child');
    } else if (answer === 'has_pulse') {
      setJumpStartStep('2_6');
    }
  } 
  else if (step === '2_6') {
    if (answer === true) {
      finishWizard('red');
    } else {
      finishWizard('black');
    }
    selectAge('child');
  } 
  else if (step === 3) {
    if (answer === false) {
      finishWizard('red');
    } else {
      setJumpStartStep(4);
    }
    selectAge('child');
  } 
  else if (step === 4) {
    if (answer === false) {
      finishWizard('red');
    } else {
      setJumpStartStep(5);
    }
    selectAge('child');
  } 
  else if (step === 5) {
    if (answer === true) {
      finishWizard('yellow');
    } else {
      finishWizard('red');
    }
    selectAge('child');
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
  jumpstartAnswers = {};
  setWizardStep(1);
  setJumpStartStep(1);
  
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
  
  const patientId = officerCode + String(counter).padStart(2, '0');
  
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
  
  // Render the triage officer selector list
  renderOfficerSelectGrid();
  
  const savedCode = sessionStorage.getItem('triage_officer_code');
  if (savedCode) {
    selectOfficer(savedCode);
  }
  
  document.getElementById('submitTriageBtn').addEventListener('click', submitTriage);
  
  lucide.createIcons();
});

// 🗺️ 病患即時定位系統 (Leaflet Map Modal)
function openLocationMap() {
  if (!window.L) {
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    
    if (!document.getElementById('leaflet-js')) {
      const script = document.createElement('script');
      script.id = 'leaflet-js';
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => {
        createAndShowMapModal();
      };
      document.head.appendChild(script);
      return;
    }
  } else {
    createAndShowMapModal();
  }
}

function createAndShowMapModal() {
  let oldModal = document.getElementById('locationMapModal');
  if (oldModal) oldModal.remove();
  
  const patients = (typeof state !== 'undefined' && state.patients) || (typeof systemState !== 'undefined' && systemState.patients) || [];
  
  // Group patients by coordinate rounded to 5 decimal places (approx 1 meter)
  const coordinatesMap = {};
  patients.forEach(p => {
    if (p.location) {
      const match = p.location.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
      if (match) {
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);
        const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
        
        if (!coordinatesMap[key]) {
          coordinatesMap[key] = {
            lat: lat,
            lng: lng,
            patients: []
          };
        }
        coordinatesMap[key].patients.push(p);
      }
    }
  });
  
  const uniqueGroups = Object.values(coordinatesMap);
  const totalPatientsMapped = patients.filter(p => {
    if (!p.location) return false;
    return p.location.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
  }).length;

  const modal = document.createElement('div');
  modal.id = 'locationMapModal';
  modal.style.position = 'fixed';
  modal.style.top = '0';
  modal.style.left = '0';
  modal.style.width = '100vw';
  modal.style.height = '100vh';
  modal.style.backgroundColor = 'rgba(9, 13, 22, 0.85)';
  modal.style.backdropFilter = 'blur(6px)';
  modal.style.zIndex = '9999';
  modal.style.display = 'flex';
  modal.style.alignItems = 'center';
  modal.style.justifyContent = 'center';
  modal.style.padding = '20px 10px';
  
  modal.innerHTML = `
    <div class="glass-card" style="width: 100%; max-width: 800px; height: 90vh; display: flex; flex-direction: column; margin: 0; padding: 20px; background: rgba(17, 24, 39, 0.95); border: 1px solid var(--border-color); box-shadow: 0 8px 32px rgba(0,0,0,0.5);">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <i data-lucide="map" style="color: #f59e0b; width: 22px; height: 22px;"></i>
          <span style="font-weight: 800; font-size: 18px; color: var(--text-main);">全傷患即時定位監控地圖</span>
        </div>
        <button onclick="document.getElementById('locationMapModal').remove()" style="background: none; border: none; color: var(--text-muted); cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 4px;">
          <i data-lucide="x" style="width: 24px; height: 24px;"></i>
        </button>
      </div>
      
      <div id="locationMapEl" style="flex: 1; width: 100%; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: #0c111d; position: relative;"></div>
      
      <div style="margin-top: 12px; display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--text-muted); flex-wrap: wrap; gap: 8px;">
        <div style="display: flex; gap: 12px;">
          <span style="display: flex; align-items: center; gap: 4px;"><span style="width:10px; height:10px; background:#ef4444; border-radius:50%; display:inline-block;"></span>紅傷: ${patients.filter(p => p.location && p.location.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/) && p.triageLevel === 'red').length}人</span>
          <span style="display: flex; align-items: center; gap: 4px;"><span style="width:10px; height:10px; background:#f59e0b; border-radius:50%; display:inline-block;"></span>黃傷: ${patients.filter(p => p.location && p.location.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/) && p.triageLevel === 'yellow').length}人</span>
          <span style="display: flex; align-items: center; gap: 4px;"><span style="width:10px; height:10px; background:#10b981; border-radius:50%; display:inline-block;"></span>綠傷: ${patients.filter(p => p.location && p.location.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/) && p.triageLevel === 'green').length}人</span>
          <span style="display: flex; align-items: center; gap: 4px;"><span style="width:10px; height:10px; background:#1e293b; border:1px solid #475569; border-radius:50%; display:inline-block;"></span>黑傷: ${patients.filter(p => p.location && p.location.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/) && p.triageLevel === 'black').length}人</span>
        </div>
        <div>共標記 ${totalPatientsMapped} 名定位傷患 (總傷患數: ${patients.length}人)</div>
      </div>
    </div>
    
    <style>
      .leaflet-popup-content-wrapper {
        background: #0f172a !important;
        color: #f8fafc !important;
        border: 1px solid #334155 !important;
        border-radius: 6px !important;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4) !important;
      }
      .leaflet-popup-tip {
        background: #0f172a !important;
        border-left: 1px solid #334155 !important;
        border-bottom: 1px solid #334155 !important;
      }
      .leaflet-tooltip.cluster-tooltip {
        background: rgba(15, 23, 42, 0.9) !important;
        color: #f59e0b !important;
        border: 1px solid #f59e0b !important;
        font-weight: 800 !important;
        font-size: 11px !important;
        padding: 2px 6px !important;
        border-radius: 4px !important;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3) !important;
      }
    </style>
  `;
  
  document.body.appendChild(modal);
  if (window.lucide) window.lucide.createIcons({ attrs: { style: 'stroke: currentColor;' } });

  const defaultCenter = [23.973875, 120.982024]; 
  const map = L.map('locationMapEl').setView(defaultCenter, 8);

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    maxZoom: 19
  }).addTo(map);

  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19
  }).addTo(map);

  const bounds = [];
  uniqueGroups.forEach(g => {
    const groupPatients = g.patients;
    
    // Sort group patients: red > yellow > green > black
    const severityOrder = { red: 1, yellow: 2, green: 3, black: 4 };
    groupPatients.sort((a, b) => (severityOrder[a.triageLevel] || 99) - (severityOrder[b.triageLevel] || 99));
    
    // Cluster color = most severe patient's triage color
    const topTriage = groupPatients[0].triageLevel;
    let fillColor = '#10b981';
    if (topTriage === 'red') fillColor = '#ef4444';
    else if (topTriage === 'yellow') fillColor = '#f59e0b';
    else if (topTriage === 'black') fillColor = '#1e293b';

    let popupHtml = '';
    let markerRadius = 9;
    let markerWeight = 2;

    if (groupPatients.length === 1) {
      const p = groupPatients[0];
      const timeStr = p.lastUpdated ? new Date(p.lastUpdated).toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' }) : '-';
      
      let colorBadge = '';
      if (p.triageLevel === 'red') colorBadge = '<span style="background:#ef4444;color:white;padding:2px 6px;border-radius:3px;font-weight:bold;font-size:10px;">立即 (紅)</span>';
      else if (p.triageLevel === 'yellow') colorBadge = '<span style="background:#f59e0b;color:black;padding:2px 6px;border-radius:3px;font-weight:bold;font-size:10px;">延遲 (黃)</span>';
      else if (p.triageLevel === 'green') colorBadge = '<span style="background:#10b981;color:white;padding:2px 6px;border-radius:3px;font-weight:bold;font-size:10px;">輕傷 (綠)</span>';
      else if (p.triageLevel === 'black') colorBadge = '<span style="background:#1e293b;color:#94a3b8;border:1px solid #334155;padding:2px 6px;border-radius:3px;font-weight:bold;font-size:10px;">死亡 (黑)</span>';

      let basicInfo = '';
      if (p.treatmentInfo) {
        const t = p.treatmentInfo;
        basicInfo = `${t.name || '未登錄'} / ${t.gender === 'male' ? '男' : t.gender === 'female' ? '女' : '未註明'} / ${t.age ? t.age + '歲' : '年齡未知'}`;
      } else {
        basicInfo = `未登錄 / ${p.gender === 'male' ? '男' : p.gender === 'female' ? '女' : '未註明'} / ${p.ageGroup === 'child' ? '兒童' : '成人'}`;
      }

      popupHtml = `
        <div style="font-family: 'Outfit', 'Noto Sans TC', sans-serif; color: #f8fafc; line-height: 1.5; font-size:12px; min-width: 200px; padding: 4px 0;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 8px; border-bottom: 1px solid #334155; padding-bottom: 6px;">
            <strong style="color:var(--primary); font-size:13.5px;">患者編號: ${p.id}</strong>
            ${colorBadge}
          </div>
          <div style="margin-bottom: 4px;"><strong>基本資料:</strong> ${basicInfo}</div>
          <div style="margin-bottom: 4px;"><strong>定位座標:</strong> ${p.location}</div>
          ${p.description ? `<div style="margin-bottom: 6px; color: #cbd5e1;"><strong>特徵備註:</strong> ${p.description}</div>` : ''}
          <div style="margin-bottom: 8px; font-size: 10px; color: #64748b; text-align: right;">時間: ${timeStr}</div>
          <div style="border-top:1px solid #334155; padding-top:8px; text-align:center;">
            <a href="https://www.google.com/maps/search/?api=1&query=${g.lat},${g.lng}" target="_blank" style="background:#f59e0b; color:black; padding:5px 10px; border-radius:4px; text-decoration:none; font-weight:700; font-size:11px; display:inline-flex; align-items:center; gap:4px; width:100%; justify-content:center;">
              📍 Google Maps 導航
            </a>
          </div>
        </div>
      `;
    } else {
      // Multiple patients at this spot!
      markerRadius = 13; // Larger marker
      markerWeight = 3;  // Thicker border
      
      const patientItemsHtml = groupPatients.map(p => {
        let colorBadge = '';
        if (p.triageLevel === 'red') colorBadge = '<span style="background:#ef4444;color:white;padding:1px 4px;border-radius:3px;font-weight:bold;font-size:9px;">紅</span>';
        else if (p.triageLevel === 'yellow') colorBadge = '<span style="background:#f59e0b;color:black;padding:1px 4px;border-radius:3px;font-weight:bold;font-size:9px;">黃</span>';
        else if (p.triageLevel === 'green') colorBadge = '<span style="background:#10b981;color:white;padding:1px 4px;border-radius:3px;font-weight:bold;font-size:9px;">綠</span>';
        else if (p.triageLevel === 'black') colorBadge = '<span style="background:#1e293b;color:#94a3b8;border:1px solid #334155;padding:1px 4px;border-radius:3px;font-weight:bold;font-size:9px;">黑</span>';

        let basicInfo = '';
        if (p.treatmentInfo) {
          const t = p.treatmentInfo;
          basicInfo = `${t.name || '未登錄'} (${t.gender === 'male' ? '男' : t.gender === 'female' ? '女' : '未註明'} / ${t.age ? t.age + '歲' : '年齡未知'})`;
        } else {
          basicInfo = `${p.gender === 'male' ? '男' : p.gender === 'female' ? '女' : '未註明'} / ${p.ageGroup === 'child' ? '兒童' : '成人'}`;
        }
        
        return `
          <div style="border-bottom: 1px solid rgba(255,255,255,0.06); padding: 6px 0; font-size: 11.5px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 3px;">
              <strong style="color:var(--primary);">編號: ${p.id}</strong>
              ${colorBadge}
            </div>
            <div style="color: var(--text-muted); margin-bottom: 2px;">基本: ${basicInfo}</div>
            ${p.description ? `<div style="color: #cbd5e1; font-style: italic;">備註: ${p.description}</div>` : ''}
          </div>
        `;
      }).join('');

      popupHtml = `
        <div style="font-family: 'Outfit', 'Noto Sans TC', sans-serif; color: #f8fafc; line-height: 1.4; font-size:12px; min-width: 220px; max-width: 265px; padding: 4px 0;">
          <div style="border-bottom: 1px solid #334155; padding-bottom: 6px; margin-bottom: 6px; display:flex; align-items:center; gap:6px;">
            <i data-lucide="users" style="width:14px; height:14px; color:#f59e0b;"></i>
            <strong style="color:#f59e0b; font-size:13px;">此點共有 ${groupPatients.length} 位病患</strong>
          </div>
          <div style="max-height: 180px; overflow-y: auto; padding-right: 4px;">
            ${patientItemsHtml}
          </div>
          <div style="margin-top: 8px; font-size:11px; color:var(--text-muted);">座標: ${g.lat.toFixed(5)}, ${g.lng.toFixed(5)}</div>
          <div style="border-top:1px solid #334155; padding-top:8px; margin-top:8px; text-align:center;">
            <a href="https://www.google.com/maps/search/?api=1&query=${g.lat},${g.lng}" target="_blank" style="background:#f59e0b; color:black; padding:5px 10px; border-radius:4px; text-decoration:none; font-weight:700; font-size:11px; display:inline-flex; align-items:center; gap:4px; width: 100%; justify-content: center;">
              📍 Google Maps 導航
            </a>
          </div>
        </div>
      `;
    }

    const marker = L.circleMarker([g.lat, g.lng], {
      radius: markerRadius,
      fillColor: fillColor,
      color: '#ffffff',
      weight: markerWeight,
      fillOpacity: 0.95
    }).addTo(map).bindPopup(popupHtml);
    
    // If multiple patients, add a permanent tooltip showing the count next to the marker
    if (groupPatients.length > 1) {
      marker.bindTooltip(`${groupPatients.length} 人`, {
        permanent: true,
        direction: 'right',
        className: 'cluster-tooltip',
        offset: [8, 0]
      });
    }
    
    bounds.push([g.lat, g.lng]);
  });

  if (bounds.length > 0) {
    map.fitBounds(bounds, { padding: [30, 30] });
  }
}
