import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import formBody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import twilio from 'twilio';
import WebSocket from 'ws';

// Simple ElevenLabs class for direct JS usage
class ElevenLabsClient {
  constructor(options) {
    if (!options || !options.streamSid || !options.twilioSocket) {
      throw new Error('Missing required parameters for ElevenLabs client');
    }
    
    this.streamSid = options.streamSid;
    this.twilioSocket = options.twilioSocket;
    this.prompt = options.prompt || 'You are a friendly AI assistant.';
    this.firstMessage = options.firstMessage || 'Hello, this is an AI assistant calling you.';
    this.ws = null;
    this.isConnected = false;
    
    console.log('ElevenLabs client initialized with streamSid:', this.streamSid);
  }

  // Get signed URL for authenticated conversations - this is the official way to connect
  async getSignedUrl() {
    try {
      const apiKey = process.env.ELEVENLABS_API_KEY;
      const agentId = process.env.ELEVENLABS_AGENT_ID;
      
      if (!apiKey || !agentId) {
        throw new Error('Missing ElevenLabs API key or Agent ID');
      }
      
      console.log('Getting signed URL for ElevenLabs connection...');
      const response = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agentId}`,
        {
          method: "GET",
          headers: {
            "xi-api-key": apiKey,
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get signed URL: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('Received signed URL from ElevenLabs');
      return data.signed_url;
    } catch (error) {
      console.error('Error getting signed URL:', error);
      throw error;
    }
  }

  async startConversation() {
    try {
      // Get the signed URL for conversation
      const signedUrl = await this.getSignedUrl();
      console.log('Got signed URL:', signedUrl.substring(0, 60) + '...');
      
      // Create WebSocket connection
      this.ws = new WebSocket(signedUrl);
      
      // Set up event handlers
      this.ws.on('open', () => {
        console.log('[ElevenLabs] Connected to Conversational AI');
        this.isConnected = true;
        
        // Send initial configuration with prompt and first message
        const initialConfig = {
          type: "conversation_initiation_client_data",
          conversation_config_override: {
            agent: {
              prompt: {
                prompt: this.prompt
              },
              first_message: this.firstMessage
            },
          },
        };
        
        console.log('[ElevenLabs] Sending initial config with prompt:', 
          initialConfig.conversation_config_override.agent.prompt.prompt);
        
        // Send the configuration to ElevenLabs
        this.ws.send(JSON.stringify(initialConfig));
      });
      
      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          
          // Handle different message types based on the example code
          switch (message.type) {
            case "conversation_initiation_metadata":
              console.log("[ElevenLabs] Received initiation metadata");
              break;
              
            case "audio":
              console.log("[ElevenLabs] Received audio");
              if (this.streamSid) {
                if (message.audio?.chunk) {
                  const audioData = {
                    event: "media",
                    streamSid: this.streamSid,
                    media: {
                      payload: message.audio.chunk,
                    },
                  };
                  this.twilioSocket.send(JSON.stringify(audioData));
                  console.log('[ElevenLabs] Sent audio chunk to Twilio');
                } else if (message.audio_event?.audio_base_64) {
                  const audioData = {
                    event: "media",
                    streamSid: this.streamSid,
                    media: {
                      payload: message.audio_event.audio_base_64,
                    },
                  };
                  this.twilioSocket.send(JSON.stringify(audioData));
                  console.log('[ElevenLabs] Sent audio_event to Twilio');
                }
              } else {
                console.log("[ElevenLabs] Received audio but no StreamSid yet");
              }
              break;
              
            case "interruption":
              console.log("[ElevenLabs] Received interruption");
              if (this.streamSid) {
                this.twilioSocket.send(
                  JSON.stringify({
                    event: "clear",
                    streamSid: this.streamSid,
                  })
                );
              }
              break;
              
            case "ping":
              if (message.ping_event?.event_id) {
                this.ws.send(
                  JSON.stringify({
                    type: "pong",
                    event_id: message.ping_event.event_id,
                  })
                );
                console.log("[ElevenLabs] Sent pong response");
              }
              break;
              
            case "agent_response":
              console.log(
                `[ElevenLabs] Agent response: ${message.agent_response_event?.agent_response}`
              );
              break;
              
            case "user_transcript":
              console.log(
                `[ElevenLabs] User transcript: ${message.user_transcription_event?.user_transcript}`
              );
              break;
              
            default:
              console.log(`[ElevenLabs] Unhandled message type: ${message.type}`);
          }
        } catch (error) {
          console.error('[ElevenLabs] Error processing message:', error);
        }
      });
      
      this.ws.on('error', (error) => {
        console.error('[ElevenLabs] WebSocket error:', error);
      });
      
      this.ws.on('close', () => {
        console.log('[ElevenLabs] Disconnected');
        this.isConnected = false;
      });
      
      // Return a promise that resolves when connected
      return new Promise((resolve, reject) => {
        // Add a timeout to prevent hanging
        const timeout = setTimeout(() => {
          if (!this.isConnected) {
            reject(new Error('Connection to ElevenLabs timed out'));
          }
        }, 10000);
        
        // When connected, resolve the promise
        this.ws.on('open', () => {
          clearTimeout(timeout);
          resolve();
        });
        
        // If error, reject the promise
        this.ws.on('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    } catch (error) {
      console.error('Error starting conversation:', error);
      throw error;
    }
  }

  async sendAudio(payload) {
    if (!this.isConnected || !this.ws) {
      console.warn('Cannot send audio: WebSocket not connected');
      return;
    }

    try {
      // Check WebSocket state before sending
      if (this.ws.readyState !== WebSocket.OPEN) {
        console.warn(`Cannot send audio: WebSocket not in OPEN state. Current state: ${this.ws.readyState}`);
        return;
      }

      // Convert base64 to buffer and back to ensure the right encoding
      console.log(`Sending audio to ElevenLabs, length: ${payload.length} bytes`);
      
      // Send the audio in the exact format ElevenLabs expects
      const audioMessage = {
        user_audio_chunk: payload
      };
      
      this.ws.send(JSON.stringify(audioMessage));
    } catch (error) {
      console.error('Error sending audio to ElevenLabs:', error);
    }
  }

  async endConversation() {
    if (!this.ws) {
      console.log('No active conversation to end');
      return;
    }
    
    try {
      if (this.ws.readyState === WebSocket.OPEN) {
        console.log('Closing ElevenLabs WebSocket connection');
        this.ws.close();
      } else {
        console.log('WebSocket already closing or closed');
      }
    } catch (error) {
      console.error('Error closing WebSocket:', error);
    } finally {
      this.ws = null;
      this.isConnected = false;
      console.log('ElevenLabs conversation ended');
    }
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
  await server.register(websocket, {
    options: {
      maxPayload: 1048576, // 1MB
    }
  });

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
      try {
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
        
        console.log('ElevenLabs API key validated successfully');
      } catch (err) {
        return reply.code(500).send({
          success: false,
          error: 'Failed to connect to ElevenLabs API',
          details: err.message
        });
      }
      
      // Second test - WebSocket connection test
      console.log('Testing ElevenLabs WebSocket connection...');
      return new Promise((resolve) => {
        let testPassed = false;
        let errorDetails = '';
        
        // First try to get a signed URL
        (async () => {
          try {
            console.log('Trying to get signed URL for test...');
            const signedUrlResponse = await fetch(`https://api.elevenlabs.io/v1/convai/start-conversation`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'xi-api-key': apiKey
              },
              body: JSON.stringify({
                agent_id: agentId
              })
            });
            
            let wsUrl;
            if (signedUrlResponse.ok) {
              const signedData = await signedUrlResponse.json();
              console.log('Received signed URL response:', Object.keys(signedData));
              
              if (signedData.signed_url) {
                wsUrl = signedData.signed_url;
                console.log('Using signed URL for test connection');
              } else {
                console.warn('No signed URL in response, falling back to direct connection');
                // Try v2 endpoint first
                wsUrl = `wss://api.elevenlabs.io/v2/conversation?xi-api-key=${apiKey}&agent_id=${agentId}&debug=true`;
              }
            } else {
              const errorText = await signedUrlResponse.text();
              console.warn(`Failed to get signed URL: ${signedUrlResponse.status}, ${errorText}`);
              // Try v2 endpoint first
              wsUrl = `wss://api.elevenlabs.io/v2/conversation?xi-api-key=${apiKey}&agent_id=${agentId}&debug=true`;
            }
            
            console.log('Connecting to WebSocket URL:', wsUrl);
            startWebSocketTest(wsUrl);
          } catch (error) {
            console.error('Error getting signed URL:', error);
            // Try v2 endpoint first
            const wsUrl = `wss://api.elevenlabs.io/v2/conversation?xi-api-key=${apiKey}&agent_id=${agentId}&debug=true`;
            startWebSocketTest(wsUrl);
          }
        })();
        
        function startWebSocketTest(wsUrl) {
          // Create test WebSocket connection
          const testWs = new WebSocket(wsUrl);
          
          console.log('Created test WebSocket connection');
          
          // Set a timeout in case connection hangs
          const timeout = setTimeout(() => {
            if (!testPassed) {
              try {
                testWs.terminate();
              } catch (e) {
                console.error('Error terminating WebSocket:', e);
              }
              
              // Try the fallback URL if this is the first attempt with v2
              if (wsUrl.includes('/v2/conversation')) {
                console.log('V2 endpoint failed, trying v1 with legacy protocol...');
                const fallbackUrl = `wss://api.elevenlabs.io/v1/conversation-stream?xi-api-key=${apiKey}&agent_id=${agentId}&use_legacy_protocol=true&debug=true`;
                startWebSocketTest(fallbackUrl);
                return;
              }
              
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
              audio_format: "mulaw",
              sample_rate: 8000
            };
            
            console.log('Sending test configuration to ElevenLabs');
            testWs.send(JSON.stringify(testConfig));
          });
          
          testWs.on('message', (data) => {
            try {
              const message = JSON.parse(data.toString());
              console.log('Received message from ElevenLabs:', Object.keys(message));
              
              // Check if we received audio data
              if (message.audio) {
                console.log('Successfully received audio from ElevenLabs');
                testPassed = true;
                clearTimeout(timeout);
                testWs.close();
                
                resolve(reply.code(200).send({
                  success: true,
                  message: 'ElevenLabs connection test passed',
                  details: 'Successfully connected and received audio response',
                  audioLength: message.audio.length
                }));
              } else if (message.type) {
                console.log(`Received message type: ${message.type}`);
                errorDetails += `Message type: ${message.type}\n`;
                if (message.text) {
                  errorDetails += `Text: ${message.text}\n`;
                }
              }
            } catch (error) {
              console.error('Error parsing message:', error);
              errorDetails += `Parse error: ${error}\n`;
            }
          });
          
          testWs.on('error', (error) => {
            console.error('WebSocket test error:', error);
            errorDetails += `WebSocket error: ${error.message}\n`;
            
            // Try the fallback URL if this is an error with v2
            if (wsUrl.includes('/v2/conversation') && !testPassed) {
              clearTimeout(timeout);
              console.log('V2 endpoint error, trying v1 with legacy protocol...');
              const fallbackUrl = `wss://api.elevenlabs.io/v1/conversation-stream?xi-api-key=${apiKey}&agent_id=${agentId}&use_legacy_protocol=true&debug=true`;
              startWebSocketTest(fallbackUrl);
              return;
            }
          });
          
          testWs.on('close', (code, reason) => {
            console.log(`WebSocket test connection closed: ${code}, ${reason}`);
            
            // Try the fallback URL if this is a closure with v2
            if (wsUrl.includes('/v2/conversation') && !testPassed) {
              clearTimeout(timeout);
              console.log('V2 endpoint closed, trying v1 with legacy protocol...');
              const fallbackUrl = `wss://api.elevenlabs.io/v1/conversation-stream?xi-api-key=${apiKey}&agent_id=${agentId}&use_legacy_protocol=true&debug=true`;
              startWebSocketTest(fallbackUrl);
              return;
            }
            
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
        }
      });
    } catch (error) {
      console.error('Error in ElevenLabs test:', error);
      return reply.code(500).send({
        success: false,
        error: error.message || 'Unknown error occurred',
        details: 'Failed to test ElevenLabs connection'
      });
    }
  });

  // ElevenLabs client-side test page
  server.get('/elevenlabs-test', async (request, reply) => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const agentId = process.env.ELEVENLABS_AGENT_ID;
    
    reply.type('text/html').send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>ElevenLabs Test</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
            .panel { background: #f5f5f5; padding: 15px; margin-bottom: 20px; border-radius: 5px; }
            button { background: #4CAF50; color: white; border: none; padding: 10px 15px; border-radius: 4px; cursor: pointer; }
            button:hover { background: #45a049; }
            pre { background: #f0f0f0; padding: 10px; overflow-x: auto; }
            .error { color: red; }
            .success { color: green; }
            #log { height: 200px; overflow-y: auto; background: #f0f0f0; padding: 10px; }
          </style>
        </head>
        <body>
          <h1>ElevenLabs Conversation Test</h1>
          
          <div class="panel">
            <h2>Configuration</h2>
            <p>API Key: <span id="apiKey">${apiKey ? '****' + apiKey.substring(apiKey.length - 6) : 'Not Set'}</span></p>
            <p>Agent ID: <span id="agentId">${agentId || 'Not Set'}</span></p>
          </div>
          
          <div class="panel">
            <h2>Test Connection</h2>
            <p>This will test the connection to ElevenLabs using their official client.</p>
            <button id="testButton">Test Connection</button>
            <div id="result" style="margin-top: 10px;"></div>
          </div>
          
          <div class="panel">
            <h2>Subscription Check</h2>
            <p>Let's check if your subscription supports the Conversational API:</p>
            <button id="checkSubButton">Check Subscription</button>
            <div id="subResult" style="margin-top: 10px;"></div>
          </div>
          
          <div class="panel">
            <h2>Log</h2>
            <div id="log"></div>
          </div>
          
          <div class="panel">
            <h2>Try it with the Official ElevenLabs Widget</h2>
            <p>This uses ElevenLabs' official widget to test your agent:</p>
            <elevenlabs-convai agent-id="${agentId}"></elevenlabs-convai>
          </div>
          
          <script>
            const log = document.getElementById('log');
            const result = document.getElementById('result');
            const testButton = document.getElementById('testButton');
            
            function logMessage(msg, isError = false) {
              const entry = document.createElement('div');
              entry.textContent = new Date().toISOString() + ': ' + msg;
              if (isError) {
                entry.className = 'error';
              }
              log.appendChild(entry);
              log.scrollTop = log.scrollHeight;
            }
            
            document.getElementById('testButton').addEventListener('click', async () => {
              testButton.disabled = true;
              result.innerHTML = 'Testing...';
              logMessage('Starting ElevenLabs connection test...');
              
              try {
                // First test: API key validation
                logMessage('Testing API key...');
                const userResponse = await fetch('/test-user', {
                  method: 'GET'
                });
                
                if (!userResponse.ok) {
                  throw new Error('API key validation failed: ' + await userResponse.text());
                }
                
                const userData = await userResponse.json();
                logMessage('API key validated. User: ' + userData.email);
                
                // Load the official ElevenLabs widget script
                logMessage('Loading ElevenLabs widget...');
                if (!document.querySelector('script[src*="elevenlabs"]')) {
                  const script = document.createElement('script');
                  script.src = 'https://widget.elevenlabs.io/dist/elevenlabs-convai-widget.production.js';
                  document.body.appendChild(script);
                  
                  await new Promise((resolve) => {
                    script.onload = resolve;
                    script.onerror = () => {
                      logMessage('Failed to load ElevenLabs widget script', true);
                      resolve();
                    };
                  });
                }
                
                logMessage('ElevenLabs widget loaded successfully');
                result.innerHTML = '<div class="success">Connection successful! Try the widget below.</div>';
              } catch (error) {
                logMessage('Error: ' + error.message, true);
                result.innerHTML = '<div class="error">Connection failed: ' + error.message + '</div>';
              } finally {
                testButton.disabled = false;
              }
            });
            
            document.getElementById('checkSubButton').addEventListener('click', async () => {
              const subResult = document.getElementById('subResult');
              subResult.innerHTML = 'Checking subscription...';
              logMessage('Checking subscription status...');
              
              try {
                // Get user subscription info
                const subResponse = await fetch('/test-subscription', {
                  method: 'GET'
                });
                
                if (!subResponse.ok) {
                  throw new Error('Subscription check failed: ' + await subResponse.text());
                }
                
                const subData = await subResponse.json();
                logMessage('Got subscription data: ' + JSON.stringify(subData));
                
                // Check subscription tier
                const tier = subData.subscription?.tier || 'free';
                const hasConversationalApi = subData.can_use_conversational_api === true;
                
                let subInfo = '<div>';
                subInfo += '<p>Current tier: <strong>' + tier + '</strong></p>';
                
                if (hasConversationalApi) {
                  subInfo += '<p class="success">✅ Your subscription supports the Conversational API!</p>';
                } else {
                  subInfo += '<p class="error">❌ Your subscription does NOT support the Conversational API.</p>';
                  subInfo += '<p>The ElevenLabs Conversational API requires at least the Creator tier subscription.</p>';
                  subInfo += '<p>Please <a href="https://elevenlabs.io/pricing" target="_blank">upgrade your subscription</a> to use the Conversational API.</p>';
                }
                
                // Character limits
                if (subData.character_limit) {
                  subInfo += '<p>Character limit: ' + subData.character_count + ' / ' + subData.character_limit + '</p>';
                }
                
                subInfo += '</div>';
                subResult.innerHTML = subInfo;
                
              } catch (error) {
                logMessage('Error checking subscription: ' + error.message, true);
                subResult.innerHTML = '<div class="error">Failed to check subscription: ' + error.message + '</div>';
              }
            });
            
            window.onload = () => {
              logMessage('Test page loaded');
            };
          </script>
        </body>
      </html>
    `);
  });
  
  // Helper endpoint to test ElevenLabs user API
  server.get('/test-user', async (request, reply) => {
    try {
      const apiKey = process.env.ELEVENLABS_API_KEY;
      
      if (!apiKey) {
        return reply.code(400).send({
          success: false,
          error: 'Missing ElevenLabs API key'
        });
      }
      
      const response = await fetch('https://api.elevenlabs.io/v1/user', {
        method: 'GET',
        headers: {
          'xi-api-key': apiKey
        }
      });
      
      if (!response.ok) {
        return reply.code(response.status).send({
          success: false,
          error: 'ElevenLabs API error',
          details: await response.text()
        });
      }
      
      const userData = await response.json();
      return reply.send(userData);
    } catch (error) {
      return reply.code(500).send({
        success: false,
        error: error.message
      });
    }
  });

  // Helper endpoint to check subscription status
  server.get('/test-subscription', async (request, reply) => {
    try {
      const apiKey = process.env.ELEVENLABS_API_KEY;
      
      if (!apiKey) {
        return reply.code(400).send({
          success: false,
          error: 'Missing ElevenLabs API key'
        });
      }
      
      // First get user subscription info
      const userResponse = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
        method: 'GET',
        headers: {
          'xi-api-key': apiKey
        }
      });
      
      if (!userResponse.ok) {
        return reply.code(userResponse.status).send({
          success: false,
          error: 'Failed to get subscription info',
          details: await userResponse.text()
        });
      }
      
      const subData = await userResponse.json();
      
      // Then try to check if the user can use the conversation API
      let canUseConversationalApi = false;
      
      try {
        // Try to list agents to see if user has conversational API access
        const agentsResponse = await fetch('https://api.elevenlabs.io/v1/convai/agents', {
          method: 'GET',
          headers: {
            'xi-api-key': apiKey
          }
        });
        
        // If we can list agents without a 403, user can use the conversational API
        canUseConversationalApi = agentsResponse.ok;
        
        // Add the agents response status to the response
        subData.agents_response_status = agentsResponse.status;
        
        if (agentsResponse.ok) {
          // Try to include agent info as well
          try {
            const agentsData = await agentsResponse.json();
            subData.agents = agentsData;
          } catch (e) {
            // Ignore JSON parse errors
          }
        }
      } catch (e) {
        // Ignore errors when checking conversational API access
      }
      
      // Add the can_use_conversational_api flag to the response
      subData.can_use_conversational_api = canUseConversationalApi;
      
      return reply.send(subData);
    } catch (error) {
      return reply.code(500).send({
        success: false,
        error: error.message
      });
    }
  });

  // Debug page for testing WebSockets
  server.get('/debug', async (request, reply) => {
    // Get current protocol and domain for WebSocket URL
    const protocol = request.protocol === 'https' ? 'wss' : 'ws';
    const host = request.headers.host || `localhost:${PORT}`;
    const wsUrl = `${protocol}://${host}/call-stream`;
    
    reply.type('text/html').send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>WebSocket Debug</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            .log { background: #f0f0f0; padding: 10px; height: 300px; overflow-y: auto; margin-bottom: 10px; }
            button { padding: 10px; margin-right: 5px; }
            .highlight { color: #007bff; }
          </style>
        </head>
        <body>
          <h1>WebSocket Debug Tool</h1>
          <p>This will test WebSocket connection to: <span class="highlight">${wsUrl}</span></p>
          <div class="log" id="log"></div>
          <div>
            <button id="connect">Connect</button>
            <button id="send">Send Test Message</button>
            <button id="close">Close</button>
          </div>
          
          <script>
            const log = document.getElementById('log');
            const wsUrl = '${wsUrl}';
            let socket;
            
            function logMessage(msg) {
              const entry = document.createElement('div');
              entry.textContent = new Date().toISOString() + ': ' + msg;
              log.appendChild(entry);
              log.scrollTop = log.scrollHeight;
            }
            
            document.getElementById('connect').addEventListener('click', () => {
              try {
                logMessage('Connecting to ' + wsUrl);
                socket = new WebSocket(wsUrl);
                
                socket.onopen = () => {
                  logMessage('Connection opened successfully');
                };
                
                socket.onmessage = (event) => {
                  logMessage('Received: ' + event.data);
                };
                
                socket.onerror = (error) => {
                  logMessage('Error: ' + JSON.stringify(error));
                };
                
                socket.onclose = (event) => {
                  logMessage('Connection closed: ' + event.code + ' ' + event.reason);
                };
              } catch (error) {
                logMessage('Connection error: ' + error.message);
              }
            });
            
            document.getElementById('send').addEventListener('click', () => {
              if (!socket || socket.readyState !== WebSocket.OPEN) {
                logMessage('Socket not connected');
                return;
              }
              
              try {
                const testMessage = JSON.stringify({
                  event: 'start',
                  start: {
                    streamSid: 'test-stream-sid',
                    callSid: 'test-call-sid',
                    customParameters: {
                      prompt: 'This is a test prompt',
                      first_message: 'This is a test message'
                    }
                  }
                });
                
                socket.send(testMessage);
                logMessage('Sent test message');
              } catch (error) {
                logMessage('Send error: ' + error.message);
              }
            });
            
            document.getElementById('close').addEventListener('click', () => {
              if (!socket) {
                logMessage('No socket to close');
                return;
              }
              
              try {
                socket.close();
                logMessage('Socket close requested');
              } catch (error) {
                logMessage('Close error: ' + error.message);
              }
            });
            
            window.onload = () => {
              logMessage('Debug page loaded');
            };
          </script>
        </body>
      </html>
    `);
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
      
      // Get BASE_URL and ensure it's properly formatted
      const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
      
      // Use the full URL format to ensure it works
      const streamUrl = baseUrl.replace(/^http/, 'ws').replace(/^https/, 'wss') + '/call-stream';
      
      console.log('Using WebSocket stream URL:', streamUrl);
      
      // Create TwiML response
      const twiml = `
        <Response>
          <Connect>
            <Stream url="${streamUrl}">
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

  // Outbound call initiation endpoint for n8n
  server.post('/make-outbound-call', async (request, reply) => {
    try {
      console.log('Received make-outbound-call request:', request.body);
      
      // Parse the body data
      let body = request.body;
      
      // Check if body is a string (could happen with certain content types)
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch (e) {
          console.error('Error parsing request body:', e);
        }
      }
      
      const phoneNumber = body.phoneNumber || body.number;
      const prompt = body.prompt || 'You are a friendly AI assistant making a phone call.';
      const firstMessage = body.firstMessage || body.first_message || 'Hello, this is an automated call from an AI assistant.';
      
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

  // Handler for WebSocket connections
  server.register(async function (fastify) {
    fastify.get('/call-stream', { websocket: true }, (connection) => {
      console.log('New WebSocket connection established');
      
      if (!connection) {
        console.error('Invalid connection object');
        return;
      }
      
      // With @fastify/websocket, the connection object IS the socket
      const socket = connection;
      console.log('Socket ready state:', socket.readyState);
      
      let streamSid = null;
      let callSid = null;
      
      // Setup listeners on the socket
      socket.on('message', (rawMessage) => {
        try {
          // Parse the message
          const messageStr = rawMessage.toString();
          const message = JSON.parse(messageStr);
          
          console.log(`Received Twilio event: ${message.event}`);
          
          // Start event - initialize connection
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
            
            try {
              // Initialize ElevenLabs client
              const elevenLabsClient = new ElevenLabsClient({
                streamSid,
                twilioSocket: socket,
                prompt,
                firstMessage
              });
              
              // Store the connection
              activeConnections.set(streamSid, {
                twilioSocket: socket,
                elevenLabsClient,
                isReady: false,  // Track if the connection is ready to receive audio
                audioQueue: [],   // Queue for audio while initializing
                startTime: Date.now()
              });
              
              // Start the conversation
              elevenLabsClient.startConversation()
                .then(() => {
                  console.log('✅ ElevenLabs conversation started successfully');
                  // Mark that the connection is ready to receive audio
                  if (activeConnections.has(streamSid)) {
                    activeConnections.get(streamSid).isReady = true;
                    console.log('Connection marked as ready for audio');
                    
                    // If we have any queued audio, send it now
                    if (activeConnections.get(streamSid).audioQueue && 
                        activeConnections.get(streamSid).audioQueue.length > 0) {
                      console.log(`Processing ${activeConnections.get(streamSid).audioQueue.length} queued audio packets`);
                      const queue = activeConnections.get(streamSid).audioQueue;
                      activeConnections.get(streamSid).audioQueue = [];
                      
                      queue.forEach(payload => {
                        elevenLabsClient.sendAudio(payload)
                          .catch(err => console.error('Error sending queued audio:', err));
                      });
                    }
                  }
                })
                .catch(err => {
                  console.error('❌ Error starting conversation:', err);
                  // Log connection attempts and WebSocket state
                  console.log('Connection attempts:', elevenLabsClient.connectionAttempts);
                  if (elevenLabsClient.ws) {
                    console.log('WebSocket ready state:', elevenLabsClient.ws.readyState);
                  } else {
                    console.log('WebSocket not initialized');
                  }
                });
            } catch (initError) {
              console.error('Error initializing ElevenLabs client:', initError);
            }
          } 
          // Media event - relay audio to ElevenLabs
          else if (message.event === 'media' && streamSid) {
            const payload = message.media?.payload;
            
            if (payload && activeConnections.has(streamSid)) {
              const connection = activeConnections.get(streamSid);
              
              // Check if the connection is ready to receive audio
              if (connection.isReady && connection.elevenLabsClient) {
                // Connection is ready, send audio directly
                connection.elevenLabsClient.sendAudio(payload)
                  .catch(err => {
                    console.error('Error sending audio to ElevenLabs:', err);
                  });
              } else if (connection.elevenLabsClient) {
                // Connection not ready yet, queue the audio
                console.log('Queueing audio packet for later - connection not ready yet');
                connection.audioQueue.push(payload);
                
                // Limit queue size to prevent memory issues
                if (connection.audioQueue.length > 50) {
                  connection.audioQueue.shift(); // Remove oldest entry
                }
                
                // If it's been more than 10 seconds and we're still queueing, log a warning
                const waitTime = Date.now() - connection.startTime;
                if (waitTime > 10000 && connection.audioQueue.length % 10 === 0) {
                  console.warn(`Still waiting for ElevenLabs connection after ${Math.round(waitTime/1000)}s, ${connection.audioQueue.length} packets queued`);
                }
              } else {
                console.warn('Cannot send audio: ElevenLabs client not initialized');
              }
            }
          }
          // Stop event - clean up
          else if (message.event === 'stop' && streamSid) {
            console.log('Call ended, cleaning up');
            
            if (activeConnections.has(streamSid)) {
              const connection = activeConnections.get(streamSid);
              
              if (connection && connection.elevenLabsClient) {
                connection.elevenLabsClient.endConversation()
                  .catch(err => {
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
      
      // Handle WebSocket connection closing
      socket.on('close', (code, reason) => {
        console.log(`WebSocket connection closed: ${code}, ${reason || 'No reason provided'}`);
        
        if (streamSid && activeConnections.has(streamSid)) {
          const connection = activeConnections.get(streamSid);
          
          if (connection && connection.elevenLabsClient) {
            connection.elevenLabsClient.endConversation()
              .catch(err => {
                console.error('Error ending conversation on socket close:', err);
              });
            
            activeConnections.delete(streamSid);
          }
        }
      });
      
      // Handle errors
      socket.on('error', (error) => {
        console.error('WebSocket error:', error);
      });
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