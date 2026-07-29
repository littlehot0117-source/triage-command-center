// State management
let state = {
  currentCase: { name: '', status: 'idle', startTime: null },
  patients: [],
  hospitals: [],
  vehicles: []
};

// Chiayi County Fire Bureau Battalions and Stations
const CHIAYI_BATTALIONS = {
  battalion1: ["朴子", "布袋", "東石", "六腳", "義竹", "鹿草", "祥和"],
  battalion2: ["民雄", "雙福", "大林", "大美", "溪口", "新港", "水上", "太保", "嘉太"],
  battalion3: ["中埔", "三和", "番路", "竹崎", "梅山", "大埔", "奮起湖", "阿里山"]
};

let activeHospitalLookup = null;
let hasWebSocket = false;
let socket = null;

// Initialize WebSockets with Local Fallback
function initConnection() {
  const isLocalFile = window.location.protocol === 'file:';
  const host = window.location.host || 'localhost:3000';
  const wsUrl = window.location.protocol === 'https:' ? `wss://${host}` : `ws://${host}`;

  if (isLocalFile) {
    console.log('[Connection] Running in Local File Mode. Fallback to LocalStorage client-side simulation.');
    initLocalMode();
    return;
  }

  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log('[WS] Connected to server.');
    hasWebSocket = true;
  };

  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'init') {
        state = message.data;
        renderState();
      } else if (message.type === 'STATE_UPDATE') {
        state = message.data;
        renderState();
      }
    } catch (err) {
      console.error('[WS] Error processing message:', err);
    }
  };

  socket.onerror = (err) => {
    console.error('[WS] WebSocket error:', err);
  };

  socket.onclose = () => {
    console.log('[WS] Connection closed. Falling back to Local Mode.');
    hasWebSocket = false;
    initLocalMode();
  };
}

// Local Fallback Simulation (Runs entirely client-side if server is offline or opened via file://)
function initLocalMode() {
  // Load initial template state or restore from localStorage
  const saved = localStorage.getItem('mci_triage_state');
  if (saved) {
    try {
      state = JSON.parse(saved);
      // Migration check: Reset if Taipei hospitals are detected in localStorage cache
      if (state.hospitals && state.hospitals.some(h => h.name === '台大醫院' || h.name === '榮民總醫院')) {
        console.log('[Migration] Taipei hospitals detected in cache. Resetting to Chiayi list.');
        resetLocalState();
      }
    } catch (e) {
      resetLocalState();
    }
  } else {
    resetLocalState();
  }

  renderState();

  // Watch for local storage updates from other tabs
  window.addEventListener('storage', (event) => {
    if (event.key === 'mci_triage_state') {
      try {
        state = JSON.parse(event.newValue);
        renderState();
      } catch (e) {}
    }
  });
}

function resetLocalState() {
  state = {
    currentCase: { name: '', status: 'idle', startTime: null },
    patients: [],
    hospitals: [
      { id: 'h1', name: '嘉義長庚醫院', capacity: 10, receivedCount: 0 },
      { id: 'h2', name: '大林慈濟醫院', capacity: 10, receivedCount: 0 },
      { id: 'h3', name: '嘉義基督教醫院', capacity: 12, receivedCount: 0 },
      { id: 'h4', name: '聖馬爾定醫院', capacity: 8, receivedCount: 0 },
      { id: 'h5', name: '中榮嘉義分院', capacity: 6, receivedCount: 0 },
      { id: 'h6', name: '部立嘉義醫院', capacity: 6, receivedCount: 0 },
      { id: 'h7', name: '陽明醫院', capacity: 5, receivedCount: 0 },
      { id: 'h8', name: '中榮灣橋分院', capacity: 5, receivedCount: 0 }
    ],
    vehicles: [
      { id: 'v1', name: '雙福91', status: 'standby', hospitalName: null, patientId: null, timestamp: null },
      { id: 'v2', name: '祥和91', status: 'standby', hospitalName: null, patientId: null, timestamp: null },
      { id: 'v3', name: '太保91', status: 'standby', hospitalName: null, patientId: null, timestamp: null },
      { id: 'v4', name: '民雄91', status: 'standby', hospitalName: null, patientId: null, timestamp: null },
      { id: 'v5', name: '朴子91', status: 'standby', hospitalName: null, patientId: null, timestamp: null }
    ]
  };
  saveLocalState();
}

function saveLocalState() {
  localStorage.setItem('mci_triage_state', JSON.stringify(state));
}

// Send Action to Server or Execute Locally
function sendAction(type, data) {
  if (hasWebSocket && socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type, data }));
  } else {
    handleLocalAction(type, data);
  }
}

