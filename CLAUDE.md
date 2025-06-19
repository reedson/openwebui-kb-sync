# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Obsidian plugin that syncs markdown files tagged with `#kb/knowledge-base-name` to OpenWebUI Knowledge Base. The plugin supports:

- Automatic knowledge base creation in OpenWebUI
- Multiple KB tags per file (sync one file to multiple knowledge bases)
- Smart sync with state tracking (automatically removes files when tags are removed)
- Auto-sync with configurable intervals (supports 1-minute intervals)
- Debug mode with detailed console logging
- Obsidian Index feature for creating a searchable index

## Development Commands

### Essential Commands
- `make setup` - Complete first-time setup (install + build)
- `make build` - Production build with TypeScript check
- `make dev` - Development mode with watch (auto-rebuild on changes)
- `make typecheck` - Run TypeScript type checking
- `make deploy-dev` - Build and deploy to development vault
- `make deploy-prod` - Build and deploy to production vault
- `make quick` - Quick build and deploy to development vault

### Package.json Scripts
- `npm run build` - TypeScript check + esbuild production build
- `npm run dev` - esbuild watch mode for development
- `npm run version` - Bump version and update manifest

### Testing
- No formal test framework configured
- Manual testing by deploying to Obsidian vault

## Build System

- **TypeScript**: Source code in `main.ts` compiled to `main.js`
- **esbuild**: Fast bundler for development and production builds
- **Target**: ES2018 with CommonJS output for Obsidian compatibility
- **External dependencies**: Obsidian API, CodeMirror modules, built-in Node modules

The build process:
1. TypeScript type checking (`tsc --noEmit --skipLibCheck`)
2. esbuild bundling with external Obsidian dependencies
3. Output: `main.js` (bundled plugin code)

## Key Architecture

### Plugin Structure
- **main.ts**: Single-file plugin implementation
- **OpenWebUIKBSyncSettings**: Configuration interface with enhanced file tracking
- **State Management**: Tracks file-to-KB mappings and OpenWebUI file records
- **API Integration**: Uses Obsidian's `requestUrl` for OpenWebUI API calls

### Core Features
1. **Tag Processing**: Scans files for `#kb/knowledge-base-name` tags
2. **Knowledge Base Management**: Auto-creates KBs in OpenWebUI
3. **File Synchronization**: Uploads files with content hash tracking
4. **State Tracking**: Maintains mapping of files to knowledge bases
5. **Auto-sync**: Configurable periodic synchronization

### File Mapping System
- `syncState`: Tracks which files are synced to which knowledge bases
- `fileMapping`: Enhanced tracking with OpenWebUI file IDs, content hashes, and modification times
- Supports multiple knowledge bases per file
- Automatically cleans up when tags are removed

## Configuration

Plugin settings are managed through Obsidian's settings interface:
- OpenWebUI URL and API token
- Auto-sync settings (enabled/disabled, interval)
- Debug mode toggle
- Obsidian Index feature configuration

## Deployment

### Development Vault
- Location: `~/.obsidian/plugins/openwebui-kb-sync`
- Use `make deploy-dev` or `make quick`

### Production Vault  
- Location: `/home/nic/Documents/Notes\ Vault/.obsidian/plugins/openwebui-kb-sync`
- Use `make deploy-prod` or `make quick-prod`

Plugin files required for deployment:
- `main.js` (compiled plugin code)
- `manifest.json` (plugin metadata)
- `styles.css` (plugin styles)

## Obsidian Plugin Standards

- Extends Obsidian's `Plugin` class
- Uses `PluginSettingTab` for configuration UI
- Integrates with Obsidian's file system via `TFile`
- Follows Obsidian's notice system for user feedback
- Implements proper lifecycle methods (`onload`, `onunload`)

## OpenWebUI API Integration

The plugin interacts with OpenWebUI's REST API for:
- Knowledge base creation and management
- File upload and management within knowledge bases
- Authentication via API token
- Error handling and connection testing

### API Authentication
- **Method**: Bearer Token authentication
- **Token Source**: Settings > Account in OpenWebUI
- **Header Format**: `Authorization: Bearer YOUR_API_KEY`
- **Alternative**: JWT (JSON Web Token) authentication

### Key API Endpoints Used by Plugin

#### File Upload for Knowledge Base
- **Endpoint**: `POST /api/v1/files/`
- **Purpose**: Upload files to OpenWebUI for knowledge base integration
- **Usage**: Plugin uploads Obsidian markdown files with extracted content
- **Response**: Returns file ID for knowledge base association

#### Knowledge Base Management
- **Add File to Knowledge Base**: `POST /api/v1/knowledge/{id}/file/add`
- **Purpose**: Associate uploaded files with specific knowledge bases
- **Payload**: `{"file_id": "file-id-from-upload"}`

#### Chat Completions with Knowledge Base
- **Endpoint**: `POST /api/chat/completions`
- **Purpose**: Query models with knowledge base context
- **File Reference**: `"files": [{"type": "file", "id": "file-id"}]`
- **Collection Reference**: `"files": [{"type": "collection", "id": "collection-id"}]`

### API Integration Examples

