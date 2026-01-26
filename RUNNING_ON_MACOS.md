# Running Tesla Dashcam Viewer on macOS with IntelliJ

This guide explains how to set up and run the Tesla Dashcam Viewer web application on macOS using IntelliJ IDEA.

## Prerequisites

1. **Node.js** (version 18 or higher)
   - Install via Homebrew: `brew install node`
   - Or download from [nodejs.org](https://nodejs.org/)

2. **IntelliJ IDEA** (Ultimate or Community Edition)
   - Download from [jetbrains.com](https://www.jetbrains.com/idea/download/)

3. **PostgreSQL** (optional, for database features)
   - Install via Homebrew: `brew install postgresql@15`
   - Start the service: `brew services start postgresql@15`

## Setup Instructions

### 1. Clone or Download the Project

If you have the project as a ZIP file, extract it to your desired location.

If cloning from a repository:
```bash
git clone <repository-url>
cd tesla-dashcam-viewer
```

### 2. Open Project in IntelliJ

1. Open IntelliJ IDEA
2. Select **File → Open**
3. Navigate to the project folder and click **Open**
4. IntelliJ will detect it as a Node.js project

### 3. Install Dependencies

Open the Terminal within IntelliJ (View → Tool Windows → Terminal) and run:

```bash
npm install
```

### 4. Configure Environment Variables

Create a `.env` file in the project root:

```bash
touch .env
```

Add the following content (adjust DATABASE_URL if using PostgreSQL):

```
DATABASE_URL=postgresql://localhost:5432/dashcam
SESSION_SECRET=your-secret-key-here
```

If not using a database, the app will still work for video viewing features.

### 5. Set Up Run Configuration

1. Go to **Run → Edit Configurations**
2. Click the **+** button and select **npm**
3. Configure as follows:
   - **Name:** Dev Server
   - **Command:** run
   - **Scripts:** dev
   - **Node interpreter:** Your Node.js installation
   - **Package manager:** npm
4. Click **Apply** and **OK**

### 6. Run the Application

1. Select **Dev Server** from the run configuration dropdown
2. Click the green **Run** button (or press Ctrl+R)
3. Wait for the server to start (you'll see output in the Run window)
4. Open your browser to **http://localhost:5000**

## Alternative: Running from Terminal

You can also run directly from the IntelliJ terminal:

```bash
npm run dev
```

## Using the Application

1. Open **http://localhost:5000** in Chrome, Edge, or Firefox
2. Drag and drop Tesla dashcam MP4 files onto the drop zone
3. The app will detect camera angles from filenames (front, left, right, rear)
4. Click **Load Videos** to start synchronized playback
5. Use the **Export** button to merge cameras into a single video with telemetry

## Browser Requirements

The video export feature requires WebCodecs API support:
- **Chrome** 94+ (recommended)
- **Edge** 94+
- **Firefox** 130+
- Safari is **not supported** for video export

## Troubleshooting

### Port Already in Use
If port 5000 is busy, modify `server/index.ts` to use a different port.

### Node.js Version Issues
Ensure you're using Node.js 18 or higher:
```bash
node --version
```

### Database Connection Errors
If you see database errors but don't need database features, the video viewer will still function. The app gracefully handles missing database connections.

### Video Not Playing
- Ensure you're using a supported browser (Chrome/Edge/Firefox)
- Check that the MP4 files are valid Tesla dashcam recordings
- Look for error messages in the browser console (View → Developer → JavaScript Console)
