require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const CryptoJS = require('crypto-js');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken'); 
const admin = require('firebase-admin'); // Firebase Admin ကို ထည့်သွင်းခြင်း

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PASSWORD = process.env.ADMIN_PASSWORD;
const MONGO_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || "default_fallback_secret_key";

// --- Firebase Admin SDK ချိတ်ဆက်ခြင်း (Serverless Error မဖြစ်အောင် စစ်ဆေးခြင်း) ---
if (process.env.FIREBASE_SERVICE_ACCOUNT && !admin.apps.length) {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            databaseURL: "https://nextsocietymm-default-rtdb.asia-southeast1.firebasedatabase.app"
        });
        console.log('✅ Firebase Admin SDK Connected');
    } catch (err) {
        console.error('❌ Firebase Admin Init Error:', err);
    }
}

// --- MongoDB ချိတ်ဆက်ခြင်း ---
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected'))
    .catch(err => console.error('❌ DB Error:', err));

// 🚨 Vercel အတွက် အရေးကြီးသောပြင်ဆင်ချက်: Model တွေ ရှိပြီးသားဆိုရင် ထပ်မလုပ်အောင် (||) ဖြင့် ကာကွယ်ခြင်း 🚨
const ConfigSchema = new mongoose.Schema({ type: { type: String, default: "desktop", unique: true }, data: { type: Object, default: {} } });
const Config = mongoose.models.Config || mongoose.model('Config', ConfigSchema);

const MessageSchema = new mongoose.Schema({ content: { type: String, required: true }, createdAt: { type: Date, default: Date.now } });
const Message = mongoose.models.Message || mongoose.model('Message', MessageSchema);

const ChatUserSchema = new mongoose.Schema({ 
    username: { type: String, required: true, unique: true },  
    password: { type: String, required: true },                
    display_name: { type: String, required: true },            
    createdAt: { type: Date, default: Date.now } 
});
const ChatUser = mongoose.models.ChatUser || mongoose.model('ChatUser', ChatUserSchema);


// --- Authentication Rate Limiters များကို အပေါ်သို့ ရွှေ့ထားခြင်း ---
const signupLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 5, 
    message: { success: false, message: "အကောင့်ဖွင့်ရန် ကြိုးစားမှု များပြားလွန်းနေပါသည်။ ၁၅ မိနစ်ခန့်စောင့်ပြီးမှ ထပ်မံကြိုးစားပါ။" }
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 5, 
    message: { success: false, message: "Login ဝင်ရန် ကြိုးစားမှု များပြားလွန်းနေပါသည်။ ၁၅ မိနစ်ခန့်စောင့်ပြီးမှ ထပ်မံကြိုးစားပါ။" }
});

const sendLimiter = rateLimit({ 
    windowMs: 15 * 60 * 1000, 
    max: 5, 
    message: { success: false, error: "Too many requests." } 
});


// --- JWT Middleware ---
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; 
    if (!token) return res.status(401).json({ success: false, message: "Access Denied" });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ success: false, message: "Invalid or Expired Token" });
        next();
    });
}

// --- API Endpoints ---

// ၁။ Chat Account အသစ်ဖွင့်ခြင်း (Signup)
app.post('/api/chat-signup', signupLimiter, async (req, res) => {
    try {
        const { display_name, username, password } = req.body;
        if (!/^[a-z0-9]+$/.test(username)) {
            return res.status(400).json({ success: false, message: "Username must contain only small letters and numbers." });
        }
        const existingUser = await ChatUser.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ success: false, message: "ဤ Username အား အခြားသူ အသုံးပြုထားပါသည်။" });
        }
        const hashedPassword = CryptoJS.SHA256(password).toString();
        await new ChatUser({ username, password: hashedPassword, display_name }).save();
        res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: "Database Error" }); }
});

// ၂။ Chat Login ဝင်ခြင်း
app.post('/api/chat-login', loginLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        const hashedPassword = CryptoJS.SHA256(password).toString();
        const user = await ChatUser.findOne({ username, password: hashedPassword });
        if (user) res.status(200).json({ success: true, display_name: user.display_name, username: user.username });
        else res.status(401).json({ success: false, message: "Username သို့မဟုတ် Password မှားယွင်းနေပါသည်။" });
    } catch (error) { res.status(500).json({ success: false, error: "Database Error" }); }
});

// ၃။ Display Name အသစ်ပြောင်းခြင်း
app.post('/api/chat-update-name', async (req, res) => {
    try {
        const { username, display_name } = req.body;
        await ChatUser.findOneAndUpdate({ username }, { display_name });
        res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

// --- ၅။ Username ရှိ/မရှိ စစ်ဆေးခြင်း (Private Chat အတွက်) ---
app.post('/api/check-user', async (req, res) => {
    try {
        const { username } = req.body;
        // DB ထဲမှာ အဆိုပါ username နဲ့ လူရှိမရှိ ရှာဖွေမည်
        const user = await ChatUser.findOne({ username });
        if (user) {
            res.status(200).json({ success: true, exists: true });
        } else {
            res.status(200).json({ success: true, exists: false });
        }
    } catch (error) { 
        res.status(500).json({ success: false, error: "Database Error" }); 
    }
});

// ၄။ Admin Panel Login
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === PASSWORD) {
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

app.post('/api/save-config', authenticateToken, async (req, res) => {
    try {
        await Config.findOneAndUpdate({ type: "desktop" }, { data: req.body.configData }, { upsert: true });
        res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

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


// --- 🚨 ပြင်ဆင်ထားသော လုံခြုံရေးအပြည့်ပါသည့် Firebase ဖျက်သိမ်းခြင်း (Cron Job) 🚨 ---
app.get('/api/cron/clear-firebase', async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ success: false, message: "Unauthorized Request" });
    }

    try {
        if (!admin.apps.length) throw new Error("Firebase Admin not initialized");
        
        // ၁။ Global Chat ကို ည ၁၂ နာရီတိုင်း အကုန်ရှင်းလင်းမည်
        await admin.database().ref('global_chat').remove();
        await admin.database().ref('signals').remove();
        
        // ၂။ Private Chat များကို စစ်ဆေး၍ ရှင်းလင်းမည်
        const privateChatsRef = admin.database().ref('private_chats');
        const snapshot = await privateChatsRef.once('value');
        
        if (snapshot.exists()) {
            const rooms = snapshot.val();
            // Fallback: ရက် ၃၀ ကျော်သွားရင်တော့ seen မဖြစ်လည်း ဖျက်ပစ်မယ် (Database လုံးဝ မပြည့်စေရန် Safety Net)
            const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000; 
            const cutoffTime = Date.now() - THIRTY_DAYS_MS;

            for (const roomId in rooms) {
                const messages = rooms[roomId];
                for (const msgId in messages) {
                    const msg = messages[msgId];
                    // Seen ဖြစ်နေလျှင် (သို့) ၃၀ ရက်ကျော်နေလျှင် ဖျက်မည်
                    if (msg.status === 'seen' || msg.timestamp < cutoffTime) {
                        await privateChatsRef.child(`${roomId}/${msgId}`).remove();
                    }
                }
            }
        }
        
        console.log("✅ Database cleanup completed (Global wiped, Seen Private Messages cleared).");
        res.status(200).json({ success: true, message: "Database cleanup completed." });
    } catch (error) {
        console.error("❌ Cron Job Error:", error);
        res.status(500).json({ success: false, error: "Cron Job Failed" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));
module.exports = app;
