import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'al-furqaan-membership-system' });
  });

  // Google Search Grounding endpoint (Gemini 3.8 Flash + googleSearch tool)
  app.post('/api/gemini/grounded-search', async (req: Request, res: Response) => {
    try {
      const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
      const language = req.body?.language === 'om' ? 'om' : 'en';

      if (!query || query.length < 2 || query.length > 500) {
        res.status(400).json({ error: 'Please provide a valid search query (2 to 500 characters).' });
        return;
      }

      const ai = getGenAIClient();
      const systemInstruction =
        language === 'om'
          ? "Ati gargaaraa odeeffannoo Sirna Buusii Miseensaa Al-Furqaan (Chiro, West Hararghe, Oromia, Ethiopia) ti. Deebii kee Afaan Oromoo qulqulluu fi ifa ta'een qopheessi; yoo barbaachise jechoota maallaqaa/baankii Itoophiyaa ifa godhi. Odeeffannoo haaraa Google Search irratti hundaa'e fayyadami."
          : 'You are an information assistant for Al-Furqaan Qur’an Memorization Center (Chiro, West Hararghe, Oromia, Ethiopia). Provide concise, accurate answers grounded in Google Search results, tailored to Ethiopian community/NGO operations, banking (CBE, Telebirr, Coop Bank, Awash), or general center administration.';

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: query,
        config: {
          systemInstruction,
          tools: [{ googleSearch: {} }],
        },
      });

      const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
      const rawChunks = groundingMetadata?.groundingChunks || [];
      const sources = rawChunks
        .map((chunk) => ({
          title: chunk.web?.title || chunk.web?.uri || 'Source',
          uri: chunk.web?.uri || '',
        }))
        .filter((s) => Boolean(s.uri));

      const uniqueSources = Array.from(
        new Map(sources.map((item) => [item.uri, item])).values()
      );

      res.json({
        text: response.text || '',
        sources: uniqueSources,
        queries: groundingMetadata?.webSearchQueries || [],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Grounded search failed.';
      console.error('Grounded search error:', message);
      res.status(500).json({ error: message });
    }
  });

  // Bilingual Member Message / Receipt / Reminder Generator
  app.post('/api/gemini/generate-message', async (req: Request, res: Response) => {
    try {
      const type = req.body?.type || 'receipt';
      const memberName = typeof req.body?.memberName === 'string' ? req.body.memberName.trim() : 'Member';
      const amount = Number(req.body?.amount) || 0;
      const currency = req.body?.currency === 'USD' ? 'USD' : 'ETB';
      const month = typeof req.body?.month === 'string' ? req.body.month.trim() : '';
      const receiptNumber = typeof req.body?.receiptNumber === 'string' ? req.body.receiptNumber.trim() : '';
      const language = req.body?.language === 'om' ? 'om' : 'en';
      const customContext = typeof req.body?.customContext === 'string' ? req.body.customContext.trim() : '';

      const ai = getGenAIClient();
      const prompt = [
        `Center: Al-Furqaan Qur'an Memorization Center (Chiro, West Hararghe, Oromia, Ethiopia).`,
        `Message type: ${type}`,
        `Language: ${language === 'om' ? 'Afaan Oromoo (with respectful Islamic greeting)' : 'English (with respectful Islamic greeting)'}`,
        `Recipient name: ${memberName}`,
        amount > 0 ? `Amount: ${amount} ${currency}` : '',
        month ? `Contribution month: ${month}` : '',
        receiptNumber ? `Receipt number: ${receiptNumber}` : '',
        customContext ? `Extra context: ${customContext}` : '',
        `Return JSON with two keys: "subject" (concise email/notification subject) and "body" (warm, professional, plain text message body ending with "BarakAllahu Feekum - Al-Furqaan Qur'an Memorization Center, Chiro").`,
      ]
        .filter(Boolean)
        .join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      const rawText = response.text || '{}';
      let parsed: { subject?: string; body?: string } = {};
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = {
          subject: `Al-Furqaan Center — ${type === 'reminder' ? 'Monthly Buusii Reminder' : 'Contribution Update'}`,
          body: rawText,
        };
      }

      res.json({
        subject: parsed.subject || 'Al-Furqaan Qur’an Memorization Center',
        body: parsed.body || rawText,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Message generation failed.';
      console.error('Message generation error:', message);
      res.status(500).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Al-Furqaan Membership server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
