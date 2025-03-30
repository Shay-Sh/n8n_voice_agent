import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import formBody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import twilio from 'twilio';
import WebSocket from 'ws';

// Simple ElevenLabs class for direct JS usage
class ElevenLabsClient {
  constructor({ streamSid, twilioSocket, prompt, firstMessage }) {
    this.streamSid = streamSid;
    this.twilioSocket = twilioSocket;
    this.prompt = prompt;
    this.firstMessage = firstMessage;
    this.ws = null;
    this.isConnected = false;
  }

  async startConversation() {
    try {
      // Create the WebSocket URL with authentication
      const apiKey = process.env.ELEVENLABS_API_KEY;
      const agentId = process.env.ELEVENLABS_AGENT_ID;
      
      if (!apiKey || !agentId) {
        throw new Error('Missing ElevenLabs API key or Agent ID');
      }

      // Connect to ElevenLabs
      const url = `wss://api.elevenlabs.io/v1/conversation-stream?xi-api-key=${apiKey}&agent_id=${agentId}`;
      this.ws = new WebSocket(url);

      // Set up event handlers
      this.ws.on('open', () => {
        console.log('Connected to ElevenLabs');
        this.isConnected = true;

        // Send the initial configuration
        const config = {
          text: this.firstMessage,
          system_prompt: this.prompt,
          send_audio: true,
          audio_format: "mulaw",
          sample_rate: 8000
        };

        this.ws.send(JSON.stringify(config));
      });

      this.ws.on('message', (data) => {
        try {
          // Parse the message
          const message = JSON.parse(data.toString());

          // Handle different message types
          if (message.audio) {
            // Send the audio to Twilio
            this.twilioSocket.send(JSON.stringify({
              streamSid: this.streamSid,
              event: 'media',
              media: {
                payload: message.audio
              }
            }));
          } else if (message.type === 'agent_response') {
            console.log('Agent response:', message.text);
          } else if (message.type === 'user_transcript') {
            console.log('User transcript:', message.text);
          }
        } catch (error) {
          console.error('Error handling message from ElevenLabs:', error);
        }
      });

      this.ws.on('error', (error) => {
        console.error('ElevenLabs WebSocket error:', error);
      });

      this.ws.on('close', (code, reason) => {
        console.log(`ElevenLabs WebSocket closed: ${code}, ${reason}`);
        this.isConnected = false;
      });
    } catch (error) {
      console.error('Error starting conversation:', error);
    }
  }

  async sendAudio(payload) {
    if (!this.isConnected || !this.ws) {
      console.warn('Cannot send audio: WebSocket not connected');
      return;
    }

    try {
      // Send the audio data to ElevenLabs
      this.ws.send(JSON.stringify({ audio: payload }));
    } catch (error) {
      console.error('Error sending audio to ElevenLabs:', error);
    }
  }

  async endConversation() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch (error) {
        console.error('Error closing WebSocket:', error);
      }
      this.ws = null;
    }
    this.isConnected = false;
  }
}

// Initialize the Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID || '',
  process.env.TWILIO_AUTH_TOKEN || ''
);

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
      
      // Extract hostname from BASE_URL
      let hostname = '';
      try {
        hostname = new URL(BASE_URL).hostname;
      } catch (e) {
        hostname = BASE_URL.replace(/^https?:\/\//, '');
      }
      
      // Create TwiML response
      const twiml = `
        <Response>
          <Connect>
            <Stream url="wss://${hostname}/call-stream">
              <Parameter name="prompt" value="${prompt}" />
              <Parameter name="first_message" value="${firstMessage}" />
            </Stream>
          </Connect>
        </Response>
      `;
      
      reply.header('Content-Type', 'application/xml');
      return reply.send(twiml);
    } catch (error) {
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
    } catch (error) {
      console.error('Error initiating call:', error);
      return reply.code(500).send({
        success: false,
        error: error.message || 'Unknown error occurred',
        details: 'Failed to initiate outbound call'
      });
    }
  });

  // WebSocket endpoint for call streaming
  server.get('/call-stream', { websocket: true }, (connection) => {
    const twilioSocket = connection.socket;
    let streamSid = null;
    let callSid = null;
    
    console.log('New WebSocket connection established');
    
    twilioSocket.on('message', (rawMessage) => {
      try {
        const messageStr = rawMessage.toString();
        const message = JSON.parse(messageStr);
        
        console.log(`Received event: ${message.event}`);
        
        if (message.event === 'start') {
          streamSid = message.start?.streamSid;
          callSid = message.start?.callSid;
          
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
          elevenLabsClient.startConversation().catch(err => {
            console.error('Error starting conversation:', err);
          });
        } 
        else if (message.event === 'media' && streamSid) {
          const payload = message.media?.payload;
          
          if (payload && activeConnections.has(streamSid)) {
            const connection = activeConnections.get(streamSid);
            if (connection) {
              connection.elevenLabsClient.sendAudio(payload).catch(err => {
                console.error('Error sending audio:', err);
              });
            }
          }
        }
        else if (message.event === 'stop' && streamSid) {
          console.log('Call ended, cleaning up');
          
          if (activeConnections.has(streamSid)) {
            const connection = activeConnections.get(streamSid);
            if (connection) {
              connection.elevenLabsClient.endConversation().catch(err => {
                console.error('Error ending conversation:', err);
              });
              activeConnections.delete(streamSid);
            }
          }
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
      }
    });
    
    twilioSocket.on('close', () => {
      console.log('WebSocket connection closed');
      
      if (streamSid && activeConnections.has(streamSid)) {
        const connection = activeConnections.get(streamSid);
        if (connection) {
          connection.elevenLabsClient.endConversation().catch(err => {
            console.error('Error ending conversation on close:', err);
          });
          activeConnections.delete(streamSid);
        }
      }
    });
    
    twilioSocket.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });
  
  try {
    // Start the server
    await server.listen({ port: PORT, host: HOST });
    console.log(`Server listening on port ${PORT}`);
    console.log(`Server URL: ${BASE_URL}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

// Start server
setupServer(); 