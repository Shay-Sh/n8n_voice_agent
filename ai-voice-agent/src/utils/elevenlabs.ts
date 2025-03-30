import crypto from 'crypto';
import { Readable } from 'stream';

/**
 * Creates a signed URL for ElevenLabs Conversational API
 * @returns Promise with the signed URL
 */
export async function createSignedUrl(): Promise<string> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  
  if (!apiKey || !agentId) {
    throw new Error('Missing required environment variables: ELEVENLABS_API_KEY or ELEVENLABS_AGENT_ID');
  }

  // Create a URL for the ElevenLabs Conversational API
  const baseUrl = 'wss://api.elevenlabs.io/v1/conversation-stream';
  
  return `${baseUrl}?xi-api-key=${apiKey}&agent_id=${agentId}`;
}

/**
 * Converts a readable stream to an ArrayBuffer
 * @param readableStream The readable stream to convert
 * @returns Promise with the ArrayBuffer
 */
export function streamToArrayBuffer(readableStream: Readable): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    readableStream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    readableStream.on('end', () => {
      resolve(Buffer.concat(chunks).buffer);
    });
    readableStream.on('error', reject);
  });
}

/**
 * Safely parses JSON
 * @param text Text to parse as JSON
 * @returns Parsed JSON or null if invalid
 */
export function safeJsonParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch (error) {
    console.error('Error parsing JSON:', error);
    return null;
  }
} 