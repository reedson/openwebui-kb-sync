# OpenWebUI KB Sync Plugin

This plugin allows you to sync Obsidian notes to OpenWebUI Knowledge Base by adding `#kb/knowledge-base-name` tags to your markdown files.

## Installation

1. Copy all files to your vault's plugin directory:
   ```
   your-vault/.obsidian/plugins/openwebui-kb-sync/
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the plugin:
   ```bash
   npm run build
   ```

4. Restart Obsidian and enable the plugin in Community Plugins settings.

## Configuration

1. Get your OpenWebUI API token from Settings > Account.
2. In Obsidian Settings > OpenWebUI Knowledge Base Sync:
   - Enter your OpenWebUI URL (e.g., http://localhost:3000)
   - Enter your API token
   - Test the connection

## Usage

1. Add one or more `#kb/knowledge-base-name` tags to any markdown file.
2. **Manual Sync**: Click the sync button in the ribbon.
3. **Auto Sync**: Enable in settings for automatic periodic sync.
4. Monitor progress in the status bar.

**Examples:**

- `#kb/my-project` → Creates knowledge base "My Project"
- `#kb/company_docs` → Creates knowledge base "Company Docs"
- `#kb/personal-notes` → Creates knowledge base "Personal Notes"
- `#kb/api_documentation` → Creates knowledge base "Api Documentation"

**Multiple Knowledge Bases:** You can add multiple KB tags to a single file:

# Meeting Notes

#kb/my-project #kb/company-docs #kb/meetings

This file will be synced to all three knowledge bases!

**Smart Tag Removal:** Remove KB tags and the plugin automatically cleans up:

```markdown
# Day 1: File synced to 3 knowledge bases
#kb/project-a #kb/project-b #kb/project-c

# Day 2: Remove a tag - file automatically removed from "Project C"
#kb/project-a #kb/project-b
```

**Note:** Use any case in tags - they will be automatically converted to Title Case with spaces in OpenWebUI knowledge base names.

**Auto-Sync:** When enabled, the plugin will automatically sync all tagged files at your specified interval. For near real-time syncing without worrying about data loss, set the interval to 1-2 minutes.

## Features

- ✅ Automatic knowledge base creation
- ✅ File overwrite handling
- ✅ Progress tracking
- ✅ Error handling
- ✅ Connection testing
- ✅ Batch sync multiple files
- ✅ **Multiple KB tags per file** (sync one file to multiple knowledge bases)
- ✅ **Smart sync with state tracking** (automatically removes files when tags are removed)
- ✅ **Auto-sync with configurable intervals (supports 1-minute intervals for near real-time syncing)**
- ✅ **Debug mode** (detailed console logging for troubleshooting)

## Status Bar Indicators

- `KB: 3/10` - Syncing progress (manual or auto-sync)
- `KB: ✓` - All files synced and up-to-date
- `KB: n/a` - OpenWebUI unreachable

**Tip:** For peace of mind, enable auto-sync with 1-2 minute intervals so your knowledge bases are always current.

## Troubleshooting

Check the console logs (Ctrl+Shift+I) for detailed error information.

---

# 🚀 Quick Setup Instructions

1. **Create the plugin folder:**
   ```
   your-vault/.obsidian/plugins/openwebui-kb-sync/
   ```

2. **Copy each file above into the folder** (use the exact filenames shown).
3. **Install and build:**
   ```bash
   cd your-vault/.obsidian/plugins/openwebui-kb-sync/
   npm install
   npm run build
   ```

4. **Restart Obsidian** and enable the plugin.
5. **Configure** in Settings > OpenWebUI Knowledge Base Sync.
6. **Test** by adding `#kb/test` to a markdown file and clicking sync!

The plugin will appear in your ribbon with a sync icon and show progress in the status bar. Let me know how the testing goes!