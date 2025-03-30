import WebSocket from 'ws';

// Type definitions for ElevenLabs API responses
interface ElevenLabsResponse {
  type?: string;
  text?: string;
  audio?: string; // Base64 encoded audio
}

// Constructor parameters
interface ElevenLabsClientOptions {
  streamSid: string;
  twilioSocket: WebSocket;
  prompt: string; 
  firstMessage: string;
}

/**
 * ElevenLabs client for handling conversation with the ElevenLabs API
 */
export class ElevenLabsClient {
  private streamSid: string;
  private twilioSocket: WebSocket;
  private prompt: string;
  private firstMessage: string;
  private ws: WebSocket | null;
  private isConnected: boolean;

  constructor({ streamSid, twilioSocket, prompt, firstMessage }: ElevenLabsClientOptions) {
    this.streamSid = streamSid;
    this.twilioSocket = twilioSocket;
    this.prompt = prompt;
    this.firstMessage = firstMessage;
    this.ws = null;
    this.isConnected = false;
  }

  /**
   * Starts the conversation with ElevenLabs
   */
  async startConversation(): Promise<void> {
    try {
      // Create the WebSocket URL with authentication
      const apiKey = process.env.ELEVENLABS_API_KEY;
      const agentId = process.env.ELEVENLABS_AGENT_ID;
      
      if (!apiKey || !agentId) {
        throw new Error('Missing ElevenLabs API key or Agent ID');
      }

      console.log('Creating ElevenLabs WebSocket connection...');
      
      // Connect to ElevenLabs
      const url = `wss://api.elevenlabs.io/v1/conversation-stream?xi-api-key=${apiKey}&agent_id=${agentId}`;
      this.ws = new WebSocket(url);

      // Add connection timeout
      const connectionTimeout = setTimeout(() => {
        if (!this.isConnected && this.ws) {
          console.error('ElevenLabs WebSocket connection timed out after 10 seconds');
          this.ws.terminate();
          this.ws = null;
        }
      }, 10000);

      // Set up event handlers - using function binding to preserve 'this' context
      this.ws.on('open', () => {
        clearTimeout(connectionTimeout);
        this.handleOpen();
      });
      this.ws.on('message', this.handleMessage.bind(this));
      this.ws.on('error', this.handleError.bind(this));
      this.ws.on('close', this.handleClose.bind(this));
    } catch (error) {
      console.error('Error starting conversation:', error);
    }
  }

  /**
   * Sends audio data to ElevenLabs
   */
  async sendAudio(payload: string): Promise<void> {
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

  /**
   * Ends the conversation and cleans up
   */
  async endConversation(): Promise<void> {
    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN) {
          console.log('Closing ElevenLabs WebSocket connection properly');
          this.ws.close(1000, 'Conversation ended by user or system');
        } else if (this.ws.readyState === WebSocket.CONNECTING) {
          console.log('WebSocket still connecting, terminating');
          this.ws.terminate();
        } else {
          console.log(`WebSocket in state ${this.ws.readyState}, already closing/closed`);
        }
      } catch (error) {
        console.error('Error closing WebSocket:', error);
        // Force terminate if close fails
        try {
          this.ws.terminate();
        } catch (e) {
          console.error('Failed to terminate WebSocket:', e);
        }
      }
      this.ws = null;
    }
    this.isConnected = false;
    
    // Send mark for end of conversation to Twilio if socket is still open
    if (this.twilioSocket && this.twilioSocket.readyState === WebSocket.OPEN) {
      try {
        // Signal completion to Twilio
        this.twilioSocket.send(JSON.stringify({
          streamSid: this.streamSid,
          event: 'mark',
          mark: {
            name: 'conversation-complete'
          }
        }));
        console.log('Sent conversation-complete mark to Twilio');
      } catch (error) {
        console.error('Error sending completion mark to Twilio:', error);
      }
    }
  }

  /**
   * Handles WebSocket open event
   */
  private handleOpen(): void {
    console.log('Connected to ElevenLabs WebSocket successfully');
    this.isConnected = true;

    // Send the initial configuration
    const config = {
      text: this.firstMessage,
      system_prompt: this.prompt,
      send_audio: true,
      audio_format: "mulaw",
      sample_rate: 8000
    };

    console.log('Sending initial configuration to ElevenLabs:', {
      firstMessageLength: this.firstMessage.length,
      promptLength: this.prompt.length,
      audioFormat: "mulaw",
      sampleRate: 8000
    });

    if (this.ws) {
      this.ws.send(JSON.stringify(config));
      console.log('Initial configuration sent to ElevenLabs');
    } else {
      console.error('WebSocket not available when trying to send initial configuration');
    }
  }

  /**
   * Handles WebSocket messages
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      // Parse the message
      const message = JSON.parse(data.toString()) as ElevenLabsResponse;

      // Log message type for diagnostics
      if (message.type) {
        console.log(`ElevenLabs message type: ${message.type}`);
      }
      
      // Check for error messages
      if (message.type === 'error') {
        console.error('ElevenLabs reported an error:', message.text);
      }

      // Handle different message types
      if (message.audio) {
        console.log('Received audio from ElevenLabs, sending to Twilio');
        // Send the audio to Twilio
        this.twilioSocket.send(JSON.stringify({
          streamSid: this.streamSid,
          event: 'media',
          media: {
            payload: message.audio
          }
        }));
      } else if (message.type === 'agent_response') {
        // Log agent responses
        console.log('Agent response:', message.text);
      } else if (message.type === 'user_transcript') {
        // Log user transcripts
        console.log('User transcript:', message.text);
      }
    } catch (error) {
      console.error('Error handling message from ElevenLabs:', error);
    }
  }

  /**
   * Handles WebSocket errors
   */
  private handleError(error: Error): void {
    console.error('ElevenLabs WebSocket error:', error);
  }

  /**
   * Handles WebSocket close
   */
  private handleClose(code: number, reason: string): void {
    console.log(`ElevenLabs WebSocket closed: ${code}, ${reason}`);
    this.isConnected = false;
  }
} 