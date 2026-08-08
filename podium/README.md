# Podium Presentation Application

A desktop presentation application built with **React 18**, **Vite**, and **Electron**.

---

## 🚀 How to Run

When anyone clones this repository, they can run the Podium app by following these steps:

### 1. Navigate to the `podium` directory
```bash
cd podium
```

### 2. Install dependencies
```bash
npm install
```
> *This will install React, Vite, and download the Electron pre-built binary automatically.*

### 3. Configure the main-panel auth URL
Create a `.env` file next to `package.json` and set:
```bash
VITE_MAIN_PANEL_URL="http://localhost:3000"
```
Point this at the running main-panel server in development or production.

### 4. Start the application (Dev Mode)
```bash
npm run dev
```
> *This will launch the Vite development server on `http://localhost:5173` and open the Electron app window with hot-reload (HMR) enabled.*

---

## 📦 Building for Production

To create the production Web build:
```bash
npm run build
```

To run the built app in Electron:
```bash
npm start
```
