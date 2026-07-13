<div align="center">

# 🔍 TruthLens

**Paste a claim. Get a verdict.**

TruthLens is a full-stack proof-of-concept for real-time news verification. It checks live news coverage and a local ML classifier to determine whether a claim is **supported**, **disputed**, or **mixed** — with a confidence score and source breakdown.

[![Frontend](https://img.shields.io/badge/Frontend-React%20%2B%20Vite-646cff?style=flat-square&logo=vite)](https://vitejs.dev)
[![Backend](https://img.shields.io/badge/Backend-Python%20%2B%20Flask-3b7bbf?style=flat-square&logo=flask)](https://flask.palletsprojects.com)
[![ML](https://img.shields.io/badge/ML-scikit--learn-f89939?style=flat-square&logo=scikit-learn)](https://scikit-learn.org)
[![Deploy](https://img.shields.io/badge/Deploy-Vercel%20%2B%20Render-00c7b7?style=flat-square)](https://render.com)

</div>

---

## What It Does

TruthLens combines a modern frontend with an intelligent backend pipeline:

- 📥 Accepts user claims through a clean React interface
- 🔎 Generates optimized search queries from the claim text
- 📡 Fetches live news results from **Google News RSS**
- ⚖️ Weighs evidence from trusted sources to assess stance
- 📊 Returns a **verdict**, **confidence score**, and **evidence breakdown**
- 🤖 Falls back to a local **ML classifier** when live data is limited

---

## Why It Matters

This project demonstrates production-aware full-stack thinking:

| Aspect | Detail |
|---|---|
| **Architecture** | Clean frontend ↔ backend separation via REST API |
| **Data** | Combines live external news with an offline ML model |
| **UX** | User-friendly verdict visualization with source summaries |
| **Deployment** | Ready for cloud deployment with separate frontend/backend services |

---

## Project Structure

```
TruthLens/
├── frontend/               # React + Vite app
│   ├── src/
│   │   └── App.jsx         # Main component — claim input & verdict display
│   ├── public/             # Static assets
│   ├── package.json        # Frontend dependencies
│   └── vite.config.js      # Vite configuration
│
└── backend/                # Flask API service
    ├── app.py              # API implementation — search, score, respond
    ├── requirements.txt    # Python dependencies
    └── model/              # Saved ML model + vectorizer (.pkl files)
```

---

## Tech Stack

**Frontend**
- [React](https://react.dev) — UI library
- [Vite](https://vitejs.dev) — build tool and dev server
- [Axios](https://axios-http.com) — HTTP client for API calls
- [Lucide React](https://lucide.dev) — icon set

**Backend**
- [Python](https://www.python.org) + [Flask](https://flask.palletsprojects.com) — API server
- [Flask-CORS](https://flask-cors.readthedocs.io) — cross-origin request handling
- [scikit-learn](https://scikit-learn.org) — ML model persistence and inference
- Google News RSS — live news data source

**Deployment**
- [Vercel](https://vercel.com) — frontend hosting
- [Render](https://render.com) — backend hosting

---

## Run Locally

### 1. Backend

```powershell
cd backend

# Create and activate virtual environment
python -m venv venv
.\venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start the Flask server


```

The API will be available at `http://localhost:5000`.

### 2. Frontend

```powershell
cd frontend

# Install dependencies
npm install

# Start the dev server
npm run dev
```

### 3. Environment Variables

Create a `.env` file in the `frontend/` directory:

```env
VITE_API_URL=http://localhost:5000
```

---

## Deployment

**Frontend → Vercel**
1. Connect the `frontend/` folder to a Vercel project.
2. Set the environment variable `VITE_API_URL` to your deployed Render backend URL.

**Backend → Render**
1. Connect the `backend/` folder to a Render web service.
2. Render will automatically detect the Python environment and install dependencies from `requirements.txt`.

---

## Resume-Friendly Highlights

- ✅ **End-to-end full-stack** — React frontend, Flask backend, and a trained ML model working together seamlessly
- ✅ **Real-time data** — live news verification via Google News RSS with source trust weighting
- ✅ **ML integration** — scikit-learn classifier as a reliable offline fallback
- ✅ **Deployment-ready** — configured for Vercel and Render with proper environment variable handling
- ✅ **Clean separation of concerns** — well-defined API boundaries between frontend and backend

```
backend/
frontend/
extension/
README.md
```

## ▶️ Run Project

### Backend

```bash
cd backend
pip install -r requirements.txt
python app.py
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## 👨‍💻 Author

**MD Firdaus Alam**

GitHub: https://github.com/MDFIRDAUS1
