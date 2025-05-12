const express = require('express');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const moment = require('moment');
const whatsappService = require('./whatsapp-client');

// Load environment variables
dotenv.config();

const app = express();

// Enable trust proxy - Add this before other middleware
app.set('trust proxy', 1);

app.use(express.json());

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false
});
app.use(limiter);

// Middleware to check API key
const checkApiKey = (req, res, next) => {
    const apiKey = req.query.key || req.headers['x-api-key'];

    if (!apiKey || apiKey !== process.env.API_KEY) {
        return res.status(401).json({
            success: false,
            error: 'Unauthorized - Invalid API key'
        });
    }
    next();
};

// API Routes
app.get('/status', checkApiKey, (req, res) => {
    res.json({
        success: true,
        ...whatsappService.getServiceStatus()
    });
});

app.get('/qr-status', checkApiKey, (req, res) => {
    res.json({
        success: true,
        authenticated: whatsappService.isAuthenticated,
        qrCode: whatsappService.qrCode,
        timestamp: moment().utc().format('YYYY-MM-DD HH:mm:ss')
    });
});

app.post('/otp/generate', checkApiKey, async (req, res) => {
    try {
        const { phone } = req.body;

        if (!phone) {
            return res.status(400).json({
                success: false,
                error: 'Phone number is required',
                timestamp: moment().utc().format('YYYY-MM-DD HH:mm:ss')
            });
        }

        const result = await whatsappService.generateOTP(phone);
        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: moment().utc().format('YYYY-MM-DD HH:mm:ss')
        });
    }
});

app.post('/otp/verify', checkApiKey, async (req, res) => {
    try {
        const { referenceId, otp } = req.body;

        if (!referenceId || !otp) {
            return res.status(400).json({
                success: false,
                error: 'Reference ID and OTP are required',
                timestamp: moment().utc().format('YYYY-MM-DD HH:mm:ss')
            });
        }

        const result = await whatsappService.verifyOTP(referenceId, otp);
        res.json(result);
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message,
            timestamp: moment().utc().format('YYYY-MM-DD HH:mm:ss')
        });
    }
});

// QR Code page
app.get('/qr', checkApiKey, (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>WhatsApp QR Code Scanner</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body {
                display: flex;
                justify-content: center;
                align-items: center;
                min-height: 100vh;
                margin: 0;
                background-color: #f0f2f5;
                font-family: Arial, sans-serif;
            }
            .container {
                text-align: center;
                padding: 2rem;
                background: white;
                border-radius: 10px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                max-width: 500px;
                width: 90%;
            }
            h1 {
                color: #128C7E;
                margin-bottom: 1rem;
            }
            #qrcode {
                margin: 2rem 0;
                padding: 1rem;
                background: white;
                border-radius: 8px;
            }
            #qrcode img {
                max-width: 256px;
                height: auto;
            }
            .status {
                margin-top: 1rem;
                padding: 1rem;
                border-radius: 5px;
                background: #f8f9fa;
                color: #666;
            }
            .instructions {
                margin-top: 1rem;
                font-size: 0.9rem;
                color: #666;
                text-align: left;
                padding: 1rem;
                background: #f8f9fa;
                border-radius: 5px;
            }
            .instructions ol {
                margin: 0;
                padding-left: 1.5rem;
            }
            .timestamp {
                font-size: 0.8rem;
                color: #999;
                margin-top: 1rem;
            }
            .user-info {
                font-size: 0.8rem;
                color: #666;
                margin-top: 1rem;
                padding: 0.5rem;
                background: #e9ecef;
                border-radius: 5px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>WhatsApp QR Code Scanner</h1>
            <div class="user-info">
                Logged in as: reddevil212
            </div>
            <div class="instructions">
                <strong>How to connect:</strong>
                <ol>
                    <li>Open WhatsApp on your phone</li>
                    <li>Go to Menu or Settings and select WhatsApp Web</li>
                    <li>Point your phone camera to this QR code</li>
                    <li>Authentication will happen automatically</li>
                </ol>
            </div>
            <div id="qrcode">Loading QR Code...</div>
            <div id="status" class="status">Initializing...</div>
            <div class="timestamp">Last Updated: <span id="timestamp"></span></div>
        </div>
        <script>
            function updateTimestamp() {
                const now = new Date();
                document.getElementById('timestamp').textContent = now.toISOString().replace('T', ' ').split('.')[0] + ' UTC';
            }

            async function updateQRCode() {
                try {
                    const response = await fetch('/qr-status?key=${req.query.key}');
                    if (!response.ok) {
                        throw new Error('Network response was not ok');
                    }
                    const data = await response.json();
                    
                    const qrDiv = document.getElementById('qrcode');
                    const statusDiv = document.getElementById('status');
                    updateTimestamp();

                    if (data.authenticated) {
                        qrDiv.innerHTML = '<p style="color: #128C7E; font-weight: bold;">✓ Successfully Authenticated!</p>';
                        statusDiv.innerHTML = 'WhatsApp is connected and ready to use';
                        statusDiv.style.backgroundColor = '#d4edda';
                        statusDiv.style.color = '#155724';
                        return;
                    }

                    if (data.qrCode) {
                        qrDiv.innerHTML = '<img src="' + data.qrCode + '" alt="WhatsApp QR Code">';
                        statusDiv.innerHTML = 'Scan this QR code with WhatsApp on your phone';
                        statusDiv.style.backgroundColor = '#f8f9fa';
                        statusDiv.style.color = '#666';
                    } else {
                        qrDiv.innerHTML = 'Generating QR Code...';
                        statusDiv.innerHTML = 'Please wait while we initialize the connection';
                        statusDiv.style.backgroundColor = '#fff3cd';
                        statusDiv.style.color = '#856404';
                    }
                } catch (error) {
                    console.error('Error:', error);
                    document.getElementById('status').innerHTML = 'Error loading QR code. Please refresh the page.';
                    document.getElementById('status').style.backgroundColor = '#f8d7da';
                    document.getElementById('status').style.color = '#721c24';
                }
            }

            // Initial check
            updateQRCode();
            
            // Update every 5 seconds
            setInterval(updateQRCode, 5000);
        </script>
    </body>
    </html>
    `;

    res.send(html);
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(`[${moment().utc().format('YYYY-MM-DD HH:mm:ss')}] Error:`, err.stack);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        timestamp: moment().utc().format('YYYY-MM-DD HH:mm:ss')
    });
});

// Cleanup expired OTPs periodically
setInterval(() => {
    whatsappService.cleanupExpiredOTPs();
}, 5 * 60 * 1000); // Every 5 minutes

// Initialize the WhatsApp client when the server starts
const initializeWhatsApp = async () => {
    try {
        console.log(`[${moment().utc().format('YYYY-MM-DD HH:mm:ss')}] Initializing WhatsApp client...`);
        
        // Add retry logic
        let retries = 0;
        const maxRetries = 3;
        
        while (retries < maxRetries) {
            try {
                await whatsappService.initializeClient();
                break;
            } catch (error) {
                retries++;
                console.error(`[${moment().utc().format()}] WhatsApp initialization attempt ${retries} failed:`, error);
                if (retries === maxRetries) throw error;
                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
    } catch (error) {
        console.error(`[${moment().utc().format()}] WhatsApp initialization error:`, error);
        // Don't exit the process, let it recover
        whatsappService.isAuthenticated = false;
    }
};

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[${moment().utc().format('YYYY-MM-DD HH:mm:ss')}] Server running on port ${PORT}`);
    // Initialize WhatsApp after server starts
    initializeWhatsApp();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log(`[${moment().utc().format('YYYY-MM-DD HH:mm:ss')}] Received SIGTERM signal. Shutting down gracefully...`);
    process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error(`[${moment().utc().format('YYYY-MM-DD HH:mm:ss')}] Unhandled Rejection at:`, promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error(`[${moment().utc().format('YYYY-MM-DD HH:mm:ss')}] Uncaught Exception:`, error);
});

module.exports = app;