# Private Chat (React + Firebase + Vercel)

This is a simple **private 1:1 chat** website:

- Email/password login (Firebase Auth)
- Real-time messages (Firestore)
- Each conversation is private (Firestore Security Rules)
- Works on **Vercel free** (no server needed)

## What you need (Firebase)

### 1) Create a Firebase project
- Go to Firebase Console and create a project.

### 2) Enable Email/Password login
- In **Authentication → Sign-in method**
- Enable **Email/Password**

### 3) Create a Firestore database
- In **Firestore Database**
- Create database (start in **production mode**)

### 4) Create a Web App and copy config
- In **Project settings → Your apps → Web app**
- Copy the config values into `.env` (see below).

## Local setup

### 1) Create `.env`
Copy `.env.example` to `.env` and fill in values:

```bash
cp .env.example .env
```

### 2) Install and run

```bash
npm install
npm run dev
```

Open the shown local URL.

## Firestore data model (collections)

### `users/{uid}`
Created at signup.

```js
{
  uid: "abc",
  email: "you@example.com",
  createdAt: <server timestamp>
}
```

### `userEmails/{emailLower}`
Email lookup doc, used to start a chat by email **without listing all users**.

Document ID is the lowercased email.

```js
{
  uid: "abc",
  email: "you@example.com",
  createdAt: <server timestamp>
}
```

### `conversations/{conversationId}`
Conversation id is deterministic: `uid1__uid2` (uids sorted).

```js
{
  members: ["uidA","uidB"],
  memberEmails: { "uidA": "a@x.com", "uidB": "b@x.com" },
  createdAt: <server timestamp>,
  updatedAt: <server timestamp>,
  lastMessage: "preview..."
}
```

### `conversations/{conversationId}/messages/{messageId}`

```js
{
  text: "hello",
  senderId: "uidA",
  createdAt: <server timestamp>
}
```

## Firestore Security Rules (privacy)

Copy/paste `firestore.rules` into:

- **Firestore Database → Rules**

These rules ensure:
- only you can read/write your own `users/{uid}`
- `userEmails/*` is **get-only** (no list), so nobody can dump all emails
- only conversation members can read/write a conversation
- only members can read messages; the sender can create text or base64 image messages (see `firestore.rules`)

## Images (base64 in Firestore — no Firebase Storage)

Photos are **compressed in the browser** to JPEG, then stored as a **data URL** (`data:image/jpeg;base64,...`) in the message field `dataUrl`. You do **not** need to enable **Firebase Storage** for chat images.

**Limit:** a Firestore document must stay under **~1 MiB**. The app targets **~750k characters** for the data URL after compression. Very large originals are resized and recompressed so sends stay under that cap.

**Video:** is not stored in Firestore (would exceed the size limit). Older chats may still show `type: 'video'` + `mediaUrl` if you used Storage before.

### Message document shapes (Firestore)

**Text**

```js
{ type: 'text', text: 'hello', senderId, createdAt }
```

**Image (current)**

```js
{ type: 'image', dataUrl: 'data:image/jpeg;base64,...', text?: 'optional caption', senderId, createdAt }
```

**Legacy:** `{ text, senderId, createdAt }` or old `{ type: 'image'|'video', mediaUrl: 'https://...' }` from Storage still **display** if present in the database.

## Important: Firestore composite index (required)

The chat list runs this query:

- Collection: `conversations`
- Filter: `members` **array-contains** your user id
- Order: `updatedAt` **descending**

That combination needs a **composite index**. Without it, the listener fails with `failed-precondition: The query requires an index`, and **your chats / partner email will not show**.

### Option A — Use the link from the error (fastest)

1. Open DevTools → **Console** on your app.
2. Find the line: `The query requires an index. You can create it here: https://...`
3. **Open that URL** → Firebase Console → **Create index**.
4. Wait until the index **Status** is **Enabled** (can take a few minutes).
5. Refresh your app.

### Option B — Deploy indexes from this repo (Firebase CLI)

This repo includes `firestore.indexes.json` and `firebase.json`.

```bash
npm install -g firebase-tools
firebase login
firebase use <your-project-id>
firebase deploy --only firestore:indexes
```

Then wait for the index to finish building in **Firestore → Indexes**.

## Deploy to Vercel (free)

### 1) Push to GitHub
Create a GitHub repo and push this project.

### 2) Import to Vercel
- Vercel → New Project → Import the repo

### 3) Add Environment Variables in Vercel
In **Project → Settings → Environment Variables**, add:
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

### 4) Build settings
- Framework preset: **Vite**
- Build command: `npm run build`
- Output directory: `dist`

### 5) Firebase Auth authorized domains
In Firebase Console:
- **Authentication → Settings → Authorized domains**
- Add your Vercel domain (e.g. `your-app.vercel.app`)

# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
