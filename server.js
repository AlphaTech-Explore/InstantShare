const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { WebSocketServer, WebSocket } = require('ws');
const os = require('os');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DB_FILE = path.join(__dirname, 'rooms.json');

// Ensure uploads folder exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/*
  Data model in rooms.json:
  {
    "rooms": {
      "1111": {
        "pin": "1111",
        "createdAt": "...",
        "media": [ ...items... ]
      }
    }
  }
*/
let db = { rooms: {} };
if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    if (!db.rooms) db.rooms = {};
  } catch (err) {
    console.error('Error reading rooms.json, resetting:', err);
    db = { rooms: {} };
  }
}

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
}

// Multer Storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = /^(image|video)\//i;
  if (allowed.test(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only photos and video files are supported!'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 200 * 1024 * 1024 }
});

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.json());

// Track client pins in WebSockets
// ws.currentPin = "1111"

function broadcastToPin(pin, payload) {
  const str = JSON.stringify(payload);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.currentPin === pin) {
      client.send(str);
    }
  });
}

function countClientsInPin(pin) {
  let count = 0;
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.currentPin === pin) {
      count++;
    }
  });
  return count;
}

function broadcastPinStats(pin) {
  const online = countClientsInPin(pin);
  broadcastToPin(pin, {
    type: 'ROOM_STATS',
    onlineCount: online
  });
}

// REST APIs for Rooms

// 1. Check/Validate PIN status
app.get('/api/room/:pin/check', (req, res) => {
  const pin = req.params.pin.trim();
  const exists = !!db.rooms[pin];
  res.json({ exists, pin });
});

// 2. Create Room with PIN (Ensures unique creation)
app.post('/api/room/create', (req, res) => {
  const { pin } = req.body;
  if (!pin || typeof pin !== 'string') {
    return res.status(400).json({ error: 'PIN is required' });
  }

  const cleanPin = pin.trim();
  if (cleanPin.length < 3) {
    return res.status(400).json({ error: 'PIN must be at least 3 digits' });
  }

  if (db.rooms[cleanPin]) {
    return res.status(409).json({
      error: `PIN "${cleanPin}" is already taken! Multiple users cannot create a room with the same PIN. Please choose another PIN or join this existing room.`
    });
  }

  db.rooms[cleanPin] = {
    pin: cleanPin,
    createdAt: new Date().toISOString(),
    media: []
  };
  saveDB();

  res.json({ success: true, pin: cleanPin });
});

// 3. Join / Get Room Media
app.get('/api/room/:pin/media', (req, res) => {
  const pin = req.params.pin.trim();
  if (!db.rooms[pin]) {
    return res.status(404).json({ error: `Room with PIN "${pin}" does not exist. Please create it first.` });
  }

  res.json({
    pin,
    media: db.rooms[pin].media || []
  });
});

// 4. Upload media to a specific PIN room
app.post('/api/room/:pin/upload', upload.array('files', 20), (req, res) => {
  const pin = req.params.pin.trim();
  if (!db.rooms[pin]) {
    return res.status(404).json({ error: 'Room does not exist' });
  }

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No media files received' });
  }

  const newItems = req.files.map(file => {
    const isVideo = file.mimetype.startsWith('video');
    return {
      id: path.parse(file.filename).name,
      filename: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      type: isVideo ? 'video' : 'photo',
      size: file.size,
      url: `/uploads/${file.filename}`,
      uploadedAt: new Date().toISOString()
    };
  });

  if (!db.rooms[pin].media) db.rooms[pin].media = [];
  db.rooms[pin].media.unshift(...newItems);
  saveDB();

  // Notify everyone in this specific room
  broadcastToPin(pin, {
    type: 'NEW_MEDIA',
    items: newItems
  });

  res.json({ success: true, count: newItems.length, items: newItems });
});

// 5. Delete media from a PIN room
app.delete('/api/room/:pin/media/:id', (req, res) => {
  const pin = req.params.pin.trim();
  const { id } = req.params;

  if (!db.rooms[pin] || !db.rooms[pin].media) {
    return res.status(404).json({ error: 'Room not found' });
  }

  const index = db.rooms[pin].media.findIndex(m => m.id === id);
  if (index !== -1) {
    const [removed] = db.rooms[pin].media.splice(index, 1);
    saveDB();

    const filePath = path.join(UPLOADS_DIR, removed.filename);
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error('Failed to remove file:', err);
      }
    }

    broadcastToPin(pin, {
      type: 'DELETE_MEDIA',
      id
    });

    return res.json({ success: true });
  }

  res.status(404).json({ error: 'Media not found' });
});

// WebSockets for Room connection
wss.on('connection', ws => {
  ws.currentPin = null;

  ws.on('message', message => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'JOIN_PIN') {
        const oldPin = ws.currentPin;
        ws.currentPin = data.pin;
        if (oldPin) broadcastPinStats(oldPin);
        if (data.pin) broadcastPinStats(data.pin);
      }
    } catch (e) {
      console.error('WS msg error:', e);
    }
  });

  ws.on('close', () => {
    if (ws.currentPin) {
      const pin = ws.currentPin;
      ws.currentPin = null;
      broadcastPinStats(pin);
    }
  });
});

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`🚀 InstantShare PIN Room Server is running!`);
  console.log(`💻 Local access: http://localhost:${PORT}`);
  const ips = getLocalIpAddresses();
  if (ips.length > 0) {
    console.log(`📱 Other devices on same Wi-Fi/Network can open:`);
    ips.forEach(ip => console.log(`   👉 http://${ip}:${PORT}`));
  }
  console.log(`======================================================\n`);
});
