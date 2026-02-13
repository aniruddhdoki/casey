This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### Interview page (WebRTC + streaming)

The interview flow uses WebRTC for full-duplex audio and a DataChannel for streaming TTS + visemes from the backend.

1. **Start the backend** (from repo root):
   ```bash
   cd backend && npm install && npm run dev
   ```
   Backend runs on **http://localhost:3001** (WebSocket: `ws://localhost:3001/ws`). Set AWS credentials in the backend environment for real STT (Transcribe), LLM (Bedrock), and TTS (Polly); without them you get a viseme test only.

2. **Run the frontend**: `npm run dev` and open [http://localhost:3000/interview](http://localhost:3000/interview).

3. **Test**: Click **Start interview** (allow mic), wait for **Connected**. The backend will stream a short TTS + visemes; when the stream ends, the avatar plays the response and lip-syncs. Use **Download recording** to save the captured mic audio for verification. Check the browser and backend consoles for logs at each layer.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
