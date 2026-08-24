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
const PASSWORD = process.env.ADMIN_PASSWORD; // သင်သတ်မှတ်ထားသော Password

// (၁) စာလက်ခံပြီး ကုဒ်ဝှက်ကာ GitHub သို့ သိမ်းမည့် API
app.post('/api/send', async (req, res) => {
    try {
        const { message } = req.body;
        
        // Message ကို Password သုံးပြီး AES ဖြင့် ကုဒ်ဝှက်ခြင်း
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

// (၂) Admin က Password ထည့်ပါက စာပြန်ဖြည်ပြီး ထုတ်ပေးမည့် API
app.post('/api/get-messages', async (req, res) => {
    const { adminPassword } = req.body;
    
    // Admin Password မှန်မမှန် စစ်ဆေးခြင်း
    if (adminPassword !== PASSWORD) return res.status(401).send("Unauthorized");

    try {
        const { data: files } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path: 'messages' });
        let messagesList = [];
        
        for (let file of files) {
            if(file.name.endsWith('.txt')) {
                const { data: fileData } = await octokit.repos.getContent({ owner: OWNER, repo: REPO, path: file.path });
                
                // Base64 မှ စာသားပြန်ပြောင်းခြင်း
                const encryptedText = Buffer.from(fileData.content, 'base64').toString('utf-8');
                
                // Password သုံးပြီး စာသားအစစ်အဖြစ် ပြန်ဖြည်ခြင်း (Decryption)
                const bytes = CryptoJS.AES.decrypt(encryptedText, PASSWORD);
                const decryptedText = bytes.toString(CryptoJS.enc.Utf8);
                
                messagesList.push({ name: file.name, content: decryptedText });
            }
        }
        res.status(200).json(messagesList);
    } catch (error) {
        res.status(200).json([]); // ဖိုင်မရှိသေးရင် အလွတ်ပြမည်
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server is running'));
