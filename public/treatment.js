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
let injuredPartsNotes = {};

const mannequinSelectorMap = {
  '頭部(前)': ['mq-Head'],
  '頭部(後)': ['mq-Head-back'],
  '頸部(前)': ['mq-Neck'],
  '頸部(後)': ['mq-Neck-back'],
  '胸部': ['mq-Chest'],
  '腹部': ['mq-Abdomen'],
  '骨盆(前)': ['mq-Pelvis'],
  '骨盆(後)': ['mq-Pelvis-back'],
  '背部脊椎': ['mq-Back'],
  '左上臂(前)': ['mq-Larm-upper'],
  '左上臂(後)': ['mq-Larm-upper-back'],
  '左前臂(前)': ['mq-Larm-fore'],
  '左前臂(後)': ['mq-Larm-fore-back'],
  '左手(前)': ['mq-Lhand'],
  '左手(後)': ['mq-Lhand-back'],
  '左大腿(前)': ['mq-Lleg-thigh'],
  '左大腿(後)': ['mq-Lleg-thigh-back'],
  '左小腿(前)': ['mq-Lleg-shin'],
  '左小腿(後)': ['mq-Lleg-shin-back'],
  '右上臂(前)': ['mq-Rarm-upper'],
  '右上臂(後)': ['mq-Rarm-upper-back'],
  '右前臂(前)': ['mq-Rarm-fore'],
  '右前臂(後)': ['mq-Rarm-fore-back'],
  '右手(前)': ['mq-Rhand'],
  '右手(後)': ['mq-Rhand-back'],
  '右大腿(前)': ['mq-Rleg-thigh'],
  '右大腿(後)': ['mq-Rleg-thigh-back'],
  '右小腿(前)': ['mq-Rleg-shin'],
  '右小腿(後)': ['mq-Rleg-shin-back']
};
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
  
  const waitingPatients = scenePatients.filter(p => !p.treatmentInfo || p.treatmentInfo.assessmentStatus === 'waiting');
  const assessedPatients = scenePatients.filter(p => p.treatmentInfo && p.treatmentInfo.assessmentStatus === 'assessed');
  
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
            <div style="font-size:11px; color:var(--triage-yellow); margin-top:5px; font-weight:600; display:flex; align-items:center; gap:4px;">
              <i data-lucide="refresh-cw" style="width:11px; height:11px;"></i>
              檢傷次數: ${p.treatmentInfo && p.treatmentInfo.assessmentCount ? p.treatmentInfo.assessmentCount : 1} 次
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
            <div style="font-size:11px; color:var(--triage-yellow); margin-top:5px; font-weight:600; display:flex; align-items:center; gap:4px;">
              <i data-lucide="refresh-cw" style="width:11px; height:11px;"></i>
              檢傷次數: ${t.assessmentCount || 2} 次
            </div>
          </div>
          <div style="text-align:right; display:flex; flex-direction:column; align-items:flex-end; justify-content:center; min-width:90px;">
            <span class="triage-badge ${p.triageLevel}" style="font-size:10px; padding:3px 8px;">${getTriageLabel(p.triageLevel)}</span>
            <div style="font-size:10px; color:var(--text-muted); margin-top:6px;">${timeStr}</div>
            <div class="countdown-timer" data-patient-id="${p.id}" style="font-size:11px; font-weight:700; color:var(--triage-yellow); margin-top:6px; display:${p.triageLevel === 'black' ? 'none' : 'flex'}; align-items:center; gap:4px;">
              <i data-lucide="clock" style="width:12px; height:12px;"></i>
              <span class="timer-countdown-text">${p.triageLevel === 'green' ? '20:00' : (p.triageLevel === 'yellow' ? '15:00' : '10:00')}</span>
            </div>
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
  
  let currentCount = 1;
  if (p.treatmentInfo && p.treatmentInfo.assessmentCount) {
    currentCount = p.treatmentInfo.assessmentCount;
  }
  let nextCount = currentCount;
  if (!p.treatmentInfo || p.treatmentInfo.assessmentStatus === 'waiting') {
    nextCount = currentCount + 1;
  }
  
  document.getElementById('assessPatientId').value = patientId;
  document.getElementById('assessmentModalTitle').innerText = `✏️ 治療區 - 患者 ${patientId} (第 ${nextCount} 次檢傷)`;
  
  // Initialize form fields
  selectedInjuredParts.clear();
  injuredPartsNotes = {};
  document.getElementById('assessName').value = '';
  document.getElementById('assessNationalId').value = '';
  document.getElementById('assessPhone').value = '';
  document.getElementById('assessNotes').value = '';
  document.getElementById('assessDobYear').value = '';
  document.getElementById('assessDobMonth').value = '';
  document.getElementById('assessDobDay').value = '';
  document.getElementById('assessAge').value = '';
  
  // GCS slider parsing initialization
  let gcsStr = '';
  if (p.treatmentInfo && p.treatmentInfo.vitals) {
    gcsStr = p.treatmentInfo.vitals.gcs || '';
  }
  
  let eVal = 4, vVal = 5, mVal = 6;
  let ent = false, vnt = false, mnt = false;
  
  if (gcsStr.includes('ENT') || gcsStr.includes('E-NT') || gcsStr.match(/E\s*NT/i)) {
    ent = true;
  } else {
    const matchE = gcsStr.match(/E(\d)/i);
    if (matchE) eVal = parseInt(matchE[1]);
  }
  
  if (gcsStr.includes('VNT') || gcsStr.includes('V-NT') || gcsStr.match(/V\s*NT/i)) {
    vnt = true;
  } else {
    const matchV = gcsStr.match(/V(\d)/i);
    if (matchV) vVal = parseInt(matchV[1]);
  }
  
  if (gcsStr.includes('MNT') || gcsStr.includes('M-NT') || gcsStr.match(/M\s*NT/i)) {
    mnt = true;
  } else {
    const matchM = gcsStr.match(/M(\d)/i);
    if (matchM) mVal = parseInt(matchM[1]);
  }
  
  document.getElementById('gcsENT').checked = ent;
  document.getElementById('gcsVNT').checked = vnt;
  document.getElementById('gcsMNT').checked = mnt;
  
  document.getElementById('gcsE').value = eVal;
  document.getElementById('gcsV').value = vVal;
  document.getElementById('gcsM').value = mVal;
  
  updateGcsScore();

  document.getElementById('assessBpSys').value = '';
  document.getElementById('assessBpDia').value = '';
  document.getElementById('assessHr').value = '';
  document.getElementById('assessRr').value = '';
  document.getElementById('assessSpo2').value = '';
  document.getElementById('assessTemp').value = '';
  
  // Set default triage color
  setAssessTriage(p.triageLevel);
  
  // Set default time for medication input
  const timeNow = new Date();
  const timeStr = timeNow.toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' });
  const medTimeInput = document.getElementById('medTime');
  if (medTimeInput) medTimeInput.value = timeStr;

  // If treatmentInfo already exists, populate it
  if (p.treatmentInfo) {
    const t = p.treatmentInfo;
    document.getElementById('assessName').value = t.name || '';
    document.getElementById('assessNationalId').value = t.nationalId || '';
    document.getElementById('assessPhone').value = t.phone || '';
    document.getElementById('assessNotes').value = t.notes || '';
    
    let yVal = '', mVal = '', dVal = '';
    if (t.dob) {
      const dobParts = t.dob.split('-');
      if (dobParts.length === 3) {
        yVal = dobParts[0];
        mVal = parseInt(dobParts[1], 10);
        dVal = parseInt(dobParts[2], 10);
      }
    }
    document.getElementById('assessDobYear').value = yVal;
    document.getElementById('assessDobMonth').value = mVal;
    document.getElementById('assessDobDay').value = dVal;
    
    document.getElementById('assessAge').value = t.age || '';
    selectAssessGender(t.gender || 'unknown');
    
    if (t.vitals) {
      document.getElementById('assessBpSys').value = t.vitals.bpSystolic || '';
      document.getElementById('assessBpDia').value = t.vitals.bpDiastolic || '';
      document.getElementById('assessHr').value = t.vitals.hr || '';
      document.getElementById('assessRr').value = t.vitals.rr || '';
      document.getElementById('assessSpo2').value = t.vitals.spo2 || '';
      document.getElementById('assessTemp').value = t.vitals.temp || '';
    }
    
    if (t.injuredParts) {
      t.injuredParts.forEach(x => selectedInjuredParts.add(x));
    }
    
    injuredPartsNotes = {};
    if (t.injuredPartsNotes) {
      injuredPartsNotes = { ...t.injuredPartsNotes };
    }
    
    patientMedications = [];
    if (t.medications) {
      patientMedications = [...t.medications];
    }
    renderMedicationsTable();
    
    if (t.updatedTriageLevel) {
      setAssessTriage(t.updatedTriageLevel);
    }
  } else {
    // Default initializations for new assessment
    selectAssessGender(p.gender || 'unknown');
    if (p.ageGroup === 'child') {
      document.getElementById('assessAge').value = '10';
    } else if (p.ageGroup === 'adult') {
      document.getElementById('assessAge').value = '30';
    }
    
    patientMedications = [];
    renderMedicationsTable();
  }
  
  // Render toggles & checkbox buttons
  updateInjuredPartsUI();
  
  // Validate vitals inputs for warning colors
  validateAllVitals();
  
  // Render historical vitals comparison table
  renderVitalsHistory(p);
  
  document.getElementById('assessmentModal').classList.add('show');
  lucide.createIcons();
}

