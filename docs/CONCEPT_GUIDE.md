# GigaFlair SIP2 Bridge: The "Library Translator" Guide

Imagine you have two friends: one speaks only **Old Library Language** (SIP2), and the other speaks only **Modern App Language** (JSON). They need to talk to each other to check if a student can borrow a book, but they don't understand each other.

The **GigaFlair SIP2 Bridge** is the "Professional Translator" that sits in the middle.

## 1. What is SIP2? (The Old Language)
SIP2 is a very old way for library computers (LMS) to talk to things like self-checkout kiosks. It looks like a giant string of numbers and letters that is hard for humans to read.
- **Example**: `2300120260221    161256AO...`

## 2. What is JSON? (The Modern Language)
JSON is how almost every modern website and mobile app talks today. It is organized into "key-value" pairs that are very easy to read.
- **Example**: `{ "patronBarcode": "12345" }`

## 3. How the Bridge Works
When you ask the Bridge a question in JSON, it does three things:
1. **Translates**: It turns your nice JSON into the weird SIP2 string.
2. **Talks**: It sends that string to the library computer over a private connection.
3. **Translates Back**: It takes the weird SIP2 reply, turns it back into JSON, and hands it to you.

---

## 4. The Safety Features ("The Guardian")

### The API Key (X-API-KEY)
Think of this as a **VIP Badge**. Every time you ask the Bridge a question, you must show your badge in the header of your request. If you don't have it, the Bridge won't even wake up the library computer.

### The Circuit Breaker (The Safety Switch)
If the library computer gets tired or broken and starts acting weird, the Bridge will **"Trip the Circuit"** (like a fuse in your house).
- **Closed**: Everything is healthy!
- **Open**: The library computer is broken. The Bridge stops trying to talk to it for a few minutes to let it recover.

### The ASCII Guard (Legacy Protection)
Old library computers can get "confused" by modern characters (like emojis or special accents). The Bridge **scrubs** these away automatically so the old computers don't crash.

---

## Example Command
You can talk to the bridge using a tool called `curl`:

```bash
curl -X POST http://localhost:3100/api/v1/patron/status \
     -H "x-api-key: YOUR_SECRET_KEY" \
     -H "Content-Type: application/json" \
     -d '{"patronBarcode": "987654321"}'
```

The Bridge handles the rest!
