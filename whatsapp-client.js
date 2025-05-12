const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const moment = require('moment');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// OTP memory store
const otpStore = new Map();

const dataDir = path.join(__dirname, 'whatsapp-data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

class WhatsAppService {
    constructor() {
        this.qrCode = null;
        this.isAuthenticated = false;
        this.initialized = false;
        this.client = null;
        this.initializePromise = null;
        this.lastInitialized = null;

        try {
            const statusPath = path.join(dataDir, 'status.json');
            if (fs.existsSync(statusPath)) {
                const status = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
                this.isAuthenticated = status.isAuthenticated;
            }
        } catch (error) {
            console.error('Error reading auth status:', error);
        }
    }

    _saveAuthStatus() {
        try {
            const statusPath = path.join(dataDir, 'status.json');
            fs.writeFileSync(statusPath, JSON.stringify({
                isAuthenticated: this.isAuthenticated,
                lastUpdated: moment().utc().format('YYYY-MM-DD HH:mm:ss')
            }));
        } catch (error) {
            console.error('Error saving auth status:', error);
        }
    }

    async initializeClient() {
        if (this.initializePromise) return this.initializePromise;

        this.initializePromise = new Promise(async (resolve, reject) => {
            try {
                console.log(`[${moment().utc().format()}] Starting WhatsApp Client...`);

                this.client = new Client({
                    authStrategy: new LocalAuth({
                        clientId: 'reddevil212',
                        dataPath: dataDir
                    }),
                    puppeteer: {
                        headless: true,
                        args: [
                            '--no-sandbox',
                            '--disable-setuid-sandbox',
                            '--disable-dev-shm-usage',
                            '--disable-accelerated-2d-canvas',
                            '--disable-gpu'
                        ]
                    }
                });

                this.client.on('qr', async (qr) => {
                    try {
                        console.log(`[${moment().utc().format()}] QR Code received`);
                        this.qrCode = await qrcode.toDataURL(qr);
                        qrcodeTerminal.generate(qr, { small: true });
                        fs.writeFileSync(path.join(dataDir, 'qrcode.txt'), qr);
                    } catch (err) {
                        console.error('QR Code generation error:', err);
                    }
                });

                this.client.on('ready', () => {
                    console.log(`[${moment().utc().format()}] WhatsApp Client is ready`);
                    this.isAuthenticated = true;
                    this.qrCode = null;
                    this._saveAuthStatus();
                });

                this.client.on('authenticated', () => {
                    console.log(`[${moment().utc().format()}] Client authenticated`);
                    this.isAuthenticated = true;
                    this.qrCode = null;
                    this._saveAuthStatus();
                });

                this.client.on('auth_failure', (msg) => {
                    console.error(`[${moment().utc().format()}] Auth failed: ${msg}`);
                    this.isAuthenticated = false;
                    this._saveAuthStatus();
                });

                this.client.on('disconnected', async (reason) => {
                    console.warn(`[${moment().utc().format()}] Disconnected: ${reason}`);
                    this.isAuthenticated = false;
                    this._saveAuthStatus();
                    
                    // Attempt to reconnect
                    console.log(`[${moment().utc().format()}] Attempting to reconnect...`);
                    await this.reconnect();
                });

                await this.client.initialize();
                this.initialized = true;
                this.lastInitialized = moment().utc();
                resolve();
            } catch (err) {
                console.error(`[${moment().utc().format()}] Initialization failed:`, err);
                this.initialized = false;
                reject(err);
            }
        });

        return this.initializePromise;
    }

    async reconnect(maxAttempts = 5) {
        let attempts = 0;
        while (attempts < maxAttempts && !this.isAuthenticated) {
            try {
                console.log(`[${moment().utc().format()}] Reconnection attempt ${attempts + 1}/${maxAttempts}`);
                await this.initializeClient();
                if (this.isAuthenticated) {
                    console.log(`[${moment().utc().format()}] Successfully reconnected`);
                    return true;
                }
            } catch (error) {
                console.error(`[${moment().utc().format()}] Reconnection attempt failed:`, error);
            }
            attempts++;
            // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, Math.min(1000 * Math.pow(2, attempts), 30000)));
        }
        return false;
    }

    isValidPhoneNumber(number) {
        const phoneRegex = /^\d{10,15}$/;
        return phoneRegex.test(number.replace(/[^0-9]/g, ''));
    }

    async sendMessage(to, message) {
        if (!this.client || !this.initialized || !this.isAuthenticated) {
            throw new Error('WhatsApp client is not ready or authenticated');
        }

        const number = to.replace(/[^0-9]/g, '');
        const chatId = `${number}@c.us`;

        try {
            return await this.client.sendMessage(chatId, message);
        } catch (err) {
            console.error(`Failed to send message to ${chatId}:`, err);
            throw new Error('Failed to send WhatsApp message');
        }
    }

    async generateOTP(phone) {
        if (!this.isValidPhoneNumber(phone)) {
            throw new Error('Invalid phone number format');
        }

        if (!this.isAuthenticated || !this.initialized) {
            throw new Error('WhatsApp client is not authenticated or initialized');
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const referenceId = crypto.randomBytes(16).toString('hex');

        otpStore.set(referenceId, {
            phone,
            otp,
            attempts: 0,
            verified: false,
            generatedAt: moment().utc().format('YYYY-MM-DD HH:mm:ss'),
            expiryTime: Date.now() + 10 * 60 * 1000
        });

        const message = `Your OTP is: ${otp}. Valid for 10 minutes. Do not share it with anyone.`;
        await this.sendMessage(phone, message);

        return {
            referenceId,
            expiryInMinutes: 10,
            generatedAt: moment().utc().format('YYYY-MM-DD HH:mm:ss')
        };
    }

    async verifyOTP(referenceId, submittedOTP) {
        const otpData = otpStore.get(referenceId);

        if (!otpData) throw new Error('OTP expired or invalid reference ID');
        if (Date.now() > otpData.expiryTime) {
            otpStore.delete(referenceId);
            throw new Error('OTP expired');
        }
        if (otpData.attempts >= 3) {
            otpStore.delete(referenceId);
            throw new Error('Maximum verification attempts exceeded');
        }

        otpData.attempts++;

        if (otpData.otp === submittedOTP) {
            otpStore.delete(referenceId);
            return {
                success: true,
                message: 'OTP verified successfully',
                phone: otpData.phone,
                verifiedAt: moment().utc().format('YYYY-MM-DD HH:mm:ss')
            };
        }

        throw new Error('Invalid OTP');
    }

    cleanupExpiredOTPs() {
        const now = Date.now();
        for (const [key, value] of otpStore.entries()) {
            if (now > value.expiryTime) {
                otpStore.delete(key);
            }
        }
    }

    getServiceStatus() {
        return {
            authenticated: this.isAuthenticated,
            initialized: this.initialized,
            lastInitialized: this.lastInitialized ? this.lastInitialized.format('YYYY-MM-DD HH:mm:ss') : null,
            currentUser: 'reddevil212',
            lastActive: moment().utc().format('YYYY-MM-DD HH:mm:ss'),
            serverTime: moment().utc().format('YYYY-MM-DD HH:mm:ss')
        };
    }
}

module.exports = new WhatsAppService();
