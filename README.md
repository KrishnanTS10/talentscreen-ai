# 🎯 TalentScreen AI

> An AI-powered recruitment productivity suite built for volume hiring teams.

![Beta](https://img.shields.io/badge/Status-Beta-green)
![HR Tech](https://img.shields.io/badge/Category-HR%20Tech-brightgreen)
![Built with Claude](https://img.shields.io/badge/Powered%20by-Claude%20AI-blueviolet)

---

## 🚀 Live Demo

👉 **[Launch TalentScreen AI](https://KrishnanTS10.github.io/talentscreen-ai)**

**Beta Access Code:** `TALENT2026`

---

## 📖 About

TalentScreen AI is a prototype recruitment toolkit I built from scratch as an HR professional with no engineering background. It demonstrates how domain expertise combined with AI can solve real problems in volume hiring.

Built to address three of the most painful bottlenecks in high-volume recruitment:

| Problem | Solution |
|---|---|
| Screening 200+ CVs manually | AI Bulk CV Screener — ranks 10 CVs in seconds |
| Inconsistent interview questions | Interview Question Generator — role & seniority-specific |
| No pipeline visibility | 10-stage Candidate Pipeline with live metrics |

---

## 🛠️ Features

### 1. Bulk CV Screener
- Upload up to 10 CVs (PDF, DOCX, TXT)
- Upload or paste any Job Description
- AI scores each candidate 0–100
- Returns matched skills, missing skills, verdict and plain-English summary
- Results ranked by fit score

### 2. Interview Question Generator
- Select any HR role (Recruiter → CHRO)
- Choose seniority level (Junior → Leadership)
- Toggle question types: Behavioural, Situational, Technical
- Paste a JD for laser-targeted questions
- Generate 5–20 questions with interviewer guidance
- One-click copy all

### 3. Candidate Pipeline Dashboard
- 10 hiring stages: Applied → Screening → Shortlisted → Interview R1/R2/R3 → BG Check → Offer → Joining → Hired
- Live metrics: conversion rate, offer acceptance, shortlist count
- Privacy mode — masks candidate names and notes (GDPR-aware)
- Collapsible candidate list
- CSV export

### 4. Access Control
- Beta invite code system
- 24-hour session management
- Automatic redirect to login on session expiry

---

## 🔐 Access Control

This app uses a simple invite code system for beta access control:

- Users enter a beta code on the login page
- Valid sessions are stored securely in localStorage for 24 hours
- Session expires automatically — users are redirected to login
- Admin can update the code in `auth.js`

To change the beta code, open `auth.js` and update:
```javascript
BETA_CODE: 'YOUR_NEW_CODE'
```

---

## ⚙️ Setup

### 1. Clone this repository
```bash
git clone https://github.com/KrishnanTS10/talentscreen-ai.git
```

### 2. Get an Anthropic API key
- Sign up at [console.anthropic.com](https://console.anthropic.com)
- Create an API key
- On the login page, click "Setup API key (admin only)" and enter your key
- The key is stored in your browser's localStorage

### 3. Deploy to GitHub Pages
- Go to your repository Settings
- Click Pages (in the left sidebar)
- Set Source to `Deploy from a branch`
- Select `main` branch, `/ (root)` folder
- Click Save
- Your app will be live at `https://yourusername.github.io/talentscreen-ai`

---

## 📁 File Structure

```
talentscreen-ai/
├── index.html      ← Login page with beta access control
├── app.html        ← Main 3-tool application
├── styles.css      ← Shared design system
├── auth.js         ← Session management & access control
├── app.js          ← All tool logic (screener, questions, pipeline)
└── README.md       ← This file
```

---

## 🧠 Built With

- **HTML / CSS / JavaScript** — No framework, fully vanilla
- **Claude AI (Anthropic)** — Powers CV analysis and question generation
- **PDF.js** — Client-side PDF text extraction
- **Mammoth.js** — DOCX text extraction
- **GitHub Pages** — Free hosting

---

## 👤 About the Builder

Built by an HR professional with 20+ years of experience in Talent Acquisition and Volume Hiring — no engineering background.

This project demonstrates that domain expertise + the right AI tools = real, usable products.

**LinkedIn:** [Connect with me](https://linkedin.com/in/krishnants)

---

## 📜 Disclaimer

This is a prototype built for portfolio and beta testing purposes. It is not a production SaaS product. Candidate data is processed client-side and is not stored on any server.

---

*TalentScreen AI · Beta v1.0 · Built for volume hiring*