function renderVitalsHistory(p) {
  const container = document.getElementById('vitalsHistoryContainer');
  if (!container) return;
  
  const history = (p.treatmentInfo && p.treatmentInfo.vitalsHistory) || [];
  
  if (history.length === 0) {
    if (p.treatmentInfo && p.treatmentInfo.vitals) {
      const current = {
        timestamp: p.treatmentInfo.lastUpdated || new Date().toISOString(),
        triageLevel: p.treatmentInfo.updatedTriageLevel || p.triageLevel,
        assessmentIndex: p.treatmentInfo.assessmentCount || 1,
        vitals: p.treatmentInfo.vitals
      };
      renderHistoryTable([current], container);
    } else {
      container.innerHTML = `<div style="font-size: 12px; color: var(--text-muted); text-align: center; padding: 10px 0;">暫無多次檢傷歷史紀錄</div>`;
    }
  } else {
    const sorted = [...history].sort((a, b) => a.assessmentIndex - b.assessmentIndex);
    renderHistoryTable(sorted, container);
  }
}

function renderHistoryTable(list, container) {
  let rows = list.map(item => {
    const timeStr = item.timestamp ? new Date(item.timestamp).toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' }) : '-';
    
    let levelBadge = '';
    const lvl = item.triageLevel;
    if (lvl === 'red') levelBadge = `<span style="background:var(--triage-red); color:white; padding:2px 6px; border-radius:3px; font-weight:bold; font-size:10px;">立即</span>`;
    else if (lvl === 'yellow') levelBadge = `<span style="background:var(--triage-yellow); color:black; padding:2px 6px; border-radius:3px; font-weight:bold; font-size:10px;">延遲</span>`;
    else if (lvl === 'green') levelBadge = `<span style="background:var(--triage-green); color:white; padding:2px 6px; border-radius:3px; font-weight:bold; font-size:10px;">輕傷</span>`;
    else if (lvl === 'black') levelBadge = `<span style="background:#1e293b; color:var(--text-muted); border:1px solid var(--border-color); padding:2px 6px; border-radius:3px; font-weight:bold; font-size:10px;">死亡</span>`;
    else levelBadge = `<span style="color:var(--text-muted); font-size:10px;">-</span>`;

    const v = item.vitals || {};
    const bpStr = (v.bpSystolic && v.bpDiastolic) ? `${v.bpSystolic}/${v.bpDiastolic}` : (v.bpSystolic || v.bpDiastolic || '-');
    
    return `
      <tr style="border-bottom:1px solid rgba(255,255,255,0.06);">
        <td style="padding:6px 4px; font-weight:800; color:var(--primary);">#${item.assessmentIndex}</td>
        <td style="padding:6px 4px; color:var(--text-muted);">${timeStr}</td>
        <td style="padding:6px 4px; text-align:center;">${levelBadge}</td>
        <td style="padding:6px 4px; text-align:center; font-weight:700;">${v.gcs || '-'}</td>
        <td style="padding:6px 4px; text-align:center;">${bpStr}</td>
        <td style="padding:6px 4px; text-align:center;">${v.hr ? v.hr + ' bpm' : '-'}</td>
        <td style="padding:6px 4px; text-align:center;">${v.rr ? v.rr + ' bpm' : '-'}</td>
        <td style="padding:6px 4px; text-align:center; font-weight:700; color:#10b981;">${v.spo2 ? v.spo2 + '%' : '-'}</td>
        <td style="padding:6px 4px; text-align:center;">${v.temp ? v.temp + '°C' : '-'}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <table style="width:100%; border-collapse:collapse; font-size:11.5px; text-align:left; min-width: 480px;">
      <thead>
        <tr style="border-bottom:1px solid rgba(255,255,255,0.1); color:var(--text-muted);">
          <th style="padding:4px; font-weight:600; width:45px;">次數</th>
          <th style="padding:4px; font-weight:600; width:50px;">時間</th>
          <th style="padding:4px; font-weight:600; width:50px; text-align:center;">等級</th>
          <th style="padding:4px; font-weight:600; text-align:center; width:55px;">GCS</th>
          <th style="padding:4px; font-weight:600; text-align:center; width:65px;">血壓</th>
          <th style="padding:4px; font-weight:600; text-align:center;">心跳</th>
          <th style="padding:4px; font-weight:600; text-align:center;">呼吸</th>
          <th style="padding:4px; font-weight:600; text-align:center; width:55px;">血氧</th>
          <th style="padding:4px; font-weight:600; text-align:center; width:55px;">體溫</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
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

function populateDobDropdowns() {
  const ySel = document.getElementById('assessDobYear');
  const mSel = document.getElementById('assessDobMonth');
  const dSel = document.getElementById('assessDobDay');
  
  if (!ySel || !mSel || !dSel) return;
  
  ySel.innerHTML = '<option value="">年 (西元/民國)</option>';
  const currentYear = new Date().getFullYear();
  for (let y = currentYear; y >= 1900; y--) {
    const minguo = y - 1911;
    const label = minguo > 0 ? `${y} (民國 ${minguo} 年)` : `${y} (民國前 ${Math.abs(minguo) + 1} 年)`;
    ySel.innerHTML += `<option value="${y}">${label}</option>`;
  }
  
  mSel.innerHTML = '<option value="">月</option>';
  for (let m = 1; m <= 12; m++) {
    mSel.innerHTML += `<option value="${m}">${m}月</option>`;
  }
  
  dSel.innerHTML = '<option value="">日</option>';
  for (let d = 1; d <= 31; d++) {
    dSel.innerHTML += `<option value="${d}">${d}日</option>`;
  }
}

function calculateAgeFromDobDropdowns() {
  const y = document.getElementById('assessDobYear').value;
  const m = document.getElementById('assessDobMonth').value;
  const d = document.getElementById('assessDobDay').value;
  
  const ageInput = document.getElementById('assessAge');
  if (!ageInput) return;
  
  if (!y || !m || !d) return;
  
  const dob = new Date(y, m - 1, d);
  const today = new Date();
  
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  
  ageInput.value = Math.max(0, age);
}

// Medication administration record methods
let patientMedications = [];

function addMedicationRecord() {
  const time = document.getElementById('medTime').value;
  const name = document.getElementById('medName').value;
  const route = document.getElementById('medRoute').value;
  const doseVal = document.getElementById('medDoseVal').value.trim();
  const doseUnit = document.getElementById('medDoseUnit').value;
  const remark = document.getElementById('medRemark').value.trim();
  
  if (!time) {
    alert('請指定給藥時間！');
    return;
  }
  if (!doseVal) {
    alert('請輸入劑量數值！');
    return;
  }
  
  const record = {
    time,
    name,
    route,
    dose: `${doseVal} ${doseUnit}`,
    remark: remark || '-'
  };
  
  patientMedications.push(record);
  
  // Clear input
  document.getElementById('medDoseVal').value = '';
  document.getElementById('medRemark').value = '';
  
  renderMedicationsTable();
}

function removeMedicationRecord(index) {
  patientMedications.splice(index, 1);
  renderMedicationsTable();
}

function renderMedicationsTable() {
  const body = document.getElementById('medicationListBody');
  if (!body) return;
  
  if (patientMedications.length === 0) {
    body.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:10px 0;">目前無用藥紀錄</td></tr>`;
    return;
  }
  
  body.innerHTML = patientMedications.map((m, idx) => `
    <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
      <td style="padding:6px 2px;">${m.time}</td>
      <td style="padding:6px 2px; font-weight:700; color:#10b981;">${m.name}</td>
      <td style="padding:6px 2px;">${m.route}</td>
      <td style="padding:6px 2px; font-weight:700;">${m.dose}</td>
      <td style="padding:6px 2px; color:var(--text-muted); max-width:80px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${m.remark}">${m.remark}</td>
      <td style="padding:6px 2px; text-align:center;">
        <button type="button" onclick="removeMedicationRecord(${idx})" style="background:none; border:none; color:var(--triage-red); cursor:pointer; padding:2px;">
          <i data-lucide="trash-2" style="width:13px; height:13px;"></i>
        </button>
      </td>
    </tr>
  `).join('');
  
  lucide.createIcons();
}

// Injured Parts Selection
function toggleInjuredPart(part) {
  if (part === '無明顯外傷') {
    if (selectedInjuredParts.has('無明顯外傷')) {
      selectedInjuredParts.delete('無明顯外傷');
    } else {
      selectedInjuredParts.clear();
      injuredPartsNotes = {};
      selectedInjuredParts.add('無明顯外傷');
    }
  } else {
    selectedInjuredParts.delete('無明顯外傷');
    if (selectedInjuredParts.has(part)) {
      selectedInjuredParts.delete(part);
      delete injuredPartsNotes[part];
    } else {
      selectedInjuredParts.add(part);
    }
  }
  
  updateInjuredPartsUI();
}

function clearInjuredParts() {
  selectedInjuredParts.clear();
  injuredPartsNotes = {};
  updateInjuredPartsUI();
}

function updateInjuredPartsUI() {
  // Clear active classes on all mannequin elements
  const allParts = document.querySelectorAll('.mq-part');
  allParts.forEach(el => el.classList.remove('active'));
  
  // Add active classes to selected parts
  selectedInjuredParts.forEach(part => {
    const elIds = mannequinSelectorMap[part];
    if (elIds) {
      elIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('active');
      });
    }
  });
  
  // Update button active state for quick selects
  const burnsBtn = document.getElementById('partBurnsBtn');
  const noneBtn = document.getElementById('partNoneBtn');
  
  if (burnsBtn) {
    if (selectedInjuredParts.has('燒燙傷')) {
      burnsBtn.style.background = 'rgba(239, 68, 68, 0.2)';
      burnsBtn.style.borderColor = '#ef4444';
      burnsBtn.style.color = 'white';
    } else {
      burnsBtn.style.background = '';
      burnsBtn.style.borderColor = '';
      burnsBtn.style.color = '';
    }
  }
  
  if (noneBtn) {
    if (selectedInjuredParts.has('無明顯外傷')) {
      noneBtn.style.background = 'rgba(16, 185, 129, 0.2)';
      noneBtn.style.borderColor = '#10b981';
      noneBtn.style.color = 'white';
    } else {
      noneBtn.style.background = '';
      noneBtn.style.borderColor = '';
      noneBtn.style.color = '';
    }
  }
  
  // Render injury notes text areas!
  renderInjuredPartsNotes();
}

