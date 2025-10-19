import WebSocket from 'ws';
import dotenv from 'dotenv';

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL_ID = 'gemini-2.5-flash-live'; // Replace with your desired model ID

if (!GEMINI_API_KEY) {
  console.error('API key is missing. Please set it in the .env file.');
  process.exit(1);
}

const ws = new WebSocket('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent', {
  headers: {
    Authorization: `Bearer ${GEMINI_API_KEY}`,
  },
});

ws.on('open', () => {
  console.log('Connected to Gemini Live API');

  const sessionConfig = {
    model: MODEL_ID,
    generationConfig: {
      candidateCount: 1,
      maxOutputTokens: 200,
      temperature: 0.7,
      topP: 0.9,
      topK: 50,
      presencePenalty: 0.0,
      frequencyPenalty: 0.0,
      responseModalities: ['TEXT'],
    },
    systemInstruction: 'You are a helpful assistant.',
    tools: [],
  };

  ws.send(JSON.stringify({ bidiGenerateContentSetup: sessionConfig }));
});

ws.on('message', (data) => {
  const response = JSON.parse(data);
  if (response.bidiGenerateContentResponse) {
    console.log('Received response:', response.bidiGenerateContentResponse);
  }
});

ws.on('close', () => {
  console.log('Connection closed');
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error);
});
