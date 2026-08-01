# Falcon News secure backend

## Add keys

1. Open `server/.env` in Notepad.
2. Paste new provider keys after the three `=` signs.
3. Save. Do not share or upload `.env`.

## Start locally

```powershell
cd C:\Users\HP\Desktop\FalconNews\server
npm install
npm run dev
```

Open `http://localhost:3000/health` to confirm it is working.

## Connect the app

Set `EXPO_PUBLIC_CALENDAR_API_URL`, `EXPO_PUBLIC_SENTIMENT_API_URL`, and `EXPO_PUBLIC_BREAKING_NEWS_API_URL` in the mobile app to deployed HTTPS endpoints. A phone cannot use `localhost` on your Windows computer, so deploy this backend or use a secure development tunnel before testing it on a phone.
