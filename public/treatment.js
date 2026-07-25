let systemState = {
  incidentName: '大傷緊急醫療事件',
  patients: [],
  vehicles: [],
  hospitals: []
};

let activeTab = 'waiting'; // 'waiting' or 'assessed'
let searchFilter = '';
let socket = null;
let hasWebSocket = false;
let selectedInjuredParts = new Set();
let selectedTriageLevel = null;

// Audio feedback context
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playBeep(type) {
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    if (type === 'success') {
      osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
      gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
      osc.stop(audioCtx.currentTime + 0.15);
    } else if (type === 'error') {
      osc.frequency.setValueAtTime(220, audioCtx.currentTime); // A3
      gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
      osc.stop(audioCtx.currentTime + 0.3);
    }
  } catch (e) {
    console.warn('Audio playback not allowed or failed:', e);
  }
}

// Initialize Websocket
function initConnection() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  socket = new WebSocket(wsUrl);
  
  socket.onopen = () => {
    hasWebSocket = true;
    updateConnectionUI(true);
  };
  
  socket.onclose = () => {
    hasWebSocket = false;
    updateConnectionUI(false);
    // Retry connection after 5 seconds
    setTimeout(initConnection, 5000);
  };
  
  socket.onerror = () => {
    hasWebSocket = false;
    updateConnectionUI(false);
  };
  
  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'init' || message.type === 'STATE_UPDATE') {
        systemState = message.data;
        updateIncidentName();
        renderPatientsList();
      }
    } catch (err) {
      console.error('[Treatment WS] Error:', err);
    }
  };
  
  // Local fallback storage monitoring
  window.addEventListener('storage', (e) => {
    if (e.key === 'mci_triage_state') {
      loadLocalState();
      renderPatientsList();
    }
  });
  
  loadLocalState();
}

function loadLocalState() {
  const saved = localStorage.getItem('mci_triage_state');
  if (saved) {
    systemState = JSON.parse(saved);
    updateIncidentName();
  }
}

function updateIncidentName() {
  const display = document.getElementById('incidentDisplay');
  if (display && systemState.incidentName) {
    display.innerText = systemState.incidentName;
  }
}

function updateConnectionUI(connected) {
  const dot = document.getElementById('connectionStatusDot');
  const text = document.getElementById('connectionStatusText');
  if (dot && text) {
    if (connected) {
      dot.className = 'status-dot online';
      text.innerText = '已連線 (雲端同步)';
      text.style.color = '#10b981';
    } else {
      dot.className = 'status-dot offline';
      text.innerText = '離線模式 (儲存至本機)';
      text.style.color = 'var(--text-muted)';
    }
  }
}

// Send actions to server or save locally
function sendAction(type, data) {
  if (hasWebSocket && socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type, data }));
  } else {
    // Local fallback database write
    const saved = localStorage.getItem('mci_triage_state');
    let localState = saved ? JSON.parse(saved) : {};
    if (!localState.patients) localState.patients = [];
    
    if (type === 'UPDATE_PATIENT') {
      const pIdx = localState.patients.findIndex(p => p.id === data.id);
      if (pIdx !== -1) {
        localState.patients[pIdx] = {
          ...localState.patients[pIdx],
          ...data
        };
        localStorage.setItem('mci_triage_state', JSON.stringify(localState));
        systemState = localState;
        renderPatientsList();
      }
    }
  }
}

// Navigation Tabs
function switchTab(tabName) {
  activeTab = tabName;
  const tabWaiting = document.getElementById('tabWaiting');
  const tabAssessed = document.getElementById('tabAssessed');
  const pageWaiting = document.getElementById('pageWaiting');
  const pageAssessed = document.getElementById('pageAssessed');
  
  if (tabName === 'waiting') {
    tabWaiting.className = 'btn';
    tabAssessed.className = 'btn btn-secondary';
    pageWaiting.style.display = 'block';
    pageAssessed.style.display = 'none';
  } else {
    tabWaiting.className = 'btn btn-secondary';
    tabAssessed.className = 'btn';
    pageWaiting.style.display = 'none';
    pageAssessed.style.display = 'block';
  }
  
  renderPatientsList();
}

