import fs from "fs-extra";
import path from "path";
import { glob } from "glob";
import { Project } from "ts-morph";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

const MODEL = "gemini-2.5-flash";
// const MODEL = "gemma-3-27b";
const STRUCTURE_FILE = "structure.json";
const PROGRESS_FILE = "progress.json";

const GOOGLE_API_KEYS = process.env.GOOGLE_API_KEYS?.split(",").map(k => k.trim()) || [];
const MAX_REQUESTS_PER_DAY = Number(process.env.DAILY_LIMIT || 200);

if (!GOOGLE_API_KEYS.length) {
  console.error("❌ No GOOGLE_API_KEYS found in .env file");
  process.exit(1);
}

let apiIndex = 0;
let API_KEY = GOOGLE_API_KEYS[apiIndex];

function rotateApiKey() {
  apiIndex++;
  if (apiIndex < GOOGLE_API_KEYS.length) {
    API_KEY = GOOGLE_API_KEYS[apiIndex];
    console.log(`🔄 Switched to API key #${apiIndex + 1}`);
  } else {
    console.log("⏸️ All API keys used up for today.");
    process.exit(0);
  }
}

// Load or initialize progress
let progress = {
  completed: [],
  date: new Date().toISOString().slice(0, 10),
  count: 0,
};

if (await fs.pathExists(PROGRESS_FILE)) {
  progress = await fs.readJson(PROGRESS_FILE);
}

// Reset daily count if new day
const today = new Date().toISOString().slice(0, 10);
if (progress.date !== today) {
  progress.date = today;
  progress.count = 0;
  await fs.writeJson(PROGRESS_FILE, progress, { spaces: 2 });
}

console.log(`📅 Today: ${today}`);
console.log(`📈 Completed files: ${progress.completed.length}`);
console.log(`⚙️  Requests used today: ${progress.count}`);

// Step 1: Find all TypeScript files
const files = await glob("apps/**/*.ts", { ignore: ["node_modules/**"] });
console.log(`🔍 Found ${files.length} files in apps/`);

// Step 2: Parse structure
const project = new Project();
project.addSourceFilesAtPaths(files);

const structure = [];
for (const file of project.getSourceFiles()) {
  structure.push({
    filePath: file.getFilePath(),
    functions: file.getFunctions().map(f => f.getName()),
    classes: file.getClasses().map(c => c.getName()),
    imports: file.getImportDeclarations().map(i => i.getModuleSpecifierValue()),
  });
}

await fs.writeJson(STRUCTURE_FILE, structure, { spaces: 2 });
await fs.ensureDir("docs");

let processed = 0;

for (const f of structure) {
  const filePath = f.filePath;

  // Skip if already completed
  if (progress.completed.includes(filePath)) continue;

  // Stop if daily limit reached
  if (progress.count >= MAX_REQUESTS_PER_DAY) {
    console.log("🛑 Daily request limit reached. Stopping for today.");
    break;
  }

  const code = await fs.readFile(filePath, "utf8");
  const prompt = `
You are a TypeScript expert and technical writer. Read the code below and produce a detailed, easy-to-read explanation.
- Purpose of this file
- Simplify complex logic
- Explain each line of code 

Code:
${code}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    if (response.status === 429) {
      console.warn("⚠️ Rate limit hit, switching API key...");
      rotateApiKey();
      continue;
    }

    const data = await response.json();
    if (!data.candidates?.length) {
      console.warn("⚠️ No output received, skipping file.");
      continue;
    }

    const text = data.candidates[0].content.parts[0].text;

    // Maintain same folder structure under /docs
    const relativePath = path.relative(process.cwd(), filePath);
    const docPath = path.join("docs", relativePath + ".md");
    await fs.ensureDir(path.dirname(docPath));
    await fs.writeFile(docPath, text);

    // Update progress
    progress.completed.push(filePath);
    progress.count += 1;
    processed++;

    console.log(`✅ Documented (${progress.count}/${MAX_REQUESTS_PER_DAY}): ${filePath}`);
    await fs.writeJson(PROGRESS_FILE, progress, { spaces: 2 });

  } catch (err) {
    console.error("❌ Error on:", filePath, err.message);
  }
}

console.log(`🎉 Done! Documented ${processed} files this run.`);
