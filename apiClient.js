// Ensure Node.js version is 18+ for built-in fetch support
const fetch = require('node-fetch'); // If using Node.js <18, install this via `npm install node-fetch`

const sendOtp = async () => {
    const phoneNumber = '919339399097';
    const API_KEY = 'hellowhoisthis007'; // Replace with your actual API key
    const SERVER_URL = 'https://whatsappserver-iota.vercel.app'; // Replace with your server's URL if hosted elsewhere

    try {
        const response = await fetch(`${SERVER_URL}/otp/generate?key=${API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': API_KEY
            },
            body: JSON.stringify({ phone: phoneNumber })
        });

        const data = await response.json();

        if (response.ok) {
            console.log('✅ OTP Sent Successfully:', data);
        } else {
            console.error('❌ Failed to send OTP:', data);
        }
    } catch (error) {
        console.error('❌ Error sending OTP:', error.message);
    }
};

sendOtp();
