# Gemini Browser Agent

A Chrome extension that uses Google's Gemini 3 Flash AI to automate browser tasks through natural language commands. Simply describe what you want to do, and the AI agent will navigate, click, type, and interact with web pages on your behalf.

![Version](https://img.shields.io/badge/version-0.1.12-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Chrome](https://img.shields.io/badge/chrome-MV3-orange)

## Features

- **Natural Language Control** - Describe tasks in plain English (or any language)
- **Vision-Based Automation** - AI sees the page through screenshots and understands context
- **Smart Element Detection** - Automatically identifies buttons, links, forms, and interactive elements
- **Computer Use Actions** - Click, type, scroll, drag, and navigate like a human
- **Real-Time Progress** - Watch the agent work with live status updates
- **Markdown Chat** - Rich text formatting with code blocks, lists, and more
- **Dark Theme UI** - Modern, clean interface inspired by Gemini

## How It Works

```
User Input → Gemini AI → Action Plan → Execute on Page → Verify Result
```

1. **You describe a task** - "Search Google for AI news and click the first result"
2. **Gemini analyzes the page** - Takes a screenshot and builds an accessibility tree
3. **AI decides next action** - Click, type, scroll, or navigate
4. **Action executes** - The extension performs the action on the page
5. **Loop continues** - Until the task is complete

## Installation

### From Source (Developer Mode)

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/gemini-browser-agent.git
   cd gemini-browser-agent
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the extension**
   ```bash
   npm run build
   ```

4. **Load in Chrome**
   - Open `chrome://extensions`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Select the `dist` folder

5. **Configure API Key**
   - Click the extension icon
   - Open Settings (gear icon)
   - Enter your OpenRouter API key

## Getting an API Key

This extension uses [OpenRouter](https://openrouter.ai/) to access Gemini 3 Flash.

1. Create an account at [openrouter.ai](https://openrouter.ai/)
2. Add credits to your account
3. Generate an API key
4. Paste it in the extension settings

**Cost**: Approximately $0.01-0.05 per task depending on complexity.

## Usage

### Basic Commands

| Command | What it does |
|---------|--------------|
| "Go to youtube.com" | Navigates to YouTube |
| "Search for cats" | Types "cats" in the search box and submits |
| "Click the login button" | Finds and clicks the login button |
| "Fill out the contact form" | Fills form fields intelligently |
| "Scroll down" | Scrolls the page down |

### Example Tasks

**Web Search**
```
Search Google for "best restaurants in New York" and click the first result
```

**Form Filling**
```
Go to the contact page and fill out the form with name "John Doe" and email "john@example.com"
```

**Navigation**
```
Go to Amazon, search for "wireless headphones", and sort by price low to high
```

## Tech Stack

- **Frontend**: React 18, TypeScript
- **Build**: Vite
- **Extension**: Chrome Manifest V3
- **AI**: Gemini 2.0 Pro via OpenRouter
- **Styling**: CSS with CSS Variables

## Project Structure

```
src/
├── api/
│   └── gemini-client.ts      # Gemini API integration
├── background/
│   ├── service-worker.ts     # Main orchestrator
│   ├── state-manager.ts      # Session management
│   └── ...                   # Other background services
├── content/
│   ├── content-script.ts     # Page interaction
│   ├── action-performer.ts   # Execute actions
│   └── dom-analyzer.ts       # Page analysis
├── popup/
│   ├── components/           # React components
│   └── styles.css            # UI styles
├── shared/
│   ├── types.ts              # TypeScript definitions
│   ├── constants.ts          # Configuration
│   └── utils/                # Helper functions
└── manifest.json             # Extension manifest
```

## Supported Actions

| Action | Description |
|--------|-------------|
| `left_click` | Click at coordinates |
| `right_click` | Right-click at coordinates |
| `double_click` | Double-click at coordinates |
| `middle_click` | Middle-click at coordinates |
| `type` | Type text with human-like delays |
| `key` | Press special keys (Enter, Tab, etc.) |
| `scroll` | Scroll in any direction |
| `drag` | Drag from one point to another |
| `move` | Move cursor to coordinates |
| `screenshot` | Capture current view |
| `wait` | Wait for specified duration |

## Configuration

Settings available in the extension popup:

| Setting | Description | Default |
|---------|-------------|---------|
| API Key | Your OpenRouter API key | Required |
| Show Thinking | Display AI reasoning steps | Off |
| Max Actions | Maximum actions per task | 50 |
| Screenshot Quality | Image quality (0.1-1.0) | 0.8 |

## Development

### Prerequisites

- Node.js 18+
- npm or yarn
- Chrome browser

### Commands

```bash
# Install dependencies
npm install

# Development build with watch
npm run dev

# Production build
npm run build

# Type checking
npm run typecheck

# Linting
npm run lint
```

### Architecture

The extension follows a message-passing architecture:

```
Popup UI ←→ Service Worker ←→ Content Script ←→ Web Page
                ↓
           Gemini API
```

- **Popup UI**: User interface for input and status
- **Service Worker**: Orchestrates the agent loop
- **Content Script**: Executes actions on pages
- **Gemini API**: AI decision making

## Troubleshooting

### Extension not loading
- Make sure you selected the `dist` folder, not the project root
- Check Chrome console for errors: `chrome://extensions` → "Errors"

### Actions not working
- Some sites block automated interactions
- Try refreshing the page
- Check if the element is visible and not in an iframe

### API errors
- Verify your API key is correct
- Check your OpenRouter credit balance
- Ensure you have internet connection

### Debug mode
Open the service worker console to see detailed logs:
1. Go to `chrome://extensions`
2. Find "Gemini Browser Agent"
3. Click "service worker" link

## Security

- API keys are stored locally in Chrome storage
- No data is sent to external servers except OpenRouter
- Screenshots are processed locally and sent only to the AI
- The extension cannot access `chrome://` pages

## Limitations

- Cannot interact with browser chrome (address bar, bookmarks)
- Limited support for complex SPAs with heavy JavaScript
- Some sites may block automated interactions
- Iframes may not be fully accessible

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [Google Gemini](https://deepmind.google/technologies/gemini/) for the AI model
- [OpenRouter](https://openrouter.ai/) for API access
- [Vite](https://vitejs.dev/) for the build system
- [CRXJS](https://crxjs.dev/vite-plugin/) for Chrome extension support

---

**Built with AI, for humans.**