// Patients List Rendering
function renderPatientsList() {
  const waitingList = document.getElementById('waitingListContainer');
  const assessedList = document.getElementById('assessedListContainer');
  
  if (!systemState.patients) systemState.patients = [];
  
  // Filter out patients by status and treatment record presence
  // We only show patients who are at the scene (status === 'waiting' or status === 'triage')
  // i.e., patients who are not yet transported!
  const scenePatients = systemState.patients.filter(p => p.status === 'waiting' || p.status === 'triage' || !p.status);
  
  const waitingPatients = scenePatients.filter(p => !p.treatmentInfo);
  const assessedPatients = scenePatients.filter(p => p.treatmentInfo);
  
  // Update badges counts
  document.getElementById('waitingCount').innerText = waitingPatients.length;
  document.getElementById('assessedCount').innerText = assessedPatients.length;
  
  // Apply Search Filter
  const query = searchFilter.toLowerCase().trim();
  const filterFn = p => {
    if (!query) return true;
    
    const idMatch = p.id.toLowerCase().includes(query);
    const descMatch = (p.description || '').toLowerCase().includes(query);
    const locMatch = (p.location || '').toLowerCase().includes(query);
    
    let treatmentMatch = false;
    if (p.treatmentInfo) {
      const nameMatch = (p.treatmentInfo.name || '').toLowerCase().includes(query);
      const natMatch = (p.treatmentInfo.nationalId || '').toLowerCase().includes(query);
      const partsMatch = (p.treatmentInfo.injuredParts || []).some(x => x.toLowerCase().includes(query));
      treatmentMatch = nameMatch || natMatch || partsMatch;
    }
    
    return idMatch || descMatch || locMatch || treatmentMatch;
  };
  
  const filteredWaiting = waitingPatients.filter(filterFn);
  const filteredAssessed = assessedPatients.filter(filterFn);
  
  // Render Waiting List
  if (filteredWaiting.length === 0) {
    waitingList.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size:13px; padding:30px 0;">目前無符合的待評估傷患</div>`;
  } else {
    waitingList.innerHTML = filteredWaiting.map(p => {
      const timeStr = p.timestamp ? new Date(p.timestamp).toLocaleTimeString('zh-TW', { hour12: false }) : '';
      return `
        <div class="history-item ${p.triageLevel}" onclick="openAssessmentModal('${p.id}')" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
          <div style="text-align:left;">
            <div style="font-weight:800; font-size:15px; display:flex; align-items:center; gap:8px;">
              患者 ${p.id}
            </div>
            <div style="font-size:11.5px; color:var(--text-muted); margin-top:5px;">
              位置: ${p.location || '現場'}
            </div>
            <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px;">
              描述: ${p.description || '無描述'}
            </div>
          </div>
          <div style="text-align:right; display:flex; flex-direction:column; align-items:flex-end;">
            <span class="triage-badge ${p.triageLevel}" style="font-size:10px; padding:3px 8px;">${getTriageLabel(p.triageLevel)}</span>
            <div style="font-size:10px; color:var(--text-muted); margin-top:6px;">${timeStr}</div>
          </div>
        </div>
      `;
    }).join('');
  }
  
  // Render Assessed List
  if (filteredAssessed.length === 0) {
    assessedList.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size:13px; padding:30px 0;">目前無符合的已評估病歷</div>`;
  } else {
    assessedList.innerHTML = filteredAssessed.map(p => {
      const t = p.treatmentInfo;
      const partsText = (t.injuredParts && t.injuredParts.length > 0) ? t.injuredParts.join(', ') : '無外傷';
      const nameText = t.name ? `${t.name}` : '未填姓名';
      const timeStr = t.lastUpdated ? new Date(t.lastUpdated).toLocaleTimeString('zh-TW', { hour12: false }) : '';
      
      // Calculate vital summaries to preview
      const vitalsPreview = [];
      if (t.vitals.gcs) vitalsPreview.push(`GCS: ${t.vitals.gcs}`);
      if (t.vitals.spo2) vitalsPreview.push(`SpO2: ${t.vitals.spo2}%`);
      if (t.vitals.bpSystolic && t.vitals.bpDiastolic) vitalsPreview.push(`BP: ${t.vitals.bpSystolic}/${t.vitals.bpDiastolic}`);
      if (t.vitals.hr) vitalsPreview.push(`HR: ${t.vitals.hr}`);
      
      const vitalsPreviewStr = vitalsPreview.length > 0 ? vitalsPreview.join(' | ') : '生命徵象未錄';

      return `
        <div class="history-item ${p.triageLevel}" onclick="openAssessmentModal('${p.id}')" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center;">
          <div style="text-align:left; flex:1; padding-right:12px;">
            <div style="font-weight:800; font-size:15px; display:flex; align-items:center; gap:8px;">
              患者 ${p.id} (${nameText})
              <i data-lucide="file-check" style="width:14px; height:14px; color:#10b981;"></i>
            </div>
            <div style="font-size:11.5px; color:#10b981; margin-top:5px; font-weight:600;">
              部位: ${partsText}
            </div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:3px;">
              ${vitalsPreviewStr}
            </div>
          </div>
          <div style="text-align:right; display:flex; flex-direction:column; align-items:flex-end; justify-content:center; min-width:80px;">
            <span class="triage-badge ${p.triageLevel}" style="font-size:10px; padding:3px 8px;">${getTriageLabel(p.triageLevel)}</span>
            <div style="font-size:10px; color:var(--text-muted); margin-top:6px;">${timeStr}</div>
          </div>
        </div>
      `;
    }).join('');
  }
  
  lucide.createIcons();
}

