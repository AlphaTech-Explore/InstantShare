require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { WebSocketServer, WebSocket } = require('ws');
const os = require('os');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;

const app = express();
const server = http.createServer(app);

// WebSockets (local/VPS, bypassed gracefully on Vercel Serverless)
let wss = null;
try {
  wss = new WebSocketServer({ server });
} catch (e) {}

const PORT = process.env.PORT || 3000;
const IS_VERCEL = !!process.env.VERCEL;

// Cloudinary Configuration
if (process.env.CLOUDINARY_URL || process.env.CLOUDINARY_CLOUD_NAME) {
  if (process.env.CLOUDINARY_CLOUD_NAME) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET
    });
  }
  console.log('☁️ Cloudinary integration active for permanent photo/video hosting');
}

// MongoDB Room Schema
const roomSchema = new mongoose.Schema({
  pin: { type: String, required: true, unique: true, index: true },
  createdAt: { type: Date, default: Date.now },
  media: [
    {
      id: String,
      filename: String,
      originalName: String,
      mimeType: String,
      type: String, // 'photo' or 'video'
      size: Number,
      url: String, // Permanent Cloudinary CDN or local URL
      public_id: String, // Cloudinary identifier for reliable deletion
      uploadedAt: { type: String, default: () => new Date().toISOString() }
    }
  ]
});

const Room = mongoose.models.Room || mongoose.model('Room', roomSchema);

// MongoDB Connection with Auto-Reconnect for Serverless
let isConnected = false;
async function connectDB() {
  if (isConnected || mongoose.connection.readyState === 1) {
    return true;
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    return false; // Falls back to local memory if not yet configured
  }

  try {
    await mongoose.connect(uri, {
      bufferCommands: false,
      serverSelectionTimeoutMS: 5000
    });
    isConnected = true;
    console.log('🍃 MongoDB Atlas connected! Permanent room database active.');
    return true;
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
    return false;
  }
}

// Local fallback store (for local testing before MongoDB env is added)
const localRooms = {};

// Helper: Get room
async function getRoom(pin) {
  const hasDB = await connectDB();
  if (hasDB) {
    return await Room.findOne({ pin }).lean();
  }
  return localRooms[pin] || null;
}

// Helper: Create room
async function createRoom(pin) {
  const hasDB = await connectDB();
  if (hasDB) {
    const existing = await Room.findOne({ pin });
    if (existing) return null;
    const room = await Room.create({ pin, media: [] });
    return room.toObject();
  } else {
    if (localRooms[pin]) return null;
    localRooms[pin] = { pin, createdAt: new Date().toISOString(), media: [] };
    return localRooms[pin];
  }
}

// Helper: Add media
async function addMediaToRoom(pin, items) {
  const hasDB = await connectDB();
  if (hasDB) {
    const updated = await Room.findOneAndUpdate(
      { pin },
      { $push: { media: { $each: items, $position: 0 } } },
      { new: true }
    );
    return updated ? updated.media : [];
  } else {
    if (!localRooms[pin]) localRooms[pin] = { pin, media: [] };
    localRooms[pin].media.unshift(...items);
    return localRooms[pin].media;
  }
}

// Helper: Remove media
async function removeMediaFromRoom(pin, mediaId) {
  const hasDB = await connectDB();
  if (hasDB) {
    const room = await Room.findOne({ pin });
    if (!room) return null;
    const item = room.media.find(m => m.id === mediaId);
    if (!item) return null;

    await Room.updateOne({ pin }, { $pull: { media: { id: mediaId } } });
    return item;
  } else {
    if (!localRooms[pin] || !localRooms[pin].media) return null;
    const index = localRooms[pin].media.findIndex(m => m.id === mediaId);
    if (index === -1) return null;
    const [removed] = localRooms[pin].media.splice(index, 1);
    return removed;
  }
}

// Temporary directory for multer upload stream
const UPLOADS_DIR = IS_VERCEL ? '/tmp/uploads' : path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (e) {}
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${unique}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB per file
  fileFilter: (req, file, cb) => {
    if (/^(image|video)\//i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only photos and videos allowed!'), false);
  }
});

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.json());

// WebSocket helper
function broadcastToPin(pin, payload) {
  if (!wss) return;
  const str = JSON.stringify(payload);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.currentPin === pin) {
      client.send(str);
    }
  });
}

function countClientsInPin(pin) {
  if (!wss) return 1;
  let count = 0;
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client.currentPin === pin) count++;
  });
  return Math.max(1, count);
}

function broadcastPinStats(pin) {
  broadcastToPin(pin, { type: 'ROOM_STATS', onlineCount: countClientsInPin(pin) });
}

// ==================== REST APIS ====================

// 1. Check PIN Status
app.get('/api/room/:pin/check', async (req, res) => {
  const pin = req.params.pin.trim();
  const room = await getRoom(pin);
  res.json({ exists: !!room, pin });
});

