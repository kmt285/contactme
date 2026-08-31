require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Octokit } = require('@octokit/rest');
const CryptoJS = require('crypto-js');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const PASSWORD = process.env.ADMIN_PASSWORD;

const sendLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 5, 
    message: { success: false, error: "Too many requests. Please try again after 15 minutes." },
    standardHeaders: true,
    legacyHeaders: false,
});

// (၁) စာလက်ခံမည့် API
app.post('/api/send', sendLimiter, async (req, res) => {
    try {
        // Frontend မှ အချက်အလက်များကို လက်ခံခြင်း
        const { name, contact, message } = req.body;
        if(!message) return res.status(400).json({ success: false });

        // Name နှင့် Contact မပါပါက အစားထိုးခြင်း
        const senderName = name ? name.trim() : "Anonymous";
        const senderContact = contact ? contact.trim() : "Not provided";

        // Admin ဖတ်ရန် သပ်ရပ်သော ပုံစံဖြင့် စာစီခြင်း
        const formattedMessage = `👤 Name: ${senderName}\n📞 Contact: ${senderContact}\n\n💬 Message:\n${message}`;

        const encryptedMessage = CryptoJS.AES.encrypt(formattedMessage, PASSWORD).toString();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `messages/msg_${timestamp}.txt`;

        await octokit.repos.createOrUpdateFileContents({
            owner: OWNER,
            repo: REPO,
            path: filename,
            message: `New message at ${timestamp}`,
            content: Buffer.from(encryptedMessage).toString('base64')
        });
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

// (၂) Admin က စာဖတ်မည့် API
app.post('/api/get-messages', async (req, res) => {
    const { adminPassword } = req.body;
    if (adminPassword !== PASSWORD) return res.status(401).send("Unauthorized");

    try {
        const { data: files } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path: 'messages' });
        let messagesList = [];
        
        for (let file of files) {
            if(file.name.endsWith('.txt')) {
                const { data: fileData } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path: file.path });
                const encryptedText = Buffer.from(fileData.content, 'base64').toString('utf-8');
                const bytes = CryptoJS.AES.decrypt(encryptedText, PASSWORD);
                const decryptedText = bytes.toString(CryptoJS.enc.Utf8);
                
                messagesList.push({ name: file.name, content: decryptedText, sha: file.sha });
            }
        }
        res.status(200).json(messagesList);
    } catch (error) {
        res.status(200).json([]);
    }
});

// (၃) Message ကို ဖျက်မည့် API
app.post('/api/delete', async (req, res) => {
    const { adminPassword, filename, sha } = req.body;
    if (adminPassword !== PASSWORD) return res.status(401).send("Unauthorized");

    try {
        await octokit.repos.deleteFile({
            owner: OWNER,
            repo: REPO,
            path: `messages/${filename}`,
            message: `Deleted ${filename} via Admin Panel`,
            sha: sha 
        });
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

module.exports = app;

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server is running'));
