import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import pino from 'pino';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embedModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
const chatModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const STORE = './vector_store.json';
let vectorStore = [];
if(fs.existsSync(STORE)){
  vectorStore = JSON.parse(fs.readFileSync(STORE,'utf-8'));
  console.log(`Base carregada com ${vectorStore.length} chunks`);
}

function cosine(a,b){
  let dot=0, na=0, nb=0;
  for(let i=0;i<a.length;i++){ dot+=a[i]*b[i]; na+=a[i]*a[i]; nb+=b[i]*b[i]; }
  return dot / (Math.sqrt(na)*Math.sqrt(nb) + 1e-9);
}

async function search(query, k=4){
  const {embedding} = await embedModel.embedContent(query);
  const qVec = embedding.values;
  const scored = vectorStore.map(v=>({ ...v, score: cosine(qVec, v.vector)}))
    .sort((a,b)=>b.score-a.score).slice(0,k);
  return scored;
}

async function answerWithRAG(question){
  if(!vectorStore.length) return "Base ainda vazia. Rode npm run ingest primeiro.";
  const top = await search(question);
  const contexto = top.map(t=>t.text).join("\n---\n");
  
  const prompt = `Você é o Cre-Cre, assistente técnico especialista. Responda APENAS com base no CONTEXTO abaixo.
Se a resposta não estiver no contexto, diga: "Não encontrei essa informação na base técnica."
NUNCA mencione que existe um PDF, nunca cite arquivo, página ou documento.

CONTEXTO:
${contexto}

PERGUNTA: ${question}

RESPOSTA objetiva em português brasileiro:`;

  const result = await chatModel.generateContent(prompt);
  const raw = result.response.text();
  return `🤖 *Cre-Cre aqui!* 🤖\n\n${raw}`;
}

async function startBot(){
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if(qr){ console.log('Escaneie este QR Code no WhatsApp:'); qrcode.generate(qr, {small:true}); }
    if(connection === 'close'){
      const shouldReconnect = (lastDisconnect?.error).output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Conexão fechada, reconectando:', shouldReconnect);
      if(shouldReconnect) startBot();
    } else if(connection === 'open'){
      console.log('BOT CONECTADO! ✅');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for(const msg of messages){
      if(!msg.message || msg.key.fromMe) continue;
      const from = msg.key.remoteJid;
      
      if(process.env.GROUP_ID && from !== process.env.GROUP_ID){
        console.log(`Ignorado - fora do grupo: ${from}`);
        continue;
      }

      const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
      if(!text) continue;
      if(!text.toLowerCase().includes('bot')) continue;

      console.log(`Pergunta: ${text}`);
      try{
        await sock.sendPresenceUpdate('composing', from);
        const resposta = await answerWithRAG(text);
        await sock.sendMessage(from, { text: resposta }, { quoted: msg });
      }catch(e){
        console.error(e);
        await sock.sendMessage(from, { text: 'Deu um erro aqui, tenta de novo em 10s.' }, { quoted: msg });
      }
    }
  });
}

startBot();