**File Upload (Python)**:
```python
import requests

def upload_file(token, file_path):
    url = 'http://localhost:3000/api/v1/files/'
    headers = {
        'Authorization': f'Bearer {token}',
        'Accept': 'application/json'
    }
    files = {'file': open(file_path, 'rb')}
    response = requests.post(url, headers=headers, files=files)
    return response.json()
```

**Add to Knowledge Base (Python)**:
```python
def add_file_to_knowledge(token, knowledge_id, file_id):
    url = f'http://localhost:3000/api/v1/knowledge/{knowledge_id}/file/add'
    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json'
    }
    data = {'file_id': file_id}
    response = requests.post(url, headers=headers, json=data)
    return response.json()
```

**Chat with Knowledge Base (Python)**:
```python
def chat_with_collection(token, model, query, collection_id):
    url = 'http://localhost:3000/api/chat/completions'
    headers = {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json'
    }
    payload = {
        'model': model,
        'messages': [{'role': 'user', 'content': query}],
        'files': [{'type': 'collection', 'id': collection_id}]
    }
    response = requests.post(url, headers=headers, json=payload)
    return response.json()
```

### Additional OpenWebUI API Capabilities

#### Model Management
- **List Models**: `GET /api/models`
- **Purpose**: Retrieve all available models in OpenWebUI

#### Ollama API Proxy
- **Base URL**: `/ollama/<api>`
- **Generate Completion**: `POST /ollama/api/generate`
- **List Models**: `GET /ollama/api/tags`
- **Generate Embeddings**: `POST /ollama/api/embed`

#### Retrieval Augmented Generation (RAG)
- Upload files to vector database
- Group files into knowledge collections
- Reference files/collections in chat completions
- Enhanced responses with external knowledge

### API Error Handling
- Connection testing before operations
- Proper HTTP status code handling
- Token validation and refresh
- Network timeout management
- Graceful degradation when API unavailable

## Obsidian Plugin Best Practices

### General Guidelines
- **Use plugin app instance**: Always use `this.app` instead of global `app` object
- **Avoid unnecessary console logging**: Only log errors in production; debug messages should not appear in default console
- **Organize code with folders**: Use folders to organize multiple `.ts` files for better maintainability
- **Rename placeholder classes**: Replace `MyPlugin`, `MyPluginSettings` with meaningful names

### Mobile Compatibility
- **Avoid Node.js/Electron APIs**: These aren't available on mobile and will cause crashes
- **Regex lookbehind**: Not supported on iOS < 16.4; implement fallbacks or use platform detection

### UI Text Guidelines
- **Use sentence case**: "Template folder location" not "Template Folder Location"
- **Avoid "settings" in headings**: Use "Advanced" not "Advanced settings"
- **Use `.setHeading()`**: Instead of HTML heading elements for consistent styling
- **General settings at top**: Don't add top-level headings like "General" or plugin name

### Security
- **Avoid innerHTML/outerHTML**: Use DOM API or Obsidian helpers (`createEl()`, `createDiv()`, `createSpan()`)
- **Clean HTML with `el.empty()`**: Use this instead of setting innerHTML to empty

### Resource Management
- **Clean up on unload**: Remove event listeners and resources in `onunload()`
- **Don't detach leaves**: Avoid detaching leaves in `onunload()` to preserve user layout

### Commands
- **No default hotkeys**: Avoid setting default hotkeys to prevent conflicts
- **Use appropriate callbacks**: 
  - `callback` for unconditional commands
  - `checkCallback` for conditional commands
  - `editorCallback` for editor-specific commands

### Workspace Best Practices
- **Use `getActiveViewOfType()`**: Instead of accessing `workspace.activeLeaf` directly
- **Use `activeEditor`**: For accessing editor in active note
- **Don't manage view references**: Use `getActiveLeavesOfType()` to access custom views

### Vault Operations
- **Use Editor API**: For active file modifications instead of `Vault.modify()`
- **Use `Vault.process()`**: For background file modifications (atomic operations)
- **Use `FileManager.processFrontMatter()`**: For frontmatter modifications
- **Prefer Vault API**: Over Adapter API for performance and safety
- **Use specific getters**: `getFileByPath()` instead of iterating all files
- **Use `normalizePath()`**: Clean up user-defined paths for cross-platform compatibility

### Editor Extensions
- **Manage extensions properly**: Keep same array reference, use `updateOptions()` to flush changes

### Styling
- **No hardcoded styles**: Use CSS classes instead of inline styles
- **Use CSS variables**: Leverage Obsidian's CSS variables for consistency
- **Theme compatibility**: Ensure styles work with themes and snippets

### TypeScript Best Practices
- **Use `const`/`let`**: Avoid `var` declarations
- **Prefer async/await**: Over Promise chains for better readability

### Code Examples

**Proper view access:**
```ts
const view = this.app.workspace.getActiveViewOfType(MarkdownView);
if (view) {
  // Safe to use view
}
```

**Proper file access:**
```ts
const file = this.app.vault.getFileByPath(normalizePath(filePath));
```

**Proper DOM creation:**
```ts
const el = containerEl.createDiv({cls: 'my-plugin-container'});
// In CSS: .my-plugin-container { color: var(--text-normal); }
```