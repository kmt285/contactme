require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const CryptoJS = require('crypto-js');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PASSWORD = process.env.ADMIN_PASSWORD;
const MONGO_URI = process.env.MONGODB_URI;

// --- MongoDB ချိတ်ဆက်ခြင်း ---
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ MongoDB Connected Successfully'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// --- Database Schemas တည်ဆောက်ခြင်း ---
const ConfigSchema = new mongoose.Schema({
    type: { type: String, default: "desktop", unique: true },
    data: { type: Object, default: {} }
});
const Config = mongoose.model('Config', ConfigSchema);

const MessageSchema = new mongoose.Schema({
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

// Rate Limiter
const sendLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 5, 
    message: { success: false, error: "Too many requests. Please try again later." },
});

// --- API Endpoints ---

// ၁။ Desktop Config ကို DB မှ ဆွဲယူခြင်း
app.get('/api/get-config', async (req, res) => {
    try {
        const configDoc = await Config.findOne({ type: "desktop" });
        if (configDoc && configDoc.data) {
            res.status(200).json(configDoc.data);
        } else {
            // Database မှာ မရှိသေးရင် Default ပုံစံပြမည်
            res.status(200).json({
                wallpaper: "#008080",
                systemInfo: "OS Version: 1.0\nDeveloper: Your Name\nStatus: Running Smoothly",
                items: [
                    { id: "contact", title: "Secure Contact.exe", type: "app", icon: "📧", content: "contact_form" },
                    { id: "about", title: "About Me.txt", type: "text", icon: "📄", content: "Hello! Welcome to my portfolio!" }
                ]
            });
        }
    } catch (error) {
        res.status(500).json({ error: "Database fetching error" });
    }
});

// ၂။ Desktop Config အသစ်ကို DB သို့ သိမ်းခြင်း (Update/Upsert)
app.post('/api/save-config', async (req, res) => {
    const { adminPassword, configData } = req.body;
    if (adminPassword !== PASSWORD) return res.status(401).send("Unauthorized");

    try {
        await Config.findOneAndUpdate(
            { type: "desktop" }, 
            { data: configData }, 
            { upsert: true, new: true }
        );
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// ၃။ Message အသစ်ပေးပို့ခြင်း
app.post('/api/send', sendLimiter, async (req, res) => {
    try {
        const { name, contact, message } = req.body;
        if(!message) return res.status(400).json({ success: false });

        const formattedMessage = `👤 Name: ${name || "Anonymous"}\n📞 Contact: ${contact || "Not provided"}\n\n💬 Message:\n${message}`;
        // Message ကို Encrypt လုပ်ပြီးမှ DB ထဲသိမ်းပါမည်
        const encryptedMessage = CryptoJS.AES.encrypt(formattedMessage, PASSWORD).toString();
        
        const newMsg = new Message({ content: encryptedMessage });
        await newMsg.save();

        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// ၄။ Admin နေရာအတွက် Message များကို ခေါ်ယူခြင်း
app.post('/api/get-messages', async (req, res) => {
    const { adminPassword } = req.body;
    if (adminPassword !== PASSWORD) return res.status(401).send("Unauthorized");

    try {
        const messages = await Message.find().sort({ createdAt: -1 }); // နောက်ဆုံးပို့တဲ့စာ အရင်ပေါ်မည်
        
        let messagesList = messages.map(msg => {
            let decryptedText = "Error decrypting message";
            try {
                decryptedText = CryptoJS.AES.decrypt(msg.content, PASSWORD).toString(CryptoJS.enc.Utf8);
            } catch(e) {}

            return { 
                id: msg._id, 
                date: msg.createdAt,
                content: decryptedText 
            };
        });
        res.status(200).json(messagesList);
    } catch (error) {
        res.status(500).json([]);
    }
});

// ၅။ Message ဖျက်ခြင်း
app.post('/api/delete', async (req, res) => {
    const { adminPassword, id } = req.body;
    if (adminPassword !== PASSWORD) return res.status(401).send("Unauthorized");

    try {
        await Message.findByIdAndDelete(id); // MongoDB ID ဖြင့် တိုက်ရိုက်ရှာပြီးဖျက်မည်
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));

module.exports = app;
