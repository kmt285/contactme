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

// --- Chat User Schema (MongoDB တွင်သိမ်းရန်) ---
const ChatUserSchema = new mongoose.Schema({ 
    username: { type: String, required: true, unique: true },  // e.g., aung285 (Unique)
    password: { type: String, required: true },                // Hashed Password
    display_name: { type: String, required: true },            // စိတ်ကြိုက်ပြောင်းနိုင်သော နာမည်
    createdAt: { type: Date, default: Date.now } 
});
const ChatUser = mongoose.model('ChatUser', ChatUserSchema);

// --- ၁။ Chat Account အသစ်ဖွင့်ခြင်း (Signup) ---
app.post('/api/chat-signup', signupLimiter, async (req, res) => {
    try {
        const { display_name, username, password } = req.body;
        
        // Username သည် စာလုံးအသေးနှင့် ဂဏန်းသာဖြစ်ရမည်ကို Backend တွင် ထပ်စစ်ခြင်း
        if (!/^[a-z0-9]+$/.test(username)) {
            return res.status(400).json({ success: false, message: "Username must contain only small letters and numbers." });
        }

        // DB တွင် Username တူတာရှိပြီးသားလား စစ်ဆေးခြင်း
        const existingUser = await ChatUser.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ success: false, message: "ဤ Username အား အခြားသူ အသုံးပြုထားပါသည်။" });
        }
        
        // Password အား Encryption (Hash) လုပ်၍ လုံခြုံစွာသိမ်းခြင်း
        const hashedPassword = CryptoJS.SHA256(password).toString();
        await new ChatUser({ username, password: hashedPassword, display_name }).save();
        
        res.status(200).json({ success: true });
    } catch (error) { 
        res.status(500).json({ success: false, error: "Database Error" }); 
    }
});

// --- ၂။ Chat Login ဝင်ခြင်း ---
app.post('/api/chat-login', loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        const hashedPassword = CryptoJS.SHA256(password).toString();
        
        const user = await ChatUser.findOne({ username, password: hashedPassword });
        
        if (user) {
            res.status(200).json({ success: true, display_name: user.display_name, username: user.username });
        } else {
            res.status(401).json({ success: false, message: "Username သို့မဟုတ် Password မှားယွင်းနေပါသည်။" });
        }
    } catch (error) { 
        res.status(500).json({ success: false, error: "Database Error" }); 
    }
});

// --- ၃။ Display Name အသစ်ပြောင်းခြင်း ---
app.post('/api/chat-update-name', async (req, res) => {
    try {
        const { username, display_name } = req.body;
        await ChatUser.findOneAndUpdate({ username }, { display_name });
        res.status(200).json({ success: true });
    } catch (error) { 
        res.status(500).json({ success: false }); 
    }
});

const sendLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: { success: false, error: "Too many requests." } });

// --- Authentication Rate Limiters (Brute-force ကာကွယ်ရန်) ---

// ၁။ Signup Limiter: IP တစ်ခုတည်းကနေ Account အများကြီး ဆက်တိုက်ဖွင့်ခြင်းကို ကာကွယ်ရန်
const signupLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // ၁၅ မိနစ် (အချိန်သတ်မှတ်ချက်)
    max: 5, // ၁၅ မိနစ်အတွင်း အများဆုံး ၅ ကြိမ်သာ request ပို့ခွင့်ပြုမည်
    message: { 
        success: false, 
        message: "အကောင့်ဖွင့်ရန် ကြိုးစားမှု များပြားလွန်းနေပါသည်။ ၁၅ မိနစ်ခန့်စောင့်ပြီးမှ ထပ်မံကြိုးစားပါ။" 
    },
    standardHeaders: true, // X-RateLimit အစား စံသတ်မှတ်ထားသော RateLimit headers များကို သုံးမည်
    legacyHeaders: false,
});

// ၂။ Login Limiter: Password မှန်းပြီး အကြိမ်ကြိမ်စမ်းဝင်ခြင်းကို ကာကွယ်ရန်
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // ၁၅ မိနစ် (အချိန်သတ်မှတ်ချက်)
    max: 5, // Password အမှား ၅ ကြိမ်ထက်ပိုရိုက်မိပါက ပိတ်ပင်မည်
    message: { 
        success: false, 
        message: "Login ဝင်ရန် ကြိုးစားမှု များပြားလွန်းနေပါသည်။ ၁၅ မိနစ်ခန့်စောင့်ပြီးမှ ထပ်မံကြိုးစားပါ။" 
    },
    standardHeaders: true,
    legacyHeaders: false,
});

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

// --- 🚨 ၂၄ နာရီတစ်ခါ Vercel Cron မှလှမ်းခေါ်၍ Firebase ကို ရှင်းလင်းမည့် API ---
app.get('/api/cron/clear-firebase', async (req, res) => {
    try {
        // သင်၏ Firebase Realtime Database URL
        const firebaseUrl = "https://nextsocietymm-default-rtdb.asia-southeast1.firebasedatabase.app/global_chat.json";
        
        // Firebase မှ global_chat အောက်ရှိ Data အားလုံးကို ဖျက်ပစ်ရန် DELETE Request ပို့ခြင်း
        const response = await fetch(firebaseUrl, {
            method: 'DELETE'
        });

        if (response.ok) {
            console.log("✅ Chat database cleared successfully.");
            res.status(200).json({ success: true, message: "Chat database cleared." });
        } else {
            res.status(500).json({ success: false, message: "Failed to clear Firebase." });
        }
    } catch (error) {
        console.error("❌ Cron Job Error:", error);
        res.status(500).json({ success: false, error: "Cron Job Failed" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));
module.exports = app;