function getTriageLabel(color) {
  switch (color) {
    case 'red': return '立即 (紅)';
    case 'yellow': return '延遲 (黃)';
    case 'green': return '輕傷 (綠)';
    case 'black': return '死亡 (黑)';
    default: return '未知';
  }
}

// Search filtration
function filterPatients() {
  searchFilter = document.getElementById('searchInput').value;
  renderPatientsList();
}

// Modal open controllers
function openAssessmentModal(patientId) {
  const p = systemState.patients.find(x => x.id === patientId);
  if (!p) return;
  
  document.getElementById('assessPatientId').value = patientId;
  document.getElementById('assessmentModalTitle').innerText = `✏️ 臨床病歷登錄 - 患者 ${patientId}`;
  
  // Initialize form fields
  selectedInjuredParts.clear();
  document.getElementById('assessName').value = '';
  document.getElementById('assessNationalId').value = '';
  document.getElementById('assessPhone').value = '';
  document.getElementById('assessNotes').value = '';
  
  document.getElementById('assessGcs').value = '';
  document.getElementById('assessBpSys').value = '';
  document.getElementById('assessBpDia').value = '';
  document.getElementById('assessHr').value = '';
  document.getElementById('assessRr').value = '';
  document.getElementById('assessSpo2').value = '';
  document.getElementById('assessTemp').value = '';
  
  // Set default triage color
  setAssessTriage(p.triageLevel);
  
  // If treatmentInfo already exists, populate it
  if (p.treatmentInfo) {
    const t = p.treatmentInfo;
    document.getElementById('assessName').value = t.name || '';
    document.getElementById('assessNationalId').value = t.nationalId || '';
    document.getElementById('assessPhone').value = t.phone || '';
    document.getElementById('assessNotes').value = t.notes || '';
    
    selectAssessGender(t.gender || 'unknown');
    selectAssessAge(t.ageGroup || 'adult');
    
    if (t.vitals) {
      document.getElementById('assessGcs').value = t.vitals.gcs || '';
      document.getElementById('assessBpSys').value = t.vitals.bpSystolic || '';
      document.getElementById('assessBpDia').value = t.vitals.bpDiastolic || '';
      document.getElementById('assessHr').value = t.vitals.hr || '';
      document.getElementById('assessRr').value = t.vitals.rr || '';
      document.getElementById('assessSpo2').value = t.vitals.spo2 || '';
      document.getElementById('assessTemp').value = t.vitals.temp || '';
    }
    
    if (t.injuredParts) {
      t.injuredParts.forEach(part => selectedInjuredParts.add(part));
    }
    
    if (t.updatedTriageLevel) {
      setAssessTriage(t.updatedTriageLevel);
    }
  } else {
    // Default initializations for new assessment
    selectAssessGender(p.gender || 'unknown');
    selectAssessAge(p.ageGroup || 'adult');
  }
  
  // Render toggles & checkbox buttons
  updateInjuredPartsUI();
  
  // Validate vitals inputs for warning colors
  validateAllVitals();
  
  document.getElementById('assessmentModal').classList.add('show');
  lucide.createIcons();
}

