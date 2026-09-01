require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const CryptoJS = require('crypto-js');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken'); // JWT ကို ထည့်သွင်းခြင်း

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PASSWORD = process.env.ADMIN_PASSWORD;
const MONGO_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || "default_fallback_secret_key";

// --- MongoDB ချိတ်ဆက်ခြင်း ---
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.error('❌ DB Error:', err));

const ConfigSchema = new mongoose.Schema({ type: { type: String, default: "desktop", unique: true }, data: { type: Object, default: {} } });
const Config = mongoose.model('Config', ConfigSchema);
const MessageSchema = new mongoose.Schema({ content: { type: String, required: true }, createdAt: { type: Date, default: Date.now } });
const Message = mongoose.model('Message', MessageSchema);

const sendLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: { success: false, error: "Too many requests." } });

// --- JWT Middleware (Token စစ်ဆေးသည့် အပိုင်း) ---
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer <token>
    if (!token) return res.status(401).json({ success: false, message: "Access Denied" });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ success: false, message: "Invalid or Expired Token" });
        next();
    });
}

// --- API Endpoints ---

// ၁။ Login API (Token ထုတ်ပေးခြင်း)
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === PASSWORD) {
        // Token ကို 24 နာရီ သက်တမ်းသတ်မှတ်၍ ထုတ်ပေးသည်
        const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
        res.status(200).json({ success: true, token });
    } else {
        res.status(401).json({ success: false, message: "Incorrect Password" });
    }
});

app.get('/api/get-config', async (req, res) => {
    try {
        const configDoc = await Config.findOne({ type: "desktop" });
        if (configDoc && configDoc.data) res.status(200).json(configDoc.data);
        else res.status(200).json({ wallpaper: "#008080", systemInfo: "OS 1.0", items: [] });
    } catch (error) { res.status(500).json({ error: "DB error" }); }
});

app.post('/api/send', sendLimiter, async (req, res) => {
    try {
        const { name, contact, message } = req.body;
        if(!message) return res.status(400).json({ success: false });
        const formattedMessage = `👤 Name: ${name}\n📞 Contact: ${contact}\n\n💬 Message:\n${message}`;
        const encryptedMessage = CryptoJS.AES.encrypt(formattedMessage, PASSWORD).toString();
        await new Message({ content: encryptedMessage }).save();
        res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

// အောက်ပါ API များကို authenticateToken ခံ၍ လုံခြုံရေးမြှင့်ထားသည်
app.post('/api/save-config', authenticateToken, async (req, res) => {
    try {
        await Config.findOneAndUpdate({ type: "desktop" }, { data: req.body.configData }, { upsert: true });
        res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

// GET method သို့ ပြောင်းထားသည် (Token ကို Header မှလာမည်ဖြစ်၍ Body မလိုပါ)
app.get('/api/get-messages', authenticateToken, async (req, res) => {
    try {
        const messages = await Message.find().sort({ createdAt: -1 });
        let messagesList = messages.map(msg => {
            let decryptedText = "Error decrypting";
            try { decryptedText = CryptoJS.AES.decrypt(msg.content, PASSWORD).toString(CryptoJS.enc.Utf8); } catch(e) {}
            return { id: msg._id, date: msg.createdAt, content: decryptedText };
        });
        res.status(200).json(messagesList);
    } catch (error) { res.status(500).json([]); }
});

app.post('/api/delete', authenticateToken, async (req, res) => {
    try {
        await Message.findByIdAndDelete(req.body.id);
        res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));
module.exports = app;