function renderInjuredPartsNotes() {
  const container = document.getElementById('injuredPartsNotesContainer');
  if (!container) return;
  
  const activeParts = Array.from(selectedInjuredParts).filter(x => x !== '無明顯外傷');
  if (activeParts.length === 0) {
    container.innerHTML = `<div style="font-size:12px; color:var(--text-muted); text-align:center; padding:6px 0;">點擊上方人體部位以開啟傷勢備註</div>`;
    return;
  }
  
  container.innerHTML = activeParts.map(part => {
    const existingNote = injuredPartsNotes[part] || '';
    return `
      <div style="display:flex; flex-direction:column; gap:4px; margin-bottom:8px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size:12px; font-weight:700; color:#ef4444; width:65px; text-align:right; white-space:nowrap;">${part}：</span>
          <input type="text" id="part-note-${part}" class="input-control" value="${existingNote}" placeholder="輸入受傷情形 (如：撕裂傷、擦傷)" style="flex:1; font-size:12px; height:28px; padding:2px 8px;" oninput="updatePartNote('${part}', this.value)">
        </div>
        <div style="margin-left:73px; display:flex; flex-wrap:wrap; gap:4px;">
          ${['骨折', '撕裂傷', '擦傷', '挫傷', '扭傷', '穿刺傷', '燒燙傷', '紅腫'].map(type => {
            const hasType = existingNote.includes(type);
            const activeStyle = hasType ? 'background: rgba(239, 68, 68, 0.25); border-color: #ef4444; color: white;' : '';
            return `
              <button type="button" class="btn btn-secondary" style="padding:2px 6px; font-size:10px; height:20px; line-height:1; cursor:pointer; ${activeStyle}" onclick="toggleInjuryTypeKeyword('${part}', '${type}')">${type}</button>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function updatePartNote(part, value) {
  injuredPartsNotes[part] = value;
}

function toggleInjuryTypeKeyword(part, type) {
  let currentNote = injuredPartsNotes[part] || '';
  let parts = currentNote.split(/[,\s，、]+/).map(p => p.trim()).filter(p => p !== '');
  
  const index = parts.indexOf(type);
  if (index !== -1) {
    parts.splice(index, 1);
  } else {
    parts.push(type);
  }
  
  injuredPartsNotes[part] = parts.join(', ');
  renderInjuredPartsNotes();
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
  updateTriageSuggestion();
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
  });
  
  let activeBtn = null;
  if (color === 'red') activeBtn = document.querySelector('.assess-triage-btn.red');
  else if (color === 'yellow') activeBtn = document.querySelector('.assess-triage-btn.yellow');
  else if (color === 'green') activeBtn = document.querySelector('.assess-triage-btn.green');
  else if (color === 'black') activeBtn = document.querySelector('.assess-triage-btn.black');
  
  if (activeBtn) {
    activeBtn.classList.add('active');
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
  const y = document.getElementById('assessDobYear').value;
  const m = document.getElementById('assessDobMonth').value;
  const d = document.getElementById('assessDobDay').value;
  let dob = '';
  if (y && m && d) {
    dob = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const age = document.getElementById('assessAge').value.trim();
  const ageGroup = (age && parseInt(age) < 18) ? 'child' : 'adult';
  
  const gcs = document.getElementById('assessGcs').value.trim();
  const bpSystolic = document.getElementById('assessBpSys').value.trim();
  const bpDiastolic = document.getElementById('assessBpDia').value.trim();
  const hr = document.getElementById('assessHr').value.trim();
  const rr = document.getElementById('assessRr').value.trim();
  const spo2 = document.getElementById('assessSpo2').value.trim();
  const temp = document.getElementById('assessTemp').value.trim();
  
  let notes = document.getElementById('assessNotes').value.trim();
  if (notes) {
    const timestampRegex = /^\[\d{2}:\d{2}(:\d{2})?\]/;
    if (!timestampRegex.test(notes)) {
      const now = new Date();
      const timePrefix = `[${now.toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' })}] `;
      notes = timePrefix + notes;
    }
  }
  const triageLevel = selectedTriageLevel;
  
  const p = systemState.patients.find(x => x.id === patientId);
  let assessmentCount = 1;
  let vitalsHistory = [];
  if (p && p.treatmentInfo) {
    if (p.treatmentInfo.assessmentCount) {
      assessmentCount = p.treatmentInfo.assessmentCount;
    }
    if (p.treatmentInfo.vitalsHistory) {
      vitalsHistory = [...p.treatmentInfo.vitalsHistory];
    }
  }
  if (!p || !p.treatmentInfo || p.treatmentInfo.assessmentStatus === 'waiting') {
    assessmentCount += 1;
  }

  // Create current vitals record
  const newVitalsRecord = {
    timestamp: new Date().toISOString(),
    triageLevel: triageLevel,
    assessmentIndex: assessmentCount,
    vitals: {
      gcs,
      bpSystolic,
      bpDiastolic,
      hr,
      rr,
      spo2,
      temp
    }
  };

  // Avoid duplicate records for the same assessment count index
  const existingIdx = vitalsHistory.findIndex(h => h.assessmentIndex === assessmentCount);
  if (existingIdx > -1) {
    vitalsHistory[existingIdx] = newVitalsRecord;
  } else {
    vitalsHistory.push(newVitalsRecord);
  }

  const treatmentInfo = {
    name,
    nationalId,
    phone,
    gender,
    dob,
    age,
    ageGroup,
    injuredParts: Array.from(selectedInjuredParts),
    injuredPartsNotes: { ...injuredPartsNotes },
    medications: [...patientMedications],
    vitals: {
      gcs,
      bpSystolic,
      bpDiastolic,
      hr,
      rr,
      spo2,
      temp
    },
    vitalsHistory,
    updatedTriageLevel: triageLevel,
    notes,
    lastUpdated: new Date().toISOString(),
    assessmentStatus: 'assessed',
    assessmentCount: assessmentCount,
    assessmentCompletedAt: Date.now()
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

// Update GCS score display dynamically, handling NT (Not Testable) checkboxes
function updateGcsScore() {
  const ent = document.getElementById('gcsENT').checked;
  const vnt = document.getElementById('gcsVNT').checked;
  const mnt = document.getElementById('gcsMNT').checked;
  
  const eSlider = document.getElementById('gcsE');
  const vSlider = document.getElementById('gcsV');
  const mSlider = document.getElementById('gcsM');
  
  if (eSlider) eSlider.disabled = ent;
  if (vSlider) vSlider.disabled = vnt;
  if (mSlider) mSlider.disabled = mnt;
  
  const eVal = ent ? 'NT' : (eSlider ? eSlider.value : 4);
  const vVal = vnt ? 'NT' : (vSlider ? vSlider.value : 5);
  const mVal = mnt ? 'NT' : (mSlider ? mSlider.value : 6);
  
  const displayE = document.getElementById('gcsEDisplay');
  const displayV = document.getElementById('gcsVDisplay');
  const displayM = document.getElementById('gcsMDisplay');
  
  if (displayE) displayE.innerText = eVal;
  if (displayV) displayV.innerText = vVal;
  if (displayM) displayM.innerText = mVal;
  
  let totalScore = 0;
  let anyNT = false;
  
  if (ent) anyNT = true; else totalScore += parseInt(eSlider.value);
  if (vnt) anyNT = true; else totalScore += parseInt(vSlider.value);
  if (mnt) anyNT = true; else totalScore += parseInt(mSlider.value);
  
  let totalText = '';
  if (ent && vnt && mnt) {
    totalText = 'NT';
  } else if (anyNT) {
    totalText = `${totalScore}+NT`;
  } else {
    totalText = totalScore;
  }
  
  const totalDisplay = document.getElementById('gcsTotalDisplay');
  if (totalDisplay) {
    totalDisplay.innerText = `GCS ${totalText} (E${eVal} V${vVal} M${mVal})`;
  }
  
  const assessGcsInput = document.getElementById('assessGcs');
  if (assessGcsInput) {
    assessGcsInput.value = `${totalText} (E${eVal}V${vVal}M${mVal})`;
  }
  
  updateTriageSuggestion();
}

// Physiological pre-judgment based on clinical vitals criteria
let currentSuggestedTriage = null;

function predictTriageFromVitals() {
  const ent = document.getElementById('gcsENT').checked;
  const vnt = document.getElementById('gcsVNT').checked;
  const mnt = document.getElementById('gcsMNT').checked;
  const e = parseInt(document.getElementById('gcsE').value) || 4;
  const v = parseInt(document.getElementById('gcsV').value) || 5;
  const m = parseInt(document.getElementById('gcsM').value) || 6;
  const gcsTotal = ent || vnt || mnt ? null : (e + v + m);
  
  const spo2Input = document.getElementById('assessSpo2');
  const sbpInput = document.getElementById('assessBpSys');
  const hrInput = document.getElementById('assessHr');
  const rrInput = document.getElementById('assessRr');
  const tempInput = document.getElementById('assessTemp');
  
  const spo2 = spo2Input && spo2Input.value ? parseInt(spo2Input.value) : null;
  const sbp = sbpInput && sbpInput.value ? parseInt(sbpInput.value) : null;
  const hr = hrInput && hrInput.value ? parseInt(hrInput.value) : null;
  const rr = rrInput && rrInput.value ? parseInt(rrInput.value) : null;
  const temp = tempInput && tempInput.value ? parseFloat(tempInput.value) : null;
  
  // If NO values are entered at all, return null
  if (gcsTotal === null && spo2 === null && sbp === null && hr === null && rr === null) {
    return null;
  }
  
  // 1. Black (Deceased)
  if (rr === 0 && hr === 0) {
    return 'black';
  }
  
  // 2. Red (Immediate / 🔴)
  if (
    (gcsTotal !== null && gcsTotal <= 8) ||                     // Coma / Severe brain injury
    (spo2 !== null && spo2 < 90) ||                             // Severe hypoxemia
    (sbp !== null && sbp < 90) ||                               // Shock (Systolic BP < 90)
    (rr !== null && (rr >= 30 || rr < 10)) ||                   // Severe tachypnea/apnea
    (hr !== null && (hr >= 120 || hr < 50))                     // Severe tachycardia/bradycardia
  ) {
    return 'red';
  }
  
  // 3. Yellow (Delayed / 🟡)
  if (
    (gcsTotal !== null && gcsTotal >= 9 && gcsTotal <= 13) ||   // Moderate neurological distress
    (spo2 !== null && spo2 >= 90 && spo2 <= 94) ||              // Mild hypoxemia
    (sbp !== null && sbp >= 90 && sbp < 100) ||                 // Borderline low BP
    (rr !== null && ((rr >= 21 && rr <= 29) || rr === 10 || rr === 11)) || // Mild tachypnea
    (hr !== null && ((hr >= 100 && hr <= 119) || (hr >= 50 && hr <= 59)))   // Mild heart distress
  ) {
    return 'yellow';
  }
  
  // 4. Green (Minor / 🟢)
  return 'green';
}

function updateTriageSuggestion() {
  const predicted = predictTriageFromVitals();
  currentSuggestedTriage = predicted;
  
  const label = document.getElementById('suggestedTriageLabel');
  const btn = document.getElementById('applyTriageSuggestionBtn');
  
  if (!label || !btn) return;
  
  if (predicted) {
    let text = '-';
    let colorHex = 'var(--text-muted)';
    
    if (predicted === 'red') { text = '🔴 立即 (紅)'; colorHex = 'var(--triage-red)'; }
    else if (predicted === 'yellow') { text = '🟡 延遲 (黃)'; colorHex = 'var(--triage-yellow)'; }
    else if (predicted === 'green') { text = '🟢 輕傷 (綠)'; colorHex = 'var(--triage-green)'; }
    else if (predicted === 'black') { text = '⚫ 死亡 (黑)'; colorHex = 'var(--triage-black)'; }
    
    label.innerText = text;
    label.style.color = colorHex;
    btn.style.display = 'inline-block';
  } else {
    label.innerText = '-';
    label.style.color = 'var(--text-muted)';
    btn.style.display = 'none';
  }
}

function applySuggestedTriage() {
  if (currentSuggestedTriage) {
    setAssessTriage(currentSuggestedTriage);
    playBeep('success');
  }
}

// Insert time stamp at cursor in the clinical notes textarea
function insertNoteTimestamp() {
  const textarea = document.getElementById('assessNotes');
  if (!textarea) return;
  
  const now = new Date();
  const timeStr = `[${now.toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' })}] `;
  
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  
  textarea.value = text.substring(0, start) + timeStr + text.substring(end);
  
  // Set focus and put cursor after the timestamp
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = start + timeStr.length;
}

// Global Timer for Re-assessment Countdown
let countdownInterval = null;

function startCountdownTimer() {
  if (countdownInterval) clearInterval(countdownInterval);
  
  countdownInterval = setInterval(() => {
    let stateChanged = false;
    if (!systemState.patients) return;
    
    const now = Date.now();
    
    systemState.patients.forEach(p => {
      if (p.treatmentInfo && p.treatmentInfo.assessmentStatus === 'assessed') {
        const level = p.triageLevel;
        
        // Black patients do not count down and their timers should be hidden
        if (level === 'black') {
          const timerEl = document.querySelector(`.countdown-timer[data-patient-id="${p.id}"]`);
          if (timerEl) {
            timerEl.style.display = 'none';
          }
          return;
        }
        
        // Calculate limit: green = 20m, yellow = 15m, red = 10m
        let limitMs = 10 * 60 * 1000;
        if (level === 'green') limitMs = 20 * 60 * 1000;
        else if (level === 'yellow') limitMs = 15 * 60 * 1000;
        
        const completedAt = p.treatmentInfo.assessmentCompletedAt || now;
        const elapsed = now - completedAt;
        const remaining = Math.max(0, limitMs - elapsed);
        
        // Update UI if element is visible
        const timerEl = document.querySelector(`.countdown-timer[data-patient-id="${p.id}"]`);
        if (timerEl) {
          timerEl.style.display = 'flex';
          const timerTextEl = timerEl.querySelector('.timer-countdown-text');
          if (timerTextEl) {
            const totalSec = Math.ceil(remaining / 1000);
            const mins = Math.floor(totalSec / 60);
            const secs = totalSec % 60;
            timerTextEl.innerText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
            
            if (totalSec < 60) {
              timerEl.style.color = 'var(--triage-red)';
              timerEl.style.fontWeight = '800';
            } else {
              timerEl.style.color = 'var(--triage-yellow)';
              timerEl.style.fontWeight = '700';
            }
          }
        }
        
        if (remaining === 0) {
          p.treatmentInfo.assessmentStatus = 'waiting';
          const payload = {
            id: p.id,
            treatmentInfo: p.treatmentInfo
          };
          sendAction('UPDATE_PATIENT', payload);
          stateChanged = true;
        }
      }
    });
    
    if (stateChanged) {
      renderPatientsList();
    }
  }, 1000);
}

document.addEventListener('DOMContentLoaded', () => {
  populateDobDropdowns();
  initConnection();
  lucide.createIcons();
  startCountdownTimer();
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

// Presbyopia Mode toggler
function togglePresbyopiaMode() {
  const isEnabled = document.body.classList.toggle('presbyopia-mode');
  localStorage.setItem('presbyopia_mode', isEnabled ? 'true' : 'false');
  updatePresbyopiaButtonUI();
}

// Update UI button state
function updatePresbyopiaButtonUI() {
  const isEnabled = document.body.classList.contains('presbyopia-mode');
  const btns = [document.getElementById('presbyopiaBtn'), document.getElementById('presbyopiaBtnLogin')];
  btns.forEach(btn => {
    if (!btn) return;
    if (isEnabled) {
      btn.style.background = '#8b5cf6';
      btn.style.color = 'white';
      btn.innerHTML = `<i data-lucide="zoom-out" style="width:14px;height:14px;vertical-align:middle;"></i> 還原字體`;
    } else {
      btn.style.background = 'rgba(139, 92, 246, 0.05)';
      btn.style.color = '#8b5cf6';
      btn.innerHTML = `<i data-lucide="zoom-in" style="width:14px;height:14px;vertical-align:middle;"></i> 大字體`;
    }
  });
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Auto load presbyopia setting on startup
(function() {
  if (localStorage.getItem('presbyopia_mode') === 'true') {
    document.body.classList.add('presbyopia-mode');
    document.addEventListener('DOMContentLoaded', () => {
      updatePresbyopiaButtonUI();
    });
  }
})();