function closeAssessmentModal() {
  document.getElementById('assessmentModal').classList.remove('show');
}

// Basic Info Toggles
function selectAssessGender(gender) {
  document.getElementById('assessGender').value = gender;
  
  const btns = document.querySelectorAll('.assess-gender-btn');
  btns.forEach(b => b.classList.remove('active'));
  
  const target = document.getElementById('assessGender' + gender.charAt(0).toUpperCase() + gender.slice(1));
  if (target) target.classList.add('active');
}

function selectAssessAge(age) {
  document.getElementById('assessAgeGroup').value = age;
  
  const btns = document.querySelectorAll('.assess-age-btn');
  btns.forEach(b => b.classList.remove('active'));
  
  const target = document.getElementById('assessAge' + age.charAt(0).toUpperCase() + age.slice(1));
  if (target) target.classList.add('active');
}

// Injured Parts Selection
function toggleInjuredPart(part) {
  if (part === '無明顯外傷') {
    if (selectedInjuredParts.has('無明顯外傷')) {
      selectedInjuredParts.delete('無明顯外傷');
    } else {
      selectedInjuredParts.clear();
      selectedInjuredParts.add('無明顯外傷');
    }
  } else {
    selectedInjuredParts.delete('無明顯外傷');
    if (selectedInjuredParts.has(part)) {
      selectedInjuredParts.delete(part);
    } else {
      selectedInjuredParts.add(part);
    }
  }
  
  updateInjuredPartsUI();
}

function updateInjuredPartsUI() {
  const parts = ['Head', 'Neck', 'Chest', 'Abdomen', 'Pelvis', 'Limbs', 'Back', 'Burns', 'None'];
  const partMap = {
    'Head': '頭部', 'Neck': '頸部', 'Chest': '胸部', 'Abdomen': '腹部',
    'Pelvis': '骨盆', 'Limbs': '四肢肢體', 'Back': '背部脊椎', 'Burns': '燒燙傷', 'None': '無明顯外傷'
  };
  
  parts.forEach(p => {
    const btn = document.getElementById('part' + p);
    if (btn) {
      const dbVal = partMap[p];
      if (selectedInjuredParts.has(dbVal)) {
        btn.classList.add('active');
        btn.style.background = 'rgba(16, 185, 129, 0.2)';
        btn.style.borderColor = '#10b981';
        btn.style.color = 'white';
      } else {
        btn.classList.remove('active');
        btn.style.background = 'rgba(255, 255, 255, 0.05)';
        btn.style.borderColor = 'var(--border-color)';
        btn.style.color = 'var(--text-muted)';
      }
    }
  });
}

// Vital Signs warnings
function validateVital(vitalType) {
  let val = null;
  let input = null;
  let isDanger = false;
  
  if (vitalType === 'spo2') {
    input = document.getElementById('assessSpo2');
    val = parseInt(input.value);
    if (val && val < 94) isDanger = true; // Low blood oxygen
  } else if (vitalType === 'bpsys') {
    input = document.getElementById('assessBpSys');
    val = parseInt(input.value);
    if (val && (val < 90 || val > 150)) isDanger = true; // Hypotension / Hypertension
  } else if (vitalType === 'hr') {
    input = document.getElementById('assessHr');
    val = parseInt(input.value);
    if (val && (val < 50 || val > 120)) isDanger = true; // Bradycardia / Tachycardia
  } else if (vitalType === 'rr') {
    input = document.getElementById('assessRr');
    val = parseInt(input.value);
    if (val && (val < 10 || val > 29)) isDanger = true; // Tachypnea / Bradypnea
  } else if (vitalType === 'temp') {
    input = document.getElementById('assessTemp');
    val = parseFloat(input.value);
    if (val && (val < 35.0 || val > 38.5)) isDanger = true; // Hypothermia / Hyperthermia
  }
  
  if (input) {
    if (isDanger) {
      input.style.borderColor = 'var(--triage-red)';
      input.style.background = 'rgba(244, 63, 94, 0.15)';
      input.style.color = 'var(--triage-red)';
    } else {
      input.style.borderColor = 'var(--border-color)';
      input.style.background = 'rgba(0, 0, 0, 0.3)';
      input.style.color = 'var(--text-main)';
    }
  }
}

