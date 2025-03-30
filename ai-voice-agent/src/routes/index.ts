import { FastifyRequest, FastifyReply } from 'fastify';
import { WebSocket as FastifyWebSocket } from '@fastify/websocket';
import WebSocket from 'ws';
import twilio from 'twilio';
import { twilioClient } from '../index.js';
import { createSignedUrl, safeJsonParse } from '../utils/elevenlabs.js';

// Type for SocketStream from @fastify/websocket
interface SocketStream {
  socket: WebSocket;
  connection: any;
}

// Type definitions for request bodies
interface OutboundCallRequest {
  phoneNumber: string;
  prompt?: string;
  firstMessage?: string;
}

interface CallStatusUpdate {
  CallSid: string;
  CallStatus: string;
  From: string;
  To: string;
  Direction: string;
  CallDuration?: string;
  [key: string]: string | undefined;
}

// Map to track active call connections
const activeConnections = new Map<string, {
  twilioWs: WebSocket,
  elevenLabsWs: WebSocket
}>();

// Create a TwiML response (voice response)
function createVoiceResponse() {
  // Simple utility to create a TwiML response without importing the actual class
  return {
    connect: () => ({
      stream: (options: { url: string }) => ({
        parameter: (name: string, value: string) => ({
          parameter: (name2: string, value2: string) => ({
            toString: () => `<Response><Connect><Stream url="${options.url}"><Parameter name="${name}" value="${value}" /><Parameter name="${name2}" value="${value2}" /></Stream></Connect></Response>`
          }),
          toString: () => `<Response><Connect><Stream url="${options.url}"><Parameter name="${name}" value="${value}" /></Stream></Connect></Response>`
        })
      }),
      toString: () => `<Response><Connect></Connect></Response>`
    }),
    toString: () => `<Response></Response>`
  };
}

/**
 * Handler for initiating outbound calls (triggered from n8n)
 */
export async function handleOutboundCall(request: FastifyRequest, reply: FastifyReply) {
  try {
    // Extract parameters from request
    const body = request.body as OutboundCallRequest;
    const { phoneNumber, prompt, firstMessage } = body;

    // Validate request
    if (!phoneNumber) {
      return reply.code(400).send({
        success: false,
        error: 'Phone number is required'
      });
    }

    // Format phone number if needed
    const formattedNumber = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;

    // Initialize the call via Twilio
    const call = await twilioClient.calls.create({
      to: formattedNumber,
      from: process.env.TWILIO_PHONE_NUMBER!,
      url: `${process.env.WEBHOOK_BASE_URL}/call-twiml`,
      statusCallback: `${process.env.WEBHOOK_BASE_URL}/call-status`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST',
      // Pass custom parameters to TwiML
      twiml: `<Response><Connect><Stream url="${process.env.WEBHOOK_BASE_URL}/outbound-media-stream"><Parameter name="prompt" value="${prompt || 'You are a friendly AI assistant making a phone call.'}" /><Parameter name="first_message" value="${firstMessage || 'Hello, this is an automated call from an AI assistant.'}" /></Stream></Connect></Response>`
    });

    // Return success response
    return reply.code(200).send({
      success: true,
      message: 'Call initiated successfully',
      callSid: call.sid,
      status: call.status,
      to: formattedNumber
    });
  } catch (error: any) {
    console.error('Error initiating call:', error);
    return reply.code(500).send({
      success: false,
      error: error.message || 'Unknown error occurred',
      details: 'Failed to initiate outbound call'
    });
  }
}

/**
 * Handler for TwiML response (Twilio calls this to get call instructions)
 */
export async function handleTwiml(request: FastifyRequest, reply: FastifyReply) {
  try {
    // Extract parameters from the request
    const body = request.body as Record<string, string>;
    const prompt = body.prompt || 'You are a friendly AI assistant making a phone call.';
    const firstMessage = body.first_message || 'Hello, this is an automated call from an AI assistant.';

    // Create TwiML response
    const twiml = createVoiceResponse();
    
    // Set up Stream connection to our WebSocket
    const twimlResponse = twiml.connect().stream({
      url: `wss://${process.env.SERVER_DOMAIN}/outbound-media-stream`,
    }).parameter('prompt', prompt).parameter('first_message', firstMessage);

    // Send TwiML response
    reply.header('Content-Type', 'application/xml');
    return reply.send(twimlResponse.toString());
  } catch (error: any) {
    console.error('Error generating TwiML:', error);
    return reply.code(500).send('Error generating call instructions');
  }
}

/**
 * Handler for call status updates
 */
export async function handleCallStatus(request: FastifyRequest, reply: FastifyReply) {
  try {
    // Extract parameters from the request
    const body = request.body as CallStatusUpdate;
    
    // Log the call status update
    console.log('Call status update received:', {
      callSid: body.CallSid,
      status: body.CallStatus,
      direction: body.Direction,
      from: body.From,
      to: body.To,
      duration: body.CallDuration || '0',
      timestamp: new Date().toISOString()
    });

    // Return a success response
    return reply.code(200).send('OK');
  } catch (error: any) {
    console.error('Error processing call status update:', error);
    return reply.code(500).send('Error processing call status update');
  }
}

/**
 * Handler for WebSocket media stream
 */