// 2. Create Room (Ensures PIN uniqueness forever in MongoDB)
app.post('/api/room/create', async (req, res) => {
  const { pin } = req.body;
  if (!pin || typeof pin !== 'string') {
    return res.status(400).json({ error: 'PIN is required' });
  }

  const cleanPin = pin.trim();
  if (cleanPin.length < 3) {
    return res.status(400).json({ error: 'PIN must be at least 3 digits' });
  }

  const room = await createRoom(cleanPin);
  if (!room) {
    return res.status(409).json({
      error: `PIN "${cleanPin}" is already taken! Multiple users cannot create a room with the same PIN.`
    });
  }

  res.json({ success: true, pin: cleanPin });
});

// 3. Get Media for Room
app.get('/api/room/:pin/media', async (req, res) => {
  const pin = req.params.pin.trim();
  const room = await getRoom(pin);
  if (!room) {
    return res.status(404).json({ error: 'Room does not exist' });
  }
  res.json({ pin, media: room.media || [] });
});

// 4. Upload media (Uploads to Cloudinary for permanent HTTPS delivery)
app.post('/api/room/:pin/upload', upload.array('files', 20), async (req, res) => {
  const pin = req.params.pin.trim();
  const room = await getRoom(pin);
  if (!room) {
    return res.status(404).json({ error: 'Room does not exist' });
  }

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No media files received' });
  }

  const isCloudinaryActive = !!(process.env.CLOUDINARY_URL || process.env.CLOUDINARY_CLOUD_NAME);
  const newItems = [];

  for (const file of req.files) {
    const isVideo = file.mimetype.startsWith('video');
    let fileUrl = `/uploads/${file.filename}`;
    let publicId = null;

    if (isCloudinaryActive) {
      try {
        const uploadRes = await cloudinary.uploader.upload(file.path, {
          resource_type: isVideo ? 'video' : 'image',
          folder: `alphabeta/rooms/${pin}`,
          use_filename: true
        });
        fileUrl = uploadRes.secure_url;
        publicId = uploadRes.public_id;

        // Clean up temporary serverless file
        if (fs.existsSync(file.path)) {
          try { fs.unlinkSync(file.path); } catch (e) {}
        }
      } catch (err) {
        console.error('Cloudinary upload error:', err);
      }
    }

    newItems.push({
      id: path.parse(file.filename).name,
      filename: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      type: isVideo ? 'video' : 'photo',
      size: file.size,
      url: fileUrl,
      public_id: publicId,
      uploadedAt: new Date().toISOString()
    });
  }

  await addMediaToRoom(pin, newItems);
  broadcastToPin(pin, { type: 'NEW_MEDIA', items: newItems });

  res.json({ success: true, count: newItems.length, items: newItems });
});

// 5. Delete media
app.delete('/api/room/:pin/media/:id', async (req, res) => {
  const pin = req.params.pin.trim();
  const { id } = req.params;

  const removed = await removeMediaFromRoom(pin, id);
  if (!removed) {
    return res.status(404).json({ error: 'Media not found' });
  }

  // If stored in Cloudinary, delete from Cloudinary
  if (removed.public_id) {
    try {
      await cloudinary.uploader.destroy(removed.public_id, {
        resource_type: removed.type === 'video' ? 'video' : 'image'
      });
    } catch (e) {}
  } else {
    const localP = path.join(UPLOADS_DIR, removed.filename);
    if (fs.existsSync(localP)) {
      try { fs.unlinkSync(localP); } catch (e) {}
    }
  }

  broadcastToPin(pin, { type: 'DELETE_MEDIA', id });
  res.json({ success: true });
});

// WebSocket Server (local and VPS)
if (wss) {
  wss.on('connection', ws => {
    ws.currentPin = null;
    ws.on('message', msg => {
      try {
        const data = JSON.parse(msg);
        if (data.type === 'JOIN_PIN') {
          const old = ws.currentPin;
          ws.currentPin = data.pin;
          if (old) broadcastPinStats(old);
          if (data.pin) broadcastPinStats(data.pin);
        }
      } catch (e) {}
    });
    ws.on('close', () => {
      if (ws.currentPin) {
        const p = ws.currentPin;
        ws.currentPin = null;
        broadcastPinStats(p);
      }
    });
  });
}

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

if (!IS_VERCEL) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`🚀 AlphaBeta Server is running!`);
    console.log(`💻 Local: http://localhost:${PORT}`);
    const ips = getLocalIpAddresses();
    if (ips.length > 0) {
      console.log(`📱 On Network:`);
      ips.forEach(ip => console.log(`   👉 http://${ip}:${PORT}`));
    }
    console.log(`======================================================\n`);
  });
}

module.exports = app;
