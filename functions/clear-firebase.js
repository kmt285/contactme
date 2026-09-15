// functions/clear-firebase.js
const { schedule } = require('@netlify/functions');
const admin = require('firebase-admin');

// Firebase Initialization
if (process.env.FIREBASE_SERVICE_ACCOUNT && !admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: "https://nextsocietymm-default-rtdb.asia-southeast1.firebasedatabase.app"
    });
}

const handler = async function(event, context) {
    try {
        if (!admin.apps.length) throw new Error("Firebase Admin not initialized");
        
        // ည ၁၂ နာရီတိုင်း ရှင်းလင်းမည့် Logic
        await admin.database().ref('global_chat').remove();
        await admin.database().ref('signals').remove();
        
        const privateChatsRef = admin.database().ref('private_chats');
        const snapshot = await privateChatsRef.once('value');
        
        if (snapshot.exists()) {
            const rooms = snapshot.val();
            const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000; 
            const cutoffTime = Date.now() - THIRTY_DAYS_MS;

            for (const roomId in rooms) {
                const messages = rooms[roomId];
                for (const msgId in messages) {
                    const msg = messages[msgId];
                    if (msg.status === 'seen' || msg.timestamp < cutoffTime) {
                        await privateChatsRef.child(`${roomId}/${msgId}`).remove();
                    }
                }
            }
        }
        
        return { statusCode: 200, body: JSON.stringify({ success: true, message: "Database cleanup completed." }) };
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ success: false, error: "Cron Job Failed" }) };
    }
};

// ည ၁၂ နာရီတိုင်း အလုပ်လုပ်ရန် Schedule သတ်မှတ်ခြင်း (Vercel Cron အစားထိုး)
exports.handler = schedule("0 0 * * *", handler);
