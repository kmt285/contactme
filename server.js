require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Octokit } = require('@octokit/rest');
const CryptoJS = require('crypto-js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const PASSWORD = process.env.ADMIN_PASSWORD;

// (၁) စာလက်ခံပြီး သိမ်းမည့် API
app.post('/api/send', async (req, res) => {
    try {
        const { message } = req.body;
        const encryptedMessage = CryptoJS.AES.encrypt(message, PASSWORD).toString();
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
                
                // sha ကိုပါ ထည့်ပို့ပေးမည် (ဖျက်သည့်အခါ အသုံးပြုရန်)
                messagesList.push({ name: file.name, content: decryptedText, sha: file.sha });
            }
        }
        res.status(200).json(messagesList);
    } catch (error) {
        res.status(200).json([]);
    }
});

// (၃) Message ကို GitHub မှ အပြီးတိုင် ဖျက်မည့် API အသစ်
app.post('/api/delete', async (req, res) => {
    const { adminPassword, filename, sha } = req.body;
    if (adminPassword !== PASSWORD) return res.status(401).send("Unauthorized");

    try {
        await octokit.repos.deleteFile({
            owner: OWNER,
            repo: REPO,
            path: `messages/${filename}`,
            message: `Deleted ${filename} via Admin Panel`,
            sha: sha // ဖျက်ရန်အတွက် sha မဖြစ်မနေ လိုအပ်ပါသည်
        });
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server is running'));
