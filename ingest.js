import fs from 'fs';
import path from 'path';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "text-embedding-004" });

const PDF_DIR = './pdfs';
const STORE = './vector_store.json';

function chunkText(text, size=800, overlap=150){
  const chunks=[];
  let i=0;
  while(i < text.length){
    chunks.push(text.slice(i, i+size));
    i += size - overlap;
  }
  return chunks;
}

async function embed(text){
  const res = await model.embedContent(text);
  return res.embedding.values;
}

async function run(){
  const files = fs.readdirSync(PDF_DIR).filter(f=>f.endsWith('.pdf'));
  if(!files.length){ console.log('Coloque seus PDFs na pasta /pdfs'); return; }
  let allVectors=[];
  if(fs.existsSync(STORE)){
    try{ allVectors = JSON.parse(fs.readFileSync(STORE,'utf-8')); console.log(`Base existente com ${allVectors.length} chunks, adicionando novos...`);}catch{}
  }
  for(const file of files){
    allVectors = allVectors.filter(v => v.file !== file);
    console.log(`Lendo ${file}...`);
    const data = fs.readFileSync(path.join(PDF_DIR,file));
    const parsed = await pdf(data);
    const chunks = chunkText(parsed.text);
    console.log(` -> ${chunks.length} pedaços`);
    for(let idx=0; idx<chunks.length; idx++){
      const c = chunks[idx];
      const vector = await embed(c);
      allVectors.push({file, chunk_id: idx, text: c, vector});
      console.log(`   embedding ${idx+1}/${chunks.length}`);
    }
  }
  fs.writeFileSync(STORE, JSON.stringify(allVectors));
  console.log(`PRONTO! ${allVectors.length} vetores salvos em ${STORE}`);
}
run();