export function handleMediaStream(connection: any, req: FastifyRequest) {
  const twilioWs = connection.socket;
  let elevenLabsWs: WebSocket | null = null;
  let streamSid: string | null = null;
  let customPrompt: string | null = null;
  let firstMessage: string | null = null;

  console.log('New WebSocket connection established');

  // Handle messages from Twilio
  twilioWs.on('message', async (message: Buffer) => {
    try {
      const messageStr = message.toString();
      const parsedMessage = safeJsonParse(messageStr);
      
      if (!parsedMessage) {
        console.error('Invalid JSON message from Twilio');
        return;
      }

      console.log('Received event from Twilio:', parsedMessage.event);

      // Handle different message types
      switch (parsedMessage.event) {
        case 'start':
          // Extract stream SID and call SID
          streamSid = parsedMessage.start?.streamSid;
          const callSid = parsedMessage.start?.callSid;
          
          if (!streamSid || !callSid) {
            console.error('Missing streamSid or callSid in start event');
            return;
          }

          // Extract custom parameters
          const parameters = parsedMessage.start?.customParameters || {};
          customPrompt = parameters.prompt || 'You are a friendly AI assistant making a phone call.';
          firstMessage = parameters.first_message || 'Hello, this is an automated call from an AI assistant.';

          console.log(`Call started: ${callSid}, Stream SID: ${streamSid}`);
          console.log(`Custom prompt: ${customPrompt}`);
          console.log(`First message: ${firstMessage}`);

          // Connect to ElevenLabs
          try {
            const signedUrl = await createSignedUrl();
            elevenLabsWs = new WebSocket(signedUrl);

            // Store the connection
            activeConnections.set(streamSid, {
              twilioWs,
              elevenLabsWs
            });

            // Initialize ElevenLabs WebSocket
            elevenLabsWs.on('open', () => {
              console.log('Connected to ElevenLabs');
              
              // Send initial configuration
              const initialConfig = {
                text: firstMessage,
                system_prompt: customPrompt,
                send_audio: true,
                audio_format: "mulaw",
                sample_rate: 8000
              };
              
              if (elevenLabsWs) {
                elevenLabsWs.send(JSON.stringify(initialConfig));
              }
            });

            // Handle messages from ElevenLabs
            elevenLabsWs.on('message', (data: WebSocket.Data) => {
              try {
                if (!streamSid) return;
                
                const elevenLabsMessage = safeJsonParse(data.toString());
                
                if (!elevenLabsMessage) {
                  console.error('Invalid JSON message from ElevenLabs');
                  return;
                }

                // Handle different message types from ElevenLabs
                if (elevenLabsMessage.audio) {
                  // Send audio data to Twilio
                  twilioWs.send(JSON.stringify({
                    streamSid,
                    event: 'media',
                    media: {
                      payload: elevenLabsMessage.audio
                    }
                  }));
                } else if (elevenLabsMessage.type === 'agent_response') {
                  // Log agent responses
                  console.log('Agent response:', elevenLabsMessage.text);
                } else if (elevenLabsMessage.type === 'user_transcript') {
                  // Handle user transcript
                  console.log('User transcript:', elevenLabsMessage.text);
                }
              } catch (error) {
                console.error('Error handling message from ElevenLabs:', error);
              }
            });

            // Handle errors and closure
            elevenLabsWs.on('error', (error: Error) => {
              console.error('ElevenLabs WebSocket error:', error);
            });

            elevenLabsWs.on('close', (code, reason) => {
              console.log(`ElevenLabs WebSocket closed: ${code}, ${reason}`);
              
              // Clean up the connection
              if (streamSid) {
                activeConnections.delete(streamSid);
              }
            });
          } catch (error) {
            console.error('Error connecting to ElevenLabs:', error);
          }
          break;

        case 'media':
          // Handle audio from Twilio (user's voice)
          if (streamSid && elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
            const payload = parsedMessage.media?.payload;
            
            if (payload) {
              // Send audio to ElevenLabs
              elevenLabsWs.send(JSON.stringify({
                audio: payload
              }));
            }
          }
          break;

        case 'mark':
          // Handle mark events (not used in this implementation)
          console.log('Mark event received:', parsedMessage.mark?.name);
          break;

        case 'stop':
          // Clean up when the call ends
          console.log('Stop event received, cleaning up');
          
          if (streamSid) {
            const connection = activeConnections.get(streamSid);
            
            if (connection?.elevenLabsWs) {
              connection.elevenLabsWs.close();
            }
            
            activeConnections.delete(streamSid);
          }
          break;
      }
    } catch (error) {
      console.error('Error processing Twilio message:', error);
    }
  });

  // Handle WebSocket closure
  twilioWs.on('close', () => {
    console.log('Twilio WebSocket closed');
    
    // Clean up ElevenLabs connection if it exists
    if (streamSid) {
      const connection = activeConnections.get(streamSid);
      
      if (connection?.elevenLabsWs) {
        connection.elevenLabsWs.close();
      }
      
      activeConnections.delete(streamSid);
    }
  });

  // Handle WebSocket errors
  twilioWs.on('error', (error: Error) => {
    console.error('Twilio WebSocket error:', error);
  });
} 