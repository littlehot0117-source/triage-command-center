/**
 * Triage Activity Simulator
 * Run this script with `node scripts/simulate_triage.js` to simulate multiple triage officers 
 * submitting patient data to the command center in real-time.
 */

const WebSocket = require('ws');

const wsUrl = 'ws://localhost:3000';
console.log(`Connecting to Triage server at ${wsUrl}...`);

const ws = new WebSocket(wsUrl);

const officerCodes = ['A', 'B', 'C', 'D', 'E'];
const officerCounters = { A: 1, B: 1, C: 1, D: 1, E: 1 };

const triageLevels = ['red', 'red', 'yellow', 'yellow', 'green', 'green', 'green', 'black'];
const genders = ['male', 'female', 'unknown'];
const ageGroups = ['adult', 'child'];
const locations = ['月台區', '大廳南側', '2號出口電扶梯', '轉乘通道', 'B2月台車廂'];
const injuryDescriptions = [
  '吸入性嗆傷，呼吸急促',
  '頭部外傷，意識模糊',
  '右腿開放性骨折，大量出血',
  '輕微擦傷，能自行行走',
  '手腕扭傷，無出血',
  '無呼吸心跳，瞳孔放大',
  '左臂撕裂傷，可配合指令',
  '雙手燙傷，情緒激動',
  '胸部挫傷，呼吸時疼痛',
  '無外傷，極度驚嚇'
];

ws.on('open', () => {
  console.log('Successfully connected to Command Center. Starting simulation...');
  
  // Set up timer to add a patient every 2 seconds
  const interval = setInterval(() => {
    // Pick random officer
    const officer = officerCodes[Math.floor(Math.random() * officerCodes.length)];
    const counter = officerCounters[officer];
    const patientId = officer + String(counter).padStart(3, '0');
    officerCounters[officer]++;

    const triageLevel = triageLevels[Math.floor(Math.random() * triageLevels.length)];
    const gender = genders[Math.floor(Math.random() * genders.length)];
    const ageGroup = ageGroups[Math.floor(Math.random() * ageGroups.length)];
    const location = locations[Math.floor(Math.random() * locations.length)];
    const description = injuryDescriptions[Math.floor(Math.random() * injuryDescriptions.length)];

    const action = {
      type: 'ADD_PATIENT',
      data: {
        id: patientId,
        triageLevel,
        gender,
        ageGroup,
        description,
        location
      }
    };

    console.log(`[Sim] Submitting patient ${patientId} [${triageLevel.toUpperCase()}] at ${location}`);
    ws.send(JSON.stringify(action));

    // Cap at 25 patients to prevent overloading the test screen
    if (Object.values(officerCounters).reduce((a, b) => a + b, 0) > 25) {
      console.log('Simulation limit reached (25 patients). Stopping.');
      clearInterval(interval);
      ws.close();
    }
  }, 2000);
});

ws.on('close', () => {
  console.log('Simulation connection closed.');
});

ws.on('error', (err) => {
  console.error('Simulation error:', err.message);
  console.log('Make sure the triage server is running (`npm start`) before starting the simulator.');
});
