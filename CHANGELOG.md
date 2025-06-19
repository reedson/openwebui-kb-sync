# Changelog

All notable changes to the OpenWebUI KB Sync plugin will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2025-06-19

### Added - Link Processing 🔗

#### Link Processing Enhancement
- **Obsidian Link Conversion**: Added `processObsidianLinks()` function to convert Obsidian-style links to proper Obsidian URIs
  - `[[Internal Link]]` → `[Internal Link](obsidian://open?vault=VaultName&file=Internal%20Link.md)`
  - `[[Internal Link|Display Text]]` → `[Display Text](obsidian://open?vault=VaultName&file=Internal%20Link.md)`
  - `![[Embedded File]]` → `*Embedded: [Embedded File](obsidian://open?vault=VaultName&file=Embedded%20File)*`
- **OpenWebUI Compatibility**: Links now properly render in OpenWebUI instead of being stripped out
- **Vault Name Integration**: Uses actual vault name from `this.app.vault.getName()` for URI generation
- **File Extension Handling**: Smart extension detection - adds `.md` only when needed

#### Technical Improvements
- **Link Processing Integration**: Applied link conversion to regular file sync
- **Content Hash Accuracy**: Link processing happens before content hashing to ensure proper change detection
- **TypeScript Compliance**: Fixed unused parameter warnings in replace callbacks
- **Build Optimization**: All changes pass TypeScript compilation and build successfully

### Removed - Cleanup 🧹

#### Index Feature Removal
- **Removed Index Functionality**: Completely removed Obsidian Index feature that was not working well with OpenWebUI
- **Settings Cleanup**: Removed `obsidianIndexEnabled` and `obsidianIndexKnowledgeBase` settings
- **Code Cleanup**: Removed all index-related methods and UI components
- **Focus on Core**: Plugin now focuses purely on essential sync functionality

### Files Modified
- `main.ts`:
  - Added `processObsidianLinks()` function for link conversion
  - Integrated link processing in `syncFileWithStateTracking()`
  - Removed all index-related code and methods
  - Cleaned up settings interface and UI
- `CLAUDE.md`: Updated documentation to reflect current functionality
- `CHANGELOG.md`: Cleaned up to focus on actual features

### Testing Status
- ✅ **TypeScript Compilation**: Passes without errors or warnings
- ✅ **Build Process**: Successful production build
- ✅ **Deployment**: Successfully deployed to production vault
- ✅ **Link Conversion**: Obsidian links properly converted to clickable URIs
- ✅ **Core Sync**: All essential sync functionality working properly

---

## [1.0.0] - Initial Version

### Features - Core Sync Functionality
- **Core Sync Functionality**: Sync Obsidian notes to OpenWebUI Knowledge Base using `#kb/` tags
- **Smart File Tracking**: Content-based hashing and state management
- **Auto-sync**: Configurable automatic sync intervals
- **Multiple KB Support**: Single files can be synced to multiple knowledge bases
- **Intelligent Cleanup**: Automatic removal of files when KB tags are removed
- **Robust Error Handling**: Comprehensive error management and user feedback
- **Status Bar Integration**: Real-time sync status indicators
- **Settings Management**: Complete configuration interface
- **Debug Mode**: Detailed logging for troubleshooting
- **Connection Testing**: OpenWebUI API connectivity verification
- **Concurrency Protection**: Mutex-based sync operation protection

### Technical Foundation
- **File Mapping System**: Tracks OpenWebUI file IDs and content hashes
- **Sync State Management**: Maintains file-to-KB relationships
- **Content Change Detection**: Prevents unnecessary uploads
- **Knowledge Base Auto-creation**: Creates KBs automatically if they don't exist
- **Rename-safe Operations**: Handles file renames gracefully
- **API Integration**: Full OpenWebUI REST API integration

---

## Development Notes

### Current Focus
**Objective**: Maintain a clean, focused plugin that excels at core sync functionality

**Core Features**:
1. ✅ Tag-based sync with `#kb/knowledge-base-name` pattern
2. ✅ Smart file tracking with content hashing
3. ✅ Multi-KB support per file
4. ✅ Auto-sync with configurable intervals
5. ✅ Link processing for OpenWebUI compatibility
6. ✅ Robust error handling and user feedback

**Development Environment**:
- Working Directory: `/home/nic/Code/obsidian/openwebui-kb-sync`
- Platform: Linux 6.14.11-300.fc42.x86_64
- TypeScript: 4.7.4
- Build System: esbuild + TypeScript

**Code Quality Metrics**:
- TypeScript compilation: ✅ No errors
- Build process: ✅ Successful
- Code coverage: Core functionality fully implemented
- Documentation: Updated and accurate

**Next Development Session Recommendations**:
1. **User Testing**: Continue testing core sync functionality with various file types
2. **Performance Testing**: Test with large vaults (>1000 files)
3. **Edge Case Handling**: Test with special characters in filenames/tags
4. **UI/UX Improvements**: Consider minor interface enhancements
5. **Advanced Features**: Only add features that truly enhance core sync experience

**Known Considerations for Future Development**:
- Monitor performance with very large vaults
- Consider adding sync filtering options or patterns
- Potential for custom KB naming patterns
- Integration improvements with OpenWebUI updates

### File Structure
```
openwebui-kb-sync/
├── main.ts                 # Main plugin file (clean, focused)
├── manifest.json          # Plugin manifest
├── package.json           # Dependencies and build scripts  
├── tsconfig.json          # TypeScript configuration
├── esbuild.config.mjs     # Build configuration
├── README.md              # User documentation
├── CHANGELOG.md           # This file - development history
└── LICENSE                # MIT License
```

This changelog serves as a comprehensive record of the codebase evolution and will be updated with each development session.