function validateAllVitals() {
  validateVital('spo2');
  validateVital('bpsys');
  validateVital('hr');
  validateVital('rr');
  validateVital('temp');
}

// Secondary Triage Override selection
function setAssessTriage(color) {
  selectedTriageLevel = color;
  document.getElementById('assessTriageLevel').value = color;
  
  const btns = document.querySelectorAll('.assess-triage-btn');
  btns.forEach(btn => {
    btn.classList.remove('active');
    btn.style.transform = 'scale(1)';
    btn.style.border = '1px solid rgba(255,255,255,0.05)';
    btn.style.boxShadow = 'none';
  });
  
  let activeBtn = null;
  if (color === 'red') activeBtn = document.querySelector('.assess-triage-btn.red');
  else if (color === 'yellow') activeBtn = document.querySelector('.assess-triage-btn.yellow');
  else if (color === 'green') activeBtn = document.querySelector('.assess-triage-btn.green');
  else if (color === 'black') activeBtn = document.querySelector('.assess-triage-btn.black');
  
  if (activeBtn) {
    activeBtn.classList.add('active');
    activeBtn.style.transform = 'scale(1.03)';
    activeBtn.style.boxShadow = `0 0 12px var(--triage-${color})`;
    activeBtn.style.border = `2px solid var(--triage-${color === 'black' ? 'slate' : color})`;
  }
}

// Form submit assessment
function saveAssessment(event) {
  event.preventDefault();
  
  const patientId = document.getElementById('assessPatientId').value;
  const name = document.getElementById('assessName').value.trim();
  const nationalId = document.getElementById('assessNationalId').value.trim().toUpperCase();
  const phone = document.getElementById('assessPhone').value.trim();
  const gender = document.getElementById('assessGender').value;
  const ageGroup = document.getElementById('assessAgeGroup').value;
  
  const gcs = document.getElementById('assessGcs').value.trim();
  const bpSystolic = document.getElementById('assessBpSys').value.trim();
  const bpDiastolic = document.getElementById('assessBpDia').value.trim();
  const hr = document.getElementById('assessHr').value.trim();
  const rr = document.getElementById('assessRr').value.trim();
  const spo2 = document.getElementById('assessSpo2').value.trim();
  const temp = document.getElementById('assessTemp').value.trim();
  
  const notes = document.getElementById('assessNotes').value.trim();
  const triageLevel = selectedTriageLevel;
  
  const treatmentInfo = {
    name,
    nationalId,
    phone,
    gender,
    ageGroup,
    injuredParts: Array.from(selectedInjuredParts),
    vitals: {
      gcs,
      bpSystolic,
      bpDiastolic,
      hr,
      rr,
      spo2,
      temp
    },
    updatedTriageLevel: triageLevel,
    notes,
    lastUpdated: new Date().toISOString()
  };
  
  const payload = {
    id: patientId,
    triageLevel, // Updates secondary triage level centrally
    gender,      // Updates general schema fields
    ageGroup,
    treatmentInfo
  };
  
  // Submit action
  sendAction('UPDATE_PATIENT', payload);
  
  // Play success beep
  playBeep('success');
  
  closeAssessmentModal();
  alert(`患者 ${patientId} 治療區臨床病歷儲存成功！`);
}

document.addEventListener('DOMContentLoaded', () => {
  initConnection();
  lucide.createIcons();
});