// Local State Mutators
function handleLocalAction(type, data) {
  switch (type) {
    case 'START_CASE':
      state.currentCase = {
        name: data.name,
        status: 'active',
        startTime: new Date().toISOString()
      };
      state.patients = [];
      state.hospitals.forEach(h => h.receivedCount = 0);
      state.vehicles.forEach(v => {
        v.status = 'standby';
        v.hospitalName = null;
        v.patientId = null;
        v.timestamp = null;
        v.transportCount = 0;
      });
      break;

    case 'END_CASE':
      resetLocalState();
      break;

    case 'ADD_PATIENT':
      if (state.patients.some(p => p.id === data.id)) break;
      state.patients.push({
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
      break;

    case 'TRANSPORT_PATIENT':
      const patient = state.patients.find(p => p.id === data.patientId);
      const vehicle = state.vehicles.find(v => v.id === data.vehicleId);
      const hospital = state.hospitals.find(h => h.id === data.hospitalId);

      if (patient && vehicle && hospital) {
        const timeStr = new Date().toLocaleTimeString('zh-TW', { hour12: false });
        patient.status = 'transported';
        patient.transportInfo = {
          vehicleName: vehicle.name,
          hospitalName: hospital.name,
          time: timeStr
        };

        vehicle.status = 'transporting';
        vehicle.hospitalName = hospital.name;
        vehicle.patientId = data.patientId;
        vehicle.timestamp = new Date().toISOString();

        hospital.receivedCount += 1;
      }
      break;

    case 'UPDATE_PATIENT':
      const pIdx = state.patients.findIndex(p => p.id === data.id);
      if (pIdx !== -1) {
        state.patients[pIdx] = {
          ...state.patients[pIdx],
          ...data
        };
      }
      break;

    case 'VEHICLE_RETURN':
      const v = state.vehicles.find(veh => veh.id === data.vehicleId);
      if (v) {
        v.status = 'standby';
        v.hospitalName = null;
        v.patientId = null;
        v.timestamp = null;
        v.transportCount = (v.transportCount || 0) + 1;
      }
      break;

    case 'UPDATE_CONFIGS':
      if (data.hospitals) state.hospitals = data.hospitals;
      if (data.vehicles) state.vehicles = data.vehicles;
      break;
  }
  saveLocalState();
  renderState();
}

// UI RENDERING

function renderState() {
  const { currentCase, patients, hospitals, vehicles } = state;

  // 1. Overlay setup view
  const setupOverlay = document.getElementById('setupOverlay');
  if (currentCase.status === 'active') {
    setupOverlay.style.display = 'none';
    document.getElementById('headerCaseName').innerText = currentCase.name;
  } else {
    setupOverlay.style.display = 'flex';
    document.getElementById('headerCaseName').innerText = '大傷監測指揮儀表板';
  }

  // 2. Count Triage stats
  let red = 0, yellow = 0, green = 0, black = 0;
  patients.forEach(p => {
    if (p.triageLevel === 'red') red++;
    else if (p.triageLevel === 'yellow') yellow++;
    else if (p.triageLevel === 'green') green++;
    else if (p.triageLevel === 'black') black++;
  });

  const waitingPatients = patients.filter(p => p.status === 'waiting');
  const transportedPatients = patients.filter(p => p.status === 'transported');

  document.getElementById('statRed').innerText = red;
  document.getElementById('statYellow').innerText = yellow;
  document.getElementById('statGreen').innerText = green;
  document.getElementById('statBlack').innerText = black;
  document.getElementById('statTotal').innerText = `${transportedPatients.length} / ${patients.length}`;

  document.getElementById('waitingCount').innerText = waitingPatients.length;
  document.getElementById('transportedCount').innerText = transportedPatients.length;



  // 4. Render Patient Table (Waiting)
  const waitingTbody = document.getElementById('waitingPatientTableBody');
  if (waitingPatients.length === 0) {
    waitingTbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 30px 0;">尚無任何傷患紀錄，等待現場回報中...</td></tr>`;
  } else {
    waitingTbody.innerHTML = waitingPatients.map(p => {
      const timeStr = new Date(p.timestamp).toLocaleTimeString('zh-TW', { hour12: false });
      const ageGroupZh = p.ageGroup === 'child' ? '孩童' : '成人';
      const genderZh = p.gender === 'male' ? '男' : p.gender === 'female' ? '女' : '未知';
      return `
        <tr class="patient-row-${p.triageLevel}">
          <td><strong>${p.id}</strong></td>
          <td><span class="triage-badge ${p.triageLevel}">${getTriageZh(p.triageLevel)}</span></td>
          <td>${genderZh} | ${ageGroupZh} | ${p.description || '<span style="color:var(--text-muted)">無備註</span>'}</td>
          <td>${formatLocation(p.location)}</td>
          <td>${getTreatmentRecordCell(p)}</td>
          <td>${timeStr}</td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="openTransportModal('${p.id}')">
              <i data-lucide="navigation" style="width:14px;height:14px;"></i> 送醫
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // 5. Render Patient Table (Transported)
  const transportedTbody = document.getElementById('transportedPatientTableBody');
  if (transportedPatients.length === 0) {
    transportedTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px 0;">目前尚無已送醫患者紀錄</td></tr>`;
  } else {
    transportedTbody.innerHTML = transportedPatients.map(p => {
      return `
        <tr class="patient-row-${p.triageLevel}">
          <td><strong>${p.id}</strong></td>
          <td><span class="triage-badge ${p.triageLevel}">${getTriageZh(p.triageLevel)}</span></td>
          <td><i data-lucide="ambulance" style="width:14px;height:14px;vertical-align:middle;margin-right:4px;"></i>${p.transportInfo.vehicleName}</td>
          <td><i data-lucide="building" style="width:14px;height:14px;vertical-align:middle;margin-right:4px;"></i>${p.transportInfo.hospitalName}</td>
          <td>${p.transportInfo.time}</td>
        </tr>
      `;
    }).join('');
  }

  // 6. Render Vehicles Row
  const vehicleList = document.getElementById('vehicleList');
  vehicleList.innerHTML = vehicles.map(v => {
    let statusClass = 'standby';
    let statusZh = '現場<br>待命';
    let actionBtnHtml = '';
    let removeBtnHtml = '';

    if (v.status === 'transporting') {
      statusClass = 'transporting';
      statusZh = `🚨 載送中 → ${v.hospitalName} (${v.patientId})`;
      actionBtnHtml = `
        <button class="btn btn-secondary" style="padding:4px 8px; font-size:11.5px;" onclick="returnVehicle('${v.id}')">
          已返回現場
        </button>
      `;
    } else {
      removeBtnHtml = `
        <button class="btn btn-secondary" style="padding:2px 6px; font-size:10px; color:var(--triage-red); border:1px solid rgba(244,63,94,0.15); margin-top:6px; line-height:1; min-height:18px; width:100%; white-space:nowrap; text-align:center;" onclick="removeVehicleById('${v.id}')">
          移除
        </button>
      `;
    }

    return `
      <div class="item-row">
        <div style="display:flex; align-items:center; gap:10px; width:100%;">
          <div style="display:flex; flex-direction:column; align-items:center; min-width:44px; gap:2px;">
            <i data-lucide="ambulance" style="color: ${v.status === 'transporting' ? 'var(--triage-red)' : 'var(--triage-green)'};"></i>
            <span style="font-size:10px; font-weight:600; color:var(--text-muted); padding:1px 4px; background:rgba(255,255,255,0.03); border-radius:3px; border:1px solid rgba(255,255,255,0.05); white-space:nowrap; margin-top:2px;">
              ${v.transportCount || 0} 次
            </span>
            ${removeBtnHtml}
          </div>
          <div style="flex:1;">
            <div style="font-weight:600;">${v.name}</div>
            <div style="font-size:12px; color:var(--text-muted);" class="vehicle-status ${statusClass}">${statusZh}</div>
          </div>
        </div>
        <div style="white-space:nowrap;">
          ${actionBtnHtml}
        </div>
      </div>
    `;
  }).join('');

  // 7. Render Hospital Capacities (4 columns grid layout with inline upper-limit management)
  const hospitalList = document.getElementById('hospitalList');
  hospitalList.innerHTML = hospitals.map((h, i) => {
    const percent = Math.min(100, Math.round((h.receivedCount / h.capacity) * 100));
    let color = 'var(--triage-green)';
    if (percent >= 90) color = 'var(--triage-red)';
    else if (percent >= 60) color = 'var(--triage-yellow)';

    return `
      <div class="item-row hospital-card" style="flex-direction:column; align-items:stretch; gap:6px; cursor:pointer;" onclick="openHospitalPatientsModal('${h.name}')">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="font-weight:600; display:flex; align-items:center; gap:4px; font-size:14px;">
            <i data-lucide="building" style="color:var(--primary); width:16px;height:16px;"></i>
            <span>${h.name}</span>
            <button onclick="event.stopPropagation(); renameHospital(${i}, '${h.name}')" style="background:none; border:none; padding:2px; cursor:pointer; color:var(--text-muted); display:inline-flex; align-items:center; opacity:0.6; transition:opacity 0.2s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6" title="修改醫院名稱">
              <i data-lucide="edit-2" style="width:12px; height:12px;"></i>
            </button>
            <button onclick="event.stopPropagation(); deleteHospital(${i}, '${h.name}')" style="background:none; border:none; padding:2px; cursor:pointer; color:var(--triage-red); display:inline-flex; align-items:center; opacity:0.6; transition:opacity 0.2s;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6" title="刪除收容醫院">
              <i data-lucide="trash-2" style="width:12px; height:12px;"></i>
            </button>
          </div>
          <div style="display:flex; align-items:center; gap:4px;" onclick="event.stopPropagation();">
            <span style="font-size:11px; color:var(--text-muted);">限額:</span>
            <input type="number" class="input-control" style="width:58px; height:24px; padding:2px 4px; font-size:12.5px; text-align:center; border-radius:4px; border:1px solid var(--border-color);" value="${h.capacity}" onchange="changeHospitalCapacity(${i}, this.value)" min="0" max="999">
          </div>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; font-weight:600; color:var(--text-muted); padding-left:2px;">
          <span>已收容 ${h.receivedCount} 人</span>
          <span>${percent}%</span>
        </div>
        <div class="hospital-capacity-bar" style="margin-top:2px;">
          <div class="hospital-capacity-fill" style="width: ${percent}%; background: ${color};"></div>
        </div>
      </div>
    `;
  }).join('');

  // Update the dispatch modal UI in real-time if it's currently open
  const modal = document.getElementById('dispatchModal');
  if (modal && modal.classList.contains('show')) {
    renderBattalionGrids();
  }

  // Update the hospital patients lookup modal in real-time if it's currently open
  if (activeHospitalLookup) {
    updateHospitalPatientsModalData(activeHospitalLookup);
  }

  // Create/update lucide icons
  lucide.createIcons();
}

function getTriageZh(level) {
  switch(level) {
    case 'red': return '🔴 立即治療';
    case 'yellow': return '🟡 延遲治療';
    case 'green': return '🟢 輕傷';
    case 'black': return '⚫ 死亡/期待';
    default: return '未知';
  }
}

// Render Configuration Administration Pane


// Vehicle dispatch modal controls
function openDispatchModal() {
  document.getElementById('dispatchModal').classList.add('show');
  document.getElementById('customAmbulanceInput').value = '';
  renderBattalionGrids();
}

function closeDispatchModal() {
  document.getElementById('dispatchModal').classList.remove('show');
}

function renderBattalionGrids() {
  // Render Battalion 1
  const b1Grid = document.getElementById('battalion1Grid');
  if (b1Grid) {
    b1Grid.innerHTML = CHIAYI_BATTALIONS.battalion1.map(name => {
      const isDispatched = state.vehicles.some(v => v.name === name + "91");
      const activeClass = isDispatched ? 'station-btn-dispatched' : '';
      const statusText = isDispatched ? ' (已派)' : '';
      return `
        <button class="station-btn ${activeClass}" onclick="toggleAmbulance('${name}')" style="font-size:12px; padding:6px; text-align:center; white-space:nowrap;">
          ${name}${statusText}
        </button>
      `;
    }).join('');
  }
  
  // Render Battalion 2
  const b2Grid = document.getElementById('battalion2Grid');
  if (b2Grid) {
    b2Grid.innerHTML = CHIAYI_BATTALIONS.battalion2.map(name => {
      const isDispatched = state.vehicles.some(v => v.name === name + "91");
      const activeClass = isDispatched ? 'station-btn-dispatched' : '';
      const statusText = isDispatched ? ' (已派)' : '';
      return `
        <button class="station-btn ${activeClass}" onclick="toggleAmbulance('${name}')" style="font-size:12px; padding:6px; text-align:center; white-space:nowrap;">
          ${name}${statusText}
        </button>
      `;
    }).join('');
  }
  
  // Render Battalion 3
  const b3Grid = document.getElementById('battalion3Grid');
  if (b3Grid) {
    b3Grid.innerHTML = CHIAYI_BATTALIONS.battalion3.map(name => {
      const isDispatched = state.vehicles.some(v => v.name === name + "91");
      const activeClass = isDispatched ? 'station-btn-dispatched' : '';
      const statusText = isDispatched ? ' (已派)' : '';
      return `
        <button class="station-btn ${activeClass}" onclick="toggleAmbulance('${name}')" style="font-size:12px; padding:6px; text-align:center; white-space:nowrap;">
          ${name}${statusText}
        </button>
      `;
    }).join('');
  }
}

function toggleAmbulance(stationName) {
  const vehicleName = stationName + "91";
  const existingIndex = state.vehicles.findIndex(v => v.name === vehicleName);
  
  if (existingIndex >= 0) {
    const v = state.vehicles[existingIndex];
    if (v.status === 'transporting') {
      alert(`${vehicleName} 正在載送傷患中，無法撤回！`);
      return;
    }
    // Recall vehicle (remove)
    state.vehicles.splice(existingIndex, 1);
  } else {
    // Dispatch vehicle (add)
    state.vehicles.push({
      id: 'v_' + Date.now(),
      name: vehicleName,
      status: 'standby',
      hospitalName: null,
      patientId: null,
      timestamp: null
    });
  }
  
  sendAction('UPDATE_CONFIGS', { vehicles: state.vehicles });
  renderBattalionGrids();
}

function addCustomAmbulance() {
  const input = document.getElementById('customAmbulanceInput');
  const name = input.value.trim();
  if (!name) {
    alert('請輸入支援救護車名稱！');
    return;
  }
  
  if (state.vehicles.some(v => v.name === name)) {
    alert(`${name} 已經在現場車隊名單中！`);
    return;
  }
  
  state.vehicles.push({
    id: 'v_' + Date.now(),
    name: name,
    status: 'standby',
    hospitalName: null,
    patientId: null,
    timestamp: null
  });
  
  sendAction('UPDATE_CONFIGS', { vehicles: state.vehicles });
  
  input.value = '';
  renderBattalionGrids();
  
  alert(`已成功派遣支援救護車 ${name}！`);
}

function removeVehicleById(id) {
  const v = state.vehicles.find(veh => veh.id === id);
  if (!v) return;
  if (v.status === 'transporting') {
    alert('此車輛正載送傷患中，無法移除！');
    return;
  }
  state.vehicles = state.vehicles.filter(veh => veh.id !== id);
  sendAction('UPDATE_CONFIGS', { vehicles: state.vehicles });
  
  // Update the dispatch modal UI in case it's currently open
  const modal = document.getElementById('dispatchModal');
  if (modal && modal.classList.contains('show')) {
    renderBattalionGrids();
  }
}

// Hospital patients lookup modal controllers
function openHospitalPatientsModal(hospitalName) {
  activeHospitalLookup = hospitalName;
  updateHospitalPatientsModalData(hospitalName);
  document.getElementById('hospitalPatientsModal').classList.add('show');
}

function updateHospitalPatientsModalData(hospitalName) {
  const title = document.getElementById('hospitalModalTitle');
  if (title) title.innerText = `🏢 送往 ${hospitalName} 的傷患名單`;
  
  // Filter patients that are sent to this hospital
  const hospitalPatients = state.patients.filter(p => p.status === 'transported' && p.transportInfo && p.transportInfo.hospitalName === hospitalName);
  
  const tbody = document.getElementById('hospitalPatientsTableBody');
  if (!tbody) return;
  
  if (hospitalPatients.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center; color:var(--text-muted); padding:30px 0;">
          目前尚無送往該院的傷患紀錄。
        </td>
      </tr>
    `;
  } else {
    tbody.innerHTML = hospitalPatients.map(p => {
      // Basic info formatting (incorporating treatment info if available)
      let basicInfoHtml = '';
      if (p.treatmentInfo) {
        const genderLabel = p.treatmentInfo.gender === 'male' ? '男' : p.treatmentInfo.gender === 'female' ? '女' : p.treatmentInfo.gender === 'other' ? '其他' : '未知';
        const namePart = p.treatmentInfo.name ? `<strong>${p.treatmentInfo.name}</strong><br>` : '';
        const agePart = p.treatmentInfo.age ? `${p.treatmentInfo.age} 歲` : (p.treatmentInfo.ageGroup === 'child' ? '孩童' : '成人');
        basicInfoHtml = `${namePart}${genderLabel} | ${agePart}`;
      } else {
        const genderLabel = p.gender === 'male' ? '男' : p.gender === 'female' ? '女' : '未知';
        const ageGroupLabel = p.ageGroup === 'child' ? '孩童' : '成人';
        basicInfoHtml = `${genderLabel} | ${ageGroupLabel}`;
      }

      // Treatment Area Info formatting
      let treatmentInfoHtml = '';
      if (p.treatmentInfo) {
        const vitals = p.treatmentInfo.vitals || {};
        const hasVitals = vitals.gcs || vitals.bpSystolic || vitals.hr || vitals.spo2;
        const vitalsText = hasVitals ? `<span style="font-size:11.5px; display:inline-block; margin-bottom:2px;">🩺 GCS ${vitals.gcs || '-'}; BP ${vitals.bpSystolic || '-'}/${vitals.bpDiastolic || '-'}; HR ${vitals.hr || '-'} bpm; SpO2 ${vitals.spo2 || '-'}%</span>` : '';
        
        const meds = p.treatmentInfo.medications || [];
        const medsText = meds.length > 0 ? `<span style="font-size:11.5px; display:inline-block; margin-bottom:2px; color:#10b981; font-weight:600;">💊 給藥: ${meds.map(m => m.name).join(', ')}</span>` : '';
        
        const notesText = p.treatmentInfo.notes ? `<span style="font-size:11.5px; display:inline-block; white-space:pre-wrap;">📝 備註: ${p.treatmentInfo.notes}</span>` : '';
        
        treatmentInfoHtml = [vitalsText, medsText, notesText].filter(t => t).join('<br>');
      }
      if (!treatmentInfoHtml) {
        treatmentInfoHtml = '<span style="color:var(--text-muted); font-size:12px;">無治療評估紀錄</span>';
      }

      return `
        <tr class="patient-row-${p.triageLevel}">
          <td><strong>${p.id}</strong></td>
          <td><span class="triage-badge ${p.triageLevel}">${getTriageZh(p.triageLevel)}</span></td>
          <td>${basicInfoHtml}</td>
          <td>${formatLocation(p.location)}</td>
          <td>${p.transportInfo.time}</td>
          <td>${p.description || '<span style="color:var(--text-muted)">無備註</span>'}</td>
          <td style="font-size: 12px; line-height: 1.4; max-width: 250px;">${treatmentInfoHtml}</td>
        </tr>
      `;
    }).join('');
  }
}

function closeHospitalPatientsModal() {
  activeHospitalLookup = null;
  document.getElementById('hospitalPatientsModal').classList.remove('show');
}




// Config Event Handlers
function changeHospitalCapacity(idx, val) {
  const newCap = parseInt(val);
  if (isNaN(newCap) || newCap < 0) return;
  state.hospitals[idx].capacity = newCap;
  sendAction('UPDATE_CONFIGS', { hospitals: state.hospitals });
}

function renameHospital(idx, oldName) {
  const newName = prompt('請輸入新的醫院名稱：', oldName);
  if (newName === null) return; // 取消
  const trimmed = newName.trim();
  if (!trimmed) {
    alert('醫院名稱不能為空！');
    return;
  }
  // 檢查是否重複
  if (state.hospitals.some((h, i) => i !== idx && h.name === trimmed)) {
    alert('醫院名稱已存在！');
    return;
  }
  
  // 更新狀態
  state.hospitals[idx].name = trimmed;
  
  // 同步更新已送往該醫院的傷患送醫資訊，避免斷聯
  state.patients.forEach(p => {
    if (p.transportInfo && p.transportInfo.hospitalName === oldName) {
      p.transportInfo.hospitalName = trimmed;
      sendAction('UPDATE_PATIENT', p); // 即時同步資料庫
    }
  });
  
  sendAction('UPDATE_CONFIGS', { hospitals: state.hospitals });
}

function addHospital() {
  const name = prompt('請輸入新增醫院的名稱：');
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) {
    alert('醫院名稱不能為空！');
    return;
  }
  if (state.hospitals.some(h => h.name === trimmed)) {
    alert('該醫院已存在！');
    return;
  }
  
  const capStr = prompt('請輸入該醫院的收容額度上限：', '10');
  if (capStr === null) return;
  const capacity = parseInt(capStr);
  if (isNaN(capacity) || capacity < 0) {
    alert('請輸入有效的數字額度！');
    return;
  }
  
  const randomId = 'h-' + Math.floor(100 + Math.random() * 900);
  
  state.hospitals.push({
    id: randomId,
    name: trimmed,
    capacity: capacity,
    receivedCount: 0
  });
  
  sendAction('UPDATE_CONFIGS', { hospitals: state.hospitals });
}

function deleteHospital(idx, name) {
  const h = state.hospitals[idx];
  if (!h) return;
  
  let confirmMsg = `確定要刪除「${name}」急救責任醫院嗎？`;
  if (h.receivedCount > 0) {
    confirmMsg = `⚠️ 警告：該醫院目前已收容 ${h.receivedCount} 名傷患，刪除後這些傷患的送醫目的地將變更為「未指定」。\n\n確定要刪除嗎？`;
  }
  
  if (!confirm(confirmMsg)) return;
  
  // 更新送往該急救責任醫院的患者資訊
  state.patients.forEach(p => {
    if (p.transportInfo && p.transportInfo.hospitalName === name) {
      p.transportInfo.hospitalName = '未指定 (原醫院已刪除)';
      sendAction('UPDATE_PATIENT', p); // 即時同步
    }
  });
  
  // 從陣列中移除
  state.hospitals.splice(idx, 1);
  
  sendAction('UPDATE_CONFIGS', { hospitals: state.hospitals });
}

function addVehicle() {
  const input = document.getElementById('newVehicleInput');
  const val = input.value.trim();
  if (!val) return;
  
  if (state.vehicles.some(v => v.name === val)) {
    alert('車輛已存在！');
    return;
  }
  
  state.vehicles.push({
    id: 'v_' + Date.now(),
    name: val,
    status: 'standby',
    hospitalName: null,
    patientId: null,
    timestamp: null
  });
  
  input.value = '';
  sendAction('UPDATE_CONFIGS', { vehicles: state.vehicles });
}

function removeVehicle(idx) {
  const v = state.vehicles[idx];
  if (v.status === 'transporting') {
    alert('此車輛正載送傷患中，無法移除！');
    return;
  }
  state.vehicles.splice(idx, 1);
  sendAction('UPDATE_CONFIGS', { vehicles: state.vehicles });
}

// Vehicle Return Handler
function returnVehicle(vId) {
  sendAction('VEHICLE_RETURN', { vehicleId: vId });
}

// Transport Dialog Handlers
function openTransportModal(patientId) {
  const p = state.patients.find(pat => pat.id === patientId);
  if (!p) return;

  document.getElementById('modalPatientId').value = patientId;
  document.getElementById('modalPatientDisplay').innerHTML = `
    <span class="triage-badge ${p.triageLevel}">${getTriageZh(p.triageLevel)}</span> 
    <span style="margin-left:8px;">${p.id}</span>
  `;

  // Render standby vehicles
  const vehicleSelect = document.getElementById('modalVehicleSelect');
  const standbyVehicles = state.vehicles.filter(v => v.status === 'standby');
  if (standbyVehicles.length === 0) {
    vehicleSelect.innerHTML = `<option value="">⚠️ 目前現場無待命車輛</option>`;
  } else {
    vehicleSelect.innerHTML = standbyVehicles.map(v => `<option value="${v.id}">${v.name}</option>`).join('');
  }

  // Render hospitals with available capacity (or show all with full ones highlighted)
  const hospitalSelect = document.getElementById('modalHospitalSelect');
  hospitalSelect.innerHTML = state.hospitals.map(h => {
    const isFull = h.receivedCount >= h.capacity;
    const desc = isFull ? ' (滿額!)' : ` (餘 ${h.capacity - h.receivedCount})`;
    return `<option value="${h.id}" ${isFull ? 'disabled style="color:var(--text-muted)"' : ''}>${h.name}${desc}</option>`;
  }).join('');

  document.getElementById('transportModal').classList.add('show');
}

function closeTransportModal() {
  document.getElementById('transportModal').classList.remove('show');
}

// DOM Event Listeners Setup
document.addEventListener('DOMContentLoaded', () => {
  initConnection();

  //立案按鈕
  document.getElementById('startCaseBtn').addEventListener('click', () => {
    const input = document.getElementById('caseNameInput');
    const name = input.value.trim();
    if (!name) {
      alert('請輸入案件/災害名稱！');
      return;
    }
    sendAction('START_CASE', { name });
  });

  //結案按鈕
  document.getElementById('endCaseBtn').addEventListener('click', () => {
    if (confirm('確定要進行結案嗎？這將清除目前所有檢傷與車輛送醫紀錄。')) {
      sendAction('END_CASE');
    }
  });

  //手動登記傷患按鈕 (若功能已被刪除則跳過監聽)
  const manualAddBtn = document.getElementById('manualAddBtn');
  if (manualAddBtn) {
    manualAddBtn.addEventListener('click', () => {
      const level = document.getElementById('manualTriageLevel').value;
      const desc = document.getElementById('manualDescription').value.trim();
      const gender = 'unknown';
      const ageGroup = 'adult';
      const location = document.getElementById('manualLocation').value.trim() || '現場';

      // Generate patient ID
      const randomId = 'M-' + Math.floor(100 + Math.random() * 900);

      sendAction('ADD_PATIENT', {
        id: randomId,
        triageLevel: level,
        gender,
        ageGroup,
        description: desc,
        location
      });

      // Clear inputs
      document.getElementById('manualDescription').value = '';
    });
  }

  // Modal Cancel
  document.getElementById('modalCancelBtn').addEventListener('click', closeTransportModal);

  // Modal Confirm
  document.getElementById('modalConfirmBtn').addEventListener('click', () => {
    const patientId = document.getElementById('modalPatientId').value;
    const vehicleId = document.getElementById('modalVehicleSelect').value;
    const hospitalId = document.getElementById('modalHospitalSelect').value;

    if (!vehicleId) {
      alert('請選擇載送車輛！若無車輛，請在參數設置中新增。');
      return;
    }
    if (!hospitalId) {
      alert('請選擇目的地收容醫院！');
      return;
    }

    sendAction('TRANSPORT_PATIENT', { patientId, vehicleId, hospitalId });
    closeTransportModal();
  });
});

// Location GPS coordinates parser & Google Maps URL formatter
function formatLocation(loc) {
  if (!loc) return '<span style="color:var(--text-muted)">未知</span>';
  
  // Detects coordinates e.g. "23.4795, 120.4502"
  const geoRegex = /(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/;
  const match = loc.match(geoRegex);
  
  if (match) {
    const lat = match[1];
    const lng = match[2];
    return `
      <a href="https://www.google.com/maps/search/?api=1&query=${lat},${lng}" target="_blank" class="location-map-link" style="color:var(--primary); text-decoration:underline; font-weight:600; display:inline-flex; align-items:center; gap:4px;">
        <i data-lucide="map-pin" style="width:14px;height:14px;color:var(--primary);"></i>${loc}
      </a>
    `;
  }
  
  return `<span style="display:inline-flex; align-items:center; gap:4px;"><i data-lucide="map-pin" style="width:14px;height:14px;color:var(--text-muted);"></i>${loc}</span>`;
}

// Treatment records dashboard controllers
function getTreatmentRecordCell(p) {
  if (p.treatmentInfo) {
    return `
      <button class="btn btn-secondary btn-sm" style="padding:4px 8px; font-size:11.5px; border-color:#10b981; color:#10b981; background:rgba(16,185,129,0.05);" onclick="openTreatmentRecordModal('${p.id}')">
        <i data-lucide="file-text" style="width:13px;height:13px;vertical-align:middle;margin-right:2px;"></i> 病歷已填
      </button>
    `;
  }
  return `<span style="color:var(--text-muted); font-size:11.5px; display:inline-flex; align-items:center; gap:2px;"><i data-lucide="help-circle" style="width:12px;height:12px;"></i> 未評估</span>`;
}

function openTreatmentRecordModal(patientId) {
  const p = state.patients.find(x => x.id === patientId);
  if (!p || !p.treatmentInfo) {
    alert('找不到該傷患的治療區病歷記錄！');
    return;
  }
  
  const t = p.treatmentInfo;
  
  // Fill general details
  document.getElementById('recName').innerText = t.name || '未填寫';
  document.getElementById('recNationalId').innerText = t.nationalId || '未填寫';
  document.getElementById('recPhone').innerText = t.phone || '未填寫';
  
  const genderZh = t.gender === 'male' ? '生理男' : t.gender === 'female' ? '生理女' : '不詳';
  const dobText = t.dob ? t.dob : '未填生日';
  const ageText = t.age ? `${t.age} 歲` : '未填年齡';
  document.getElementById('recGenderAge').innerText = `${genderZh} / ${ageText} (${dobText})`;
  
  // Location
  const locDiv = document.getElementById('recLocation');
  locDiv.innerHTML = formatLocation(p.location);
  
  // Original Triage
  document.getElementById('recOriginalTriage').innerHTML = `<span class="triage-badge ${p.triageLevel}">${getTriageZh(p.triageLevel)}</span>`;
  
  // Vitals
  const vitals = t.vitals || {};
  document.getElementById('recVitalsGcs').innerText = vitals.gcs || '-';
  document.getElementById('recVitalsSpo2').innerText = vitals.spo2 ? `${vitals.spo2}%` : '-';
  document.getElementById('recVitalsBp').innerText = (vitals.bpSystolic && vitals.bpDiastolic) ? `${vitals.bpSystolic}/${vitals.bpDiastolic}` : '-';
  document.getElementById('recVitalsHr').innerText = vitals.hr ? `${vitals.hr} bpm` : '-';
  document.getElementById('recVitalsRr').innerText = vitals.rr ? `${vitals.rr} 次/分` : '-';
  document.getElementById('recVitalsTemp').innerText = vitals.temp ? `${vitals.temp} °C` : '-';
  
  // Vital warnings
  setVitalWarningStyle('vitalSpo2Box', vitals.spo2 && parseInt(vitals.spo2) < 94);
  setVitalWarningStyle('vitalBpBox', vitals.bpSystolic && (parseInt(vitals.bpSystolic) < 90 || parseInt(vitals.bpSystolic) > 150));
  setVitalWarningStyle('vitalHrBox', vitals.hr && (parseInt(vitals.hr) < 50 || parseInt(vitals.hr) > 120));
  setVitalWarningStyle('vitalRrBox', vitals.rr && (parseInt(vitals.rr) < 10 || parseInt(vitals.rr) > 29));
  setVitalWarningStyle('vitalTempBox', vitals.temp && (parseFloat(vitals.temp) < 35.0 || parseFloat(vitals.temp) > 38.5));
  
  // Injured Parts with injury annotations
  const partsContainer = document.getElementById('recInjuredPartsContainer');
  if (t.injuredParts && t.injuredParts.length > 0) {
    const notesMap = t.injuredPartsNotes || {};
    partsContainer.innerHTML = t.injuredParts.map(part => {
      const noteStr = notesMap[part] ? `：${notesMap[part]}` : '';
      const isNone = part === '無明顯外傷';
      const colorBg = isNone ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)';
      const colorBorder = isNone ? '#10b981' : '#ef4444';
      
      return `
        <span style="background: ${colorBg}; border: 1px solid ${colorBorder}; color: ${colorBorder}; padding: 4px 10px; border-radius: 4px; font-size:12px; font-weight:600; margin-bottom: 4px; display: inline-flex; align-items: center; gap: 4px;">
          ${part}${noteStr}
        </span>
      `;
    }).join(' ');
  } else {
    partsContainer.innerHTML = `<span style="color:var(--text-muted); font-size:13px;">無外傷資料</span>`;
  }
  
  // Medications Log
  const recMedBody = document.getElementById('recMedicationsListBody');
  if (recMedBody) {
    if (t.medications && t.medications.length > 0) {
      recMedBody.innerHTML = t.medications.map(m => `
        <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
          <td style="padding:6px 4px;">${m.time}</td>
          <td style="padding:6px 4px; font-weight:700; color:#10b981;">${m.name}</td>
          <td style="padding:6px 4px;">${m.route}</td>
          <td style="padding:6px 4px; font-weight:700;">${m.dose}</td>
          <td style="padding:6px 4px; color:var(--text-muted);">${m.remark || '-'}</td>
        </tr>
      `).join('');
    } else {
      recMedBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:12px 0;">目前無用藥紀錄</td></tr>`;
    }
  }
  
  // Secondary Triage
  const secTriage = t.updatedTriageLevel || p.triageLevel;
  const secBadge = document.getElementById('recSecondaryTriageBadge');
  secBadge.className = `triage-badge ${secTriage}`;
  secBadge.innerText = getTriageZh(secTriage);
  
  // Last updated
  const dateStr = t.lastUpdated ? new Date(t.lastUpdated).toLocaleString('zh-TW', { hour12: false }) : '-';
  document.getElementById('recLastUpdated').innerText = dateStr;
  
  // Notes
  document.getElementById('recNotes').innerText = t.notes || '無任何處置備註紀錄';
  
  document.getElementById('treatmentRecordModal').classList.add('show');
  lucide.createIcons();
}

function setVitalWarningStyle(elementId, isAbnormal) {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (isAbnormal) {
    el.style.background = 'rgba(244, 63, 94, 0.12)';
    el.style.borderColor = 'rgba(244, 63, 94, 0.3)';
    el.style.color = 'var(--triage-red)';
  } else {
    el.style.background = 'rgba(255, 255, 255, 0.02)';
    el.style.borderColor = 'rgba(255, 255, 255, 0.04)';
    el.style.color = 'var(--text-main)';
  }
}

function closeTreatmentRecordModal() {
  document.getElementById('treatmentRecordModal').classList.remove('show');
}

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
