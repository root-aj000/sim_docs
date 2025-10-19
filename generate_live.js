import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const GEMINI_API_KEY = process.env.GOOGLE_API_KEYS;

const response = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "Hello Gemini! what is your name and model gemini 2.0 or gemini 2.5 flash" }] }],
    }),
  }
);

const data = await response.json();
console.log(data.candidates?.[0]?.content?.parts?.[0]?.text);
