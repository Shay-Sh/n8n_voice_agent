# AI Voice Agent

A system that lets you make AI-powered outbound calls using ElevenLabs for conversation and Twilio for telephony.

## Features

- Make outbound calls to phone numbers
- AI-powered conversations using ElevenLabs' voice and conversation APIs
- Real-time audio streaming between Twilio and ElevenLabs
- Configurable AI prompt and initial message
- Diagnostic tools for troubleshooting connections

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)
- [ngrok](https://ngrok.com/) for exposing your local server to the internet
- [ElevenLabs](https://elevenlabs.io/) account with Conversational API access (requires Creator tier or above)
- [Twilio](https://www.twilio.com/) account with phone number capable of making calls

## ElevenLabs Setup

1. Create an account on [ElevenLabs](https://elevenlabs.io/)
2. Subscribe to a Creator plan or higher (required for Conversational API)
3. Go to your account settings and generate an API key
4. Create a Conversational AI agent:
   - Go to Voice Lab → Conversation Design
   - Create a new agent with appropriate settings for your use case
   - Make sure the agent is published
   - Note the Agent ID for your .env file

## Twilio Setup

1. Create a [Twilio](https://www.twilio.com/) account
2. Purchase a phone number with voice capabilities
3. Note your Account SID and Auth Token for your .env file

## Project Setup

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
4. Fill in your `.env` file with your credentials:
   ```
   PORT=3000
   BASE_URL=https://your-ngrok-url.ngrok-free.app

   # ElevenLabs Configuration
   ELEVENLABS_API_KEY=your_elevenlabs_api_key
   ELEVENLABS_AGENT_ID=your_elevenlabs_agent_id

   # Twilio Configuration
   TWILIO_ACCOUNT_SID=your_twilio_account_sid
   TWILIO_AUTH_TOKEN=your_twilio_auth_token
   TWILIO_PHONE_NUMBER=+1your_twilio_phone_number
   ```
5. Start ngrok to expose your local server:
   ```bash
   ngrok http 3000
   ```
6. Update your `.env` file with the ngrok URL from the previous step
7. Start the server:
   ```bash
   node src/server.js
   ```

## Diagnostic Tools

The project includes several diagnostic endpoints to help you troubleshoot:

- `/health`: Simple health check to verify the server is running
- `/test-elevenlabs`: Tests the connection to ElevenLabs API and WebSocket
- `/elevenlabs-test`: Web-based testing tool for ElevenLabs APIs and subscription status

## Usage

### Making a Call

Send a POST request to `/make-call` with the following JSON body:

```json
{
  "phoneNumber": "+1234567890",
  "prompt": "You are a friendly AI assistant making a call. Be concise and helpful.",
  "firstMessage": "Hello, this is an AI assistant calling to check in with you."
}
```

Example using curl:

```bash
curl -X POST http://localhost:3000/make-call \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "+1234567890", "prompt": "You are a friendly AI assistant", "firstMessage": "Hello, this is an AI calling you."}'
```

### Using with n8n

The project includes an n8n workflow example that you can import to automate outbound calls:

1. Import the `n8n-workflow-example.json` file into your n8n instance
2. Configure the webhook node with your server's URL
3. Set up Twilio and ElevenLabs credentials in n8n
4. Activate the workflow

## How It Works

1. When a call is initiated, the system generates TwiML instructions for Twilio
2. As the call connects, a WebSocket connection is established between Twilio and your server
3. Your server connects to ElevenLabs via a signed WebSocket URL
4. Audio is streamed in real-time between the caller and the AI agent
5. The conversation continues until either party ends the call

## Troubleshooting

### Call not connecting

- Ensure your ngrok URL is correctly set in the `.env` file
- Check that your Twilio credentials are valid
- Verify that your ElevenLabs API key and Agent ID are correct

### No audio from AI

- Check if your ElevenLabs subscription supports Conversational API (Creator tier or higher)
- Visit the `/elevenlabs-test` endpoint to diagnose subscription issues
- Ensure your ElevenLabs agent is properly configured and published
- Verify that the audio format settings match Twilio's requirements (mulaw, 8000Hz)

### WebSocket Connection Issues

- Make sure your agent is published in the ElevenLabs dashboard
- Check that your agent ID is correct in the .env file
- Visit the `/test-elevenlabs` endpoint to test your connection
- Look for detailed error messages in the server logs

## License

MIT 