import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import formBody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import twilio from 'twilio';
import WebSocket from 'ws';
import { ElevenLabsClient } from './services/elevenlabs.js';
// Initialize the Twilio client
export const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID || '', process.env.TWILIO_AUTH_TOKEN || '');
// Server configuration
const PORT = parseInt(process.env.PORT || '3000');
const HOST = '0.0.0.0';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
// Active connections
const activeConnections = new Map();
// Create the server instance
const server = Fastify({
    logger: true,
});
// Register plugins
async function setupServer() {
    // CORS for cross-origin requests
    await server.register(cors, {
        origin: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
    });
    // Form body parser for handling form data
    await server.register(formBody);
    // WebSocket support
    await server.register(websocket);
    // Health check endpoint
    server.get('/health', async () => {
        return {
            status: 'ok',
            timestamp: new Date().toISOString(),
            version: '1.0.0',
        };
    });
    // ElevenLabs connection test endpoint
    server.get('/test-elevenlabs', async (request, reply) => {
        try {
            const apiKey = process.env.ELEVENLABS_API_KEY;
            const agentId = process.env.ELEVENLABS_AGENT_ID;
            if (!apiKey) {
                return reply.code(400).send({
                    success: false,
                    error: 'Missing ElevenLabs API key in environment variables'
                });
            }
            if (!agentId) {
                return reply.code(400).send({
                    success: false,
                    error: 'Missing ElevenLabs Agent ID in environment variables'
                });
            }
            // First test - Simple HTTP request to verify API key
            console.log('Testing ElevenLabs API key...');
            const testApiResponse = await fetch('https://api.elevenlabs.io/v1/user', {
                method: 'GET',
                headers: {
                    'xi-api-key': apiKey
                }
            });
            if (!testApiResponse.ok) {
                const errorText = await testApiResponse.text();
                return reply.code(400).send({
                    success: false,
                    error: 'ElevenLabs API key validation failed',
                    details: errorText,
                    status: testApiResponse.status
                });
            }
            // Second test - WebSocket connection test
            console.log('Testing ElevenLabs WebSocket connection...');
            return new Promise((resolve) => {
                let testPassed = false;
                let errorDetails = '';
                // Create test WebSocket connection
                const wsUrl = `wss://api.elevenlabs.io/v1/conversation-stream?xi-api-key=${apiKey}&agent_id=${agentId}`;
                const testWs = new WebSocket(wsUrl);
                // Set a timeout in case connection hangs
                const timeout = setTimeout(() => {
                    if (!testPassed) {
                        try {
                            testWs.terminate();
                        }
                        catch (e) { }
                        resolve(reply.code(408).send({
                            success: false,
                            error: 'WebSocket connection test timed out',
                            details: errorDetails || 'No response from ElevenLabs after 10 seconds'
                        }));
                    }
                }, 10000);
                testWs.on('open', () => {
                    console.log('WebSocket connection to ElevenLabs established');
                    // Send a simple test message to initialize conversation
                    const testConfig = {
                        text: 'This is a test message',
                        system_prompt: 'You are a test assistant',
                        send_audio: true,
                        audio_format: 'mulaw',
                        sample_rate: 8000
                    };
                    testWs.send(JSON.stringify(testConfig));
                });
                testWs.on('message', (data) => {
                    try {
                        const message = JSON.parse(data.toString());
                        // Check if we received audio data
                        if (message.audio) {
                            console.log('Successfully received audio from ElevenLabs');
                            testPassed = true;
                            clearTimeout(timeout);
                            testWs.close();
                            resolve(reply.code(200).send({
                                success: true,
                                message: 'ElevenLabs connection test passed',
                                details: 'Successfully connected and received audio response'
                            }));
                        }
                        else if (message.type) {
                            console.log(`Received message type: ${message.type}`);
                            errorDetails += `Message type: ${message.type}\n`;
                            if (message.text) {
                                errorDetails += `Text: ${message.text}\n`;
                            }
                        }
                    }
                    catch (error) {
                        console.error('Error parsing message:', error);
                        errorDetails += `Parse error: ${error}\n`;
                    }
                });
                testWs.on('error', (error) => {
                    console.error('WebSocket test error:', error);
                    errorDetails += `WebSocket error: ${error.message}\n`;
                });
                testWs.on('close', (code, reason) => {
                    console.log(`WebSocket test connection closed: ${code}, ${reason}`);
                    if (!testPassed) {
                        clearTimeout(timeout);
                        resolve(reply.code(400).send({
                            success: false,
                            error: 'WebSocket connection closed before receiving audio',
                            details: errorDetails || 'No specific error details',
                            closeCode: code,
                            closeReason: reason
                        }));
                    }
                });
            });
        }
        catch (error) {
            const err = error;
            console.error('Error in ElevenLabs test:', err);
            return reply.code(500).send({
                success: false,
                error: err.message || 'Unknown error occurred',
                details: 'Failed to test ElevenLabs connection'
            });
        }
    });
    // Call status callback endpoint
    server.post('/call-status', async (request, reply) => {
        const body = request.body;
        console.log('Call status update:', {
            callSid: body.CallSid,
            status: body.CallStatus,
            direction: body.Direction,
            from: body.From,
            to: body.To,
            duration: body.CallDuration || '0',
            timestamp: new Date().toISOString()
        });
        // Simply return OK for Twilio status callbacks
        return reply.code(200).send('OK');
    });
    // TwiML endpoint for call instructions
    server.post('/call-twiml', async (request, reply) => {
        try {
            console.log('TwiML request received');
            const body = request.body;
            const prompt = body.prompt || 'You are a friendly AI assistant.';
            const firstMessage = body.first_message || 'Hello, this is an AI assistant calling you.';
            // Get proper WebSocket URL with secure protocol
            let wsProtocol = 'wss';
            let wsPath = '/call-stream';
            let wsHost = '';
            try {
                const url = new URL(BASE_URL);
                wsHost = url.host;
            }
            catch (e) {
                // If BASE_URL is not a valid URL, try to extract the hostname part
                wsHost = BASE_URL.replace(/^https?:\/\//, '');
            }
            const wsUrl = `${wsProtocol}://${wsHost}${wsPath}`;
            console.log('Using WebSocket URL in TwiML:', wsUrl);
            // Create TwiML response
            const twiml = `
        <Response>
          <Connect>
            <Stream url="${wsUrl}">
              <Parameter name="prompt" value="${prompt}" />
              <Parameter name="first_message" value="${firstMessage}" />
            </Stream>
          </Connect>
        </Response>
      `;
            reply.header('Content-Type', 'application/xml');
            return reply.send(twiml);
        }
        catch (error) {
            console.error('Error generating TwiML:', error);
            return reply.code(500).send('Error generating call instructions');
        }
    });
    // Outbound call initiation endpoint
    server.post('/make-call', async (request, reply) => {
        try {
            const body = request.body;
            const phoneNumber = body.phoneNumber;
            const prompt = body.prompt || 'You are a friendly AI assistant making a phone call.';
            const firstMessage = body.firstMessage || 'Hello, this is an automated call from an AI assistant.';
            if (!phoneNumber) {
                return reply.code(400).send({
                    success: false,
                    error: 'Phone number is required'
                });
            }
            // Format phone number if needed
            const formattedNumber = phoneNumber.startsWith('+')
                ? phoneNumber
                : `+${phoneNumber}`;
            // Initialize call with Twilio
            const call = await twilioClient.calls.create({
                to: formattedNumber,
                from: process.env.TWILIO_PHONE_NUMBER || '',
                url: `${BASE_URL}/call-twiml`,
                statusCallback: `${BASE_URL}/call-status`,
                statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
                statusCallbackMethod: 'POST',
            });
            return reply.code(200).send({
                success: true,
                message: 'Call initiated successfully',
                callSid: call.sid,
                status: call.status,
                to: formattedNumber
            });
        }
        catch (error) {
            const err = error;
            console.error('Error initiating call:', err);
            return reply.code(500).send({
                success: false,
                error: err.message || 'Unknown error occurred',
                details: 'Failed to initiate outbound call'
            });
        }
    });
    // WebSocket endpoint for call streaming
    server.get('/call-stream', { websocket: true }, (connection, request) => {
        // With @fastify/websocket, the connection object is already the socket
        const twilioSocket = connection;
        let streamSid = null;
        let callSid = null;
        let hasStarted = false;
        console.log('New WebSocket connection established');
        twilioSocket.on('message', (rawMessage) => {
            try {
                const messageStr = rawMessage.toString();
                const message = JSON.parse(messageStr);
                console.log(`Received event: ${message.event}`);
                if (message.event === 'start') {
                    streamSid = message.start?.streamSid || null;
                    callSid = message.start?.callSid || null;
                    if (!streamSid || !callSid) {
                        console.error('Missing streamSid or callSid in start event');
                        return;
                    }
                    const parameters = message.start?.customParameters || {};
                    const prompt = parameters.prompt || 'You are a friendly AI assistant.';
                    const firstMessage = parameters.first_message || 'Hello, this is an AI assistant calling you.';
                    console.log(`Call started: ${callSid}, Stream: ${streamSid}`);
                    console.log(`Prompt: ${prompt}`);
                    console.log(`First message: ${firstMessage}`);
                    // Initialize ElevenLabs client
                    const elevenLabsClient = new ElevenLabsClient({
                        streamSid,
                        twilioSocket,
                        prompt,
                        firstMessage
                    });
                    // Store the connection
                    activeConnections.set(streamSid, {
                        twilioSocket,
                        elevenLabsClient
                    });
                    // Start the conversation
                    hasStarted = true;
                    elevenLabsClient.startConversation().catch((err) => {
                        console.error('Error starting conversation:', err);
                        if (streamSid && activeConnections.has(streamSid)) {
                            cleanupConnection(streamSid);
                        }
                    });
                }
                else if (message.event === 'media' && streamSid) {
                    const payload = message.media?.payload;
                    if (payload && activeConnections.has(streamSid)) {
                        const connection = activeConnections.get(streamSid);
                        if (connection) {
                            connection.elevenLabsClient.sendAudio(payload).catch((err) => {
                                console.error('Error sending audio:', err);
                            });
                        }
                    }
                }
                else if (message.event === 'stop' && streamSid) {
                    console.log('Call ended (stop event), cleaning up');
                    if (streamSid) {
                        cleanupConnection(streamSid);
                    }
                }
            }
            catch (error) {
                const err = error;
                console.error('Error processing WebSocket message:', err);
            }
        });
        twilioSocket.on('close', (code, reason) => {
            console.log(`WebSocket connection closed: ${code}, ${reason || 'No reason'}`);
            if (streamSid && activeConnections.has(streamSid)) {
                cleanupConnection(streamSid);
            }
            else if (!hasStarted) {
                console.log('Connection closed before call started');
            }
        });
        twilioSocket.on('error', (error) => {
            console.error('WebSocket error:', error);
            // Attempt cleanup if we have a streamSid
            if (streamSid && activeConnections.has(streamSid)) {
                cleanupConnection(streamSid);
            }
        });
        // Helper function to clean up resources
        function cleanupConnection(sid) {
            console.log(`Cleaning up connection for stream ${sid}`);
            const connection = activeConnections.get(sid);
            if (connection) {
                try {
                    connection.elevenLabsClient.endConversation().catch((err) => {
                        console.error('Error ending conversation on cleanup:', err);
                    });
                }
                catch (err) {
                    console.error('Error during cleanup:', err);
                }
                finally {
                    activeConnections.delete(sid);
                    console.log(`Removed stream ${sid} from active connections`);
                }
            }
        }
    });
    try {
        // Start the server
        await server.listen({ port: PORT, host: HOST });
        console.log(`Server listening on port ${PORT}`);
        console.log(`Server URL: ${BASE_URL}`);
    }
    catch (err) {
        server.log.error(err);
        process.exit(1);
    }
}
// Start server
setupServer();
