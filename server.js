const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// Helper to get local network IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // family is 'IPv4' in Node < 18, and could be a string 'IPv4' or number 4 in Node >= 18
      if ((iface.family === 'IPv4' || iface.family === 4) && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

const LOCAL_IP = getLocalIP();

// System State
let systemState = {
  currentCase: {
    name: '',
    status: 'idle', // 'idle' or 'active'
    startTime: null
  },
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
  vehicles: []
};

// Backup File Path
const BACKUP_FILE = path.join(__dirname, 'state_backup.json');

// Save State to Backup File
function saveState() {
  try {
    fs.writeFile(BACKUP_FILE, JSON.stringify(systemState, null, 2), 'utf8', (err) => {
      if (err) {
        console.error('[Backup] Error writing backup file:', err);
      }
    });
  } catch (err) {
    console.error('[Backup] Unexpected error in saveState:', err);
  }
}

// Load State from Backup File
function loadState() {
  try {
    if (fs.existsSync(BACKUP_FILE)) {
      const rawData = fs.readFileSync(BACKUP_FILE, 'utf8');
      if (rawData.trim()) {
        const loadedState = JSON.parse(rawData);
        if (loadedState && loadedState.patients && loadedState.hospitals && loadedState.vehicles) {
          systemState = loadedState;
          console.log(`[Backup] State successfully restored from state_backup.json. Patients: ${systemState.patients.length}`);
          return;
        }
      }
    }
    console.log('[Backup] No valid backup found. Starting with default initial state.');
  } catch (err) {
    console.error('[Backup] Error loading backup file:', err);
  }
}

// Restore state from backup at startup
loadState();

// Log state reset helper
function resetState() {
  systemState.currentCase = { name: '', status: 'idle', startTime: null };
  systemState.patients = [];
  systemState.hospitals.forEach(h => h.receivedCount = 0);
  systemState.vehicles = [];
}

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// REST APIs
app.get('/api/status', (req, res) => {
  res.json({
    ...systemState,
    localIp: LOCAL_IP,
    port: PORT
  });
});

// WebSocket Server Logic
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[WS] Client connected. Total: ${clients.size}`);

  // Send current state on connection
  ws.send(JSON.stringify({
    type: 'init',
    data: {
      ...systemState,
      localIp: LOCAL_IP,
      port: PORT
    }
  }));

  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message);
      console.log(`[WS] Received action: ${parsed.type}`);
      handleAction(parsed, ws);
    } catch (err) {
      console.error('[WS] Error processing message:', err);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WS] Client disconnected. Total: ${clients.size}`);
  });
});

function broadcast(type, data) {
  const payload = JSON.stringify({ type, data });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
  if (type === 'STATE_UPDATE') {
    saveState();
  }
}

function handleAction(action, sender) {
  const { type, data } = action;

  switch (type) {
    case 'START_CASE':
      systemState.currentCase = {
        name: data.name,
        status: 'active',
        startTime: new Date().toISOString()
      };
      systemState.patients = [];
      systemState.hospitals.forEach(h => h.receivedCount = 0);
      systemState.vehicles = [];
      broadcast('STATE_UPDATE', systemState);
      break;

    case 'END_CASE':
      resetState();
      broadcast('STATE_UPDATE', systemState);
      break;

    case 'ADD_PATIENT':
      // Prevent duplicates
      if (systemState.patients.some(p => p.id === data.id)) {
        console.log(`[WS] Patient ${data.id} already exists.`);
        break;
      }
      const newPatient = {
        id: data.id,
        triageLevel: data.triageLevel, // 'red', 'yellow', 'green', 'black'
        gender: data.gender || 'unknown',
        ageGroup: data.ageGroup || 'adult',
        description: data.description || '',
        status: 'waiting', // 'waiting' or 'transported'
        location: data.location || '現場',
        timestamp: new Date().toISOString(),
        transportInfo: null
      };
      systemState.patients.push(newPatient);
      broadcast('STATE_UPDATE', systemState);
      break;

    case 'UPDATE_PATIENT':
      const patientIndex = systemState.patients.findIndex(p => p.id === data.id);
      if (patientIndex !== -1) {
        systemState.patients[patientIndex] = {
          ...systemState.patients[patientIndex],
          ...data
        };
        broadcast('STATE_UPDATE', systemState);
      }
      break;

    case 'TRANSPORT_PATIENT':
      const { patientId, patientIds, vehicleId, hospitalId } = data;
      const targetPatientIds = patientIds || (patientId ? [patientId] : []);
      const vehicle = systemState.vehicles.find(v => v.id === vehicleId);
      const hospital = systemState.hospitals.find(h => h.id === hospitalId);

      if (targetPatientIds.length > 0 && vehicle && hospital) {
        const timeStr = new Date().toLocaleTimeString('zh-TW', { hour12: false });
        
        targetPatientIds.forEach(pId => {
          const patient = systemState.patients.find(p => p.id === pId);
          if (patient) {
            patient.status = 'transported';
            patient.transportInfo = {
              vehicleName: vehicle.name,
              hospitalName: hospital.name,
              time: timeStr
            };
            hospital.receivedCount += 1;
          }
        });

        // Update vehicle
        vehicle.status = 'transporting';
        vehicle.hospitalName = hospital.name;
        vehicle.patientId = targetPatientIds.join(', ');
        vehicle.patientIds = targetPatientIds;
        vehicle.timestamp = new Date().toISOString();

        broadcast('STATE_UPDATE', systemState);
      }
      break;

    case 'VEHICLE_RETURN':
      const vId = data.vehicleId;
      const veh = systemState.vehicles.find(v => v.id === vId);
      if (veh) {
        veh.status = 'standby';
        veh.hospitalName = null;
        veh.patientId = null;
        veh.patientIds = null;
        veh.timestamp = null;
        veh.transportCount = (veh.transportCount || 0) + 1;
        broadcast('STATE_UPDATE', systemState);
      }
      break;

    case 'UPDATE_CONFIGS':
      if (data.hospitals) {
        systemState.hospitals = data.hospitals;
      }
      if (data.vehicles) {
        systemState.vehicles = data.vehicles;
      }
      broadcast('STATE_UPDATE', systemState);
      break;

    default:
      console.warn(`[WS] Unknown action type: ${type}`);
  }
}

server.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`🚑 大傷監測指揮中心伺服器已啟動！`);
  console.log(`💻 電腦端儀表板: http://localhost:${PORT}`);
  console.log(`📱 行動端檢傷官: http://${LOCAL_IP}:${PORT}/officer.html`);
  console.log(`=========================================`);
});
