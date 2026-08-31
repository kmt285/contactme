require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { Octokit } = require('@octokit/rest');
const CryptoJS = require('crypto-js');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const PASSWORD = process.env.ADMIN_PASSWORD;

const sendLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 5, 
    message: { success: false, error: "Too many requests. Please try again later." },
});

async function getGithubFile(filePath) {
    try {
        const { data } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path: filePath });
        return { content: Buffer.from(data.content, 'base64').toString('utf-8'), sha: data.sha };
    } catch (error) {
        return null;
    }
}

app.get('/api/get-config', async (req, res) => {
    const file = await getGithubFile('config/desktop.json');
    if (file) {
        res.status(200).json(JSON.parse(file.content));
    } else {
        res.status(200).json([
            { id: "contact", title: "Secure Contact.exe", type: "app", icon: "📧", content: "contact_form" },
            { id: "about", title: "About Me.txt", type: "text", icon: "📄", content: "Hello! I am a developer. Welcome to my retro OS portfolio!" }
        ]);
    }
});

app.post('/api/save-config', async (req, res) => {
    const { adminPassword, configData } = req.body;
    if (adminPassword !== PASSWORD) return res.status(401).send("Unauthorized");

    try {
        const file = await getGithubFile('config/desktop.json');
        await octokit.repos.createOrUpdateFileContents({
            owner: OWNER, repo: REPO,
            path: 'config/desktop.json',
            message: "Update Desktop Config",
            content: Buffer.from(JSON.stringify(configData, null, 2)).toString('base64'),
            sha: file ? file.sha : undefined
        });
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/send', sendLimiter, async (req, res) => {
    try {
        const { name, contact, message } = req.body;
        if(!message) return res.status(400).json({ success: false });

        const formattedMessage = `👤 Name: ${name || "Anonymous"}\n📞 Contact: ${contact || "Not provided"}\n\n💬 Message:\n${message}`;
        const encryptedMessage = CryptoJS.AES.encrypt(formattedMessage, PASSWORD).toString();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        
        await octokit.repos.createOrUpdateFileContents({
            owner: OWNER, repo: REPO, path: `messages/msg_${timestamp}.txt`,
            message: `New message at ${timestamp}`,
            content: Buffer.from(encryptedMessage).toString('base64')
        });
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

app.post('/api/get-messages', async (req, res) => {
    const { adminPassword } = req.body;
    if (adminPassword !== PASSWORD) return res.status(401).send("Unauthorized");

    try {
        const { data: files } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path: 'messages' });
        let messagesList = [];
        
        for (let file of files) {
            if(file.name.endsWith('.txt')) {
                const { data: fileData } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path: file.path });
                const decryptedText = CryptoJS.AES.decrypt(Buffer.from(fileData.content, 'base64').toString('utf-8'), PASSWORD).toString(CryptoJS.enc.Utf8);
                messagesList.push({ name: file.name, content: decryptedText, sha: file.sha });
            }
        }
        res.status(200).json(messagesList);
    } catch (error) {
        res.status(200).json([]);
    }
});

app.post('/api/delete', async (req, res) => {
    const { adminPassword, filename, sha } = req.body;
    if (adminPassword !== PASSWORD) return res.status(401).send("Unauthorized");

    try {
        await octokit.repos.deleteFile({
            owner: OWNER, repo: REPO, path: `messages/${filename}`,
            message: `Deleted ${filename}`, sha: sha 
        });
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port ' + PORT));

// Vercel Serverless Function အတွက် Export လုပ်ပေးခြင်း
module.exports = app;